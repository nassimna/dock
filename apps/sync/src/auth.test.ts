import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createHash, createHmac, randomBytes, randomUUID, scryptSync } from "node:crypto";
import { syncSessionSchema } from "../../../packages/contracts/src/index.ts";
import { startSyncFixture } from "./server.fixture.ts";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const password = "legacy-password-for-migration-2026";

test("Better Auth migration retains legacy passwords, identities, data and sessions; recovery atomically replaces both session generations", async () => {
  assert.ok(process.env.DOCK_TEST_ROOT);
  const directory = mkdtempSync(join(process.env.DOCK_TEST_ROOT, "auth-migration-"));
  const id = randomUUID(), otherId = randomUUID(), noteId = randomUUID();
  const oldToken = `${id}.${randomBytes(32).toString("hex")}`;
  const otherToken = `${otherId}.${randomBytes(32).toString("hex")}`;
  const recovery = randomBytes(32).toString("hex");
  const salt = randomBytes(32).toString("hex");
  const legacyHash = scryptSync(createHmac("sha256", "test-only-pepper-not-for-deployment").update(password).digest(), salt, 32, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }).toString("hex");
  const email = "legacy@example.com";
  const expiresAt = new Date(Date.now() + 86400_000).toISOString();
  const server = await startSyncFixture(directory, db => {
    for (const [userId, userEmail] of [[id, email], [otherId, "other@example.com"]])
      db.prepare("INSERT INTO accounts(id, email, password_hash, password_salt, recovery_hash) VALUES(?, ?, ?, ?, ?)").run(userId!, userEmail!, legacyHash, salt, digest(recovery));
    for (const [userId, token] of [[id, oldToken], [otherId, otherToken]])
      db.prepare("INSERT INTO sessions(token_hash, account_id, expires_at, device_name) VALUES(?, ?, ?, 'Legacy desktop')").run(digest(token!), userId!, expiresAt);
    db.prepare("INSERT INTO records(account_id, item_id, version, payload, mutation_id) VALUES(?, ?, 1, ?, ?)").run(id, noteId, JSON.stringify({ id: noteId, title: "Keep this private note" }), randomUUID());
    db.prepare("INSERT INTO account_workspaces(account_id, version, payload, mutation_id) VALUES(?, 1, '[]', ?)").run(id, randomUUID());
  });
  const request = (path: string, body?: unknown, token?: string, origin?: string) => fetch(server.endpoint + path, {
    method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(origin ? { Origin: origin } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const login = (candidate = password) => request("/auth/login", { email, password: candidate, deviceName: "Better Auth desktop" });
  try {
    const migrated = server.database.prepare("SELECT password FROM auth_account WHERE userId = ?").get(id)!;
    assert.equal(migrated.password, `rivnote-v1:${salt}:${legacyHash}`);
    const retired = server.database.prepare("SELECT password_hash, password_salt FROM accounts WHERE id = ?").get(id)!;
    assert.equal(retired.password_hash, "");
    assert.equal(retired.password_salt, "");
    assert.equal((await (await request("/account", undefined, oldToken)).json()).accountId, id);
    const first = syncSessionSchema.parse(await (await login()).json());
    assert.equal(first.accountId, id);
    assert.equal((await request("/sync", undefined, first.token)).status, 200);
    assert.equal((await (await request("/sync", undefined, otherToken)).json()).changes.length, 0);
    assert.equal(server.database.prepare("SELECT account_id FROM records WHERE item_id = ?").get(noteId)!.account_id, id);
    assert.equal(server.database.prepare("SELECT version FROM account_workspaces WHERE account_id = ?").get(id)!.version, 1);
    const stored = server.database.prepare("SELECT token, tokenHash FROM auth_session WHERE userId = ?").get(id)!;
    assert.notEqual(stored.token, first.token.split(".")[1]);
    assert.equal(stored.tokenHash, digest(first.token));
    const forged = `${otherId}.${first.token.split(".")[1]}`;
    assert.equal((await request("/account", undefined, forged)).status, 401);
    assert.equal((await request("/api/auth/get-session", undefined, String(stored.token))).status, 404);
    assert.equal((await login("incorrect-password-2026")).status, 401);
    assert.equal((await request("/auth/login", { email, password }, undefined, "https://untrusted.example")).status, 403);
    const devices = await (await request("/auth/devices", undefined, first.token)).json();
    assert.equal(devices.devices.length, 2);
    assert(devices.devices.some((d: { name: string }) => d.name === "Legacy desktop"));
    assert.equal((await request("/auth/revoke", { id: digest(oldToken) }, otherToken)).status, 200);
    assert.equal((await request("/account", undefined, oldToken)).status, 200);
    assert.equal((await request("/auth/recover", { email, password, recoveryCode: recovery, expectedAccountId: otherId })).status, 401);
    // A storage failure must roll back code consumption, password change and revocations.
    server.database.exec("CREATE TRIGGER reject_recovery BEFORE INSERT ON auth_session WHEN NEW.deviceName = 'Recovered Rivnote device' BEGIN SELECT RAISE(ABORT, 'test storage failure'); END");
    const reset = { email, password: "replacement-password-2026", recoveryCode: recovery };
    assert.equal((await request("/auth/recover", reset)).status, 503);
    assert.equal(server.database.prepare("SELECT password FROM auth_account WHERE userId = ?").get(id)!.password, migrated.password);
    assert.equal((await request("/account", undefined, oldToken)).status, 200);
    assert.equal((await request("/account", undefined, first.token)).status, 200);
    server.database.exec("DROP TRIGGER reject_recovery");
    const attempts = await Promise.all([request("/auth/recover", reset), request("/auth/recover", reset)]);
    assert.deepEqual(attempts.map(r => r.status).sort(), [200, 401]);
    const recovered = syncSessionSchema.parse(await attempts.find(r => r.status === 200)!.json());
    assert.equal(recovered.accountId, id);
    assert.equal((await request("/account", undefined, recovered.token)).status, 200);
    assert.equal((await request("/account", undefined, oldToken)).status, 401);
    assert.equal((await request("/account", undefined, first.token)).status, 401);
    assert.equal((await request("/account", undefined, otherToken)).status, 200);
    assert.equal((await login()).status, 401);
    const after = syncSessionSchema.parse(await (await login(reset.password)).json());
    assert.equal(after.accountId, id);
    const legacyDevices = await (await request("/auth/devices", undefined, otherToken)).json();
    assert.equal(legacyDevices.devices.length, 1);
    const otherLogin = syncSessionSchema.parse(await (await request("/auth/login", { email: "other@example.com", password })).json());
    const otherDevices = await (await request("/auth/devices", undefined, otherLogin.token)).json();
    assert.equal(otherDevices.devices.length, 2);
    assert.equal((await request("/auth/revoke", { id: digest(otherToken) }, otherLogin.token)).status, 200);
    assert.equal((await request("/account", undefined, otherToken)).status, 401);
    assert.equal((await request("/auth/logout", {}, after.token)).status, 200);
    assert.equal((await request("/account", undefined, after.token)).status, 401);
  } finally { await server.close(); rmSync(directory, { recursive: true }); }
});

test("a failed Better Auth credential insert leaves signup retryable without touching existing accounts", async () => {
  assert.ok(process.env.DOCK_TEST_ROOT);
  const directory = mkdtempSync(join(process.env.DOCK_TEST_ROOT, "auth-signup-"));
  const server = await startSyncFixture(directory);
  const signup = (email: string) => fetch(server.endpoint + "/auth/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  try {
    const existing = syncSessionSchema.parse(await (await signup("existing@example.com")).json());
    server.database.exec("CREATE TRIGGER reject_credential BEFORE INSERT ON auth_account BEGIN SELECT RAISE(ABORT, 'test credential failure'); END");
    assert.equal((await signup("retry@example.com")).status, 503);
    assert.equal(server.database.prepare("SELECT id FROM auth_user WHERE email = 'retry@example.com'").get(), undefined);
    assert.equal(server.database.prepare("SELECT id FROM accounts WHERE email = 'retry@example.com'").get(), undefined);
    assert.equal((await signup("existing@example.com")).status, 409);
    assert.equal(server.database.prepare("SELECT id FROM accounts WHERE id = ?").get(existing.accountId)!.id, existing.accountId);
    server.database.exec("DROP TRIGGER reject_credential");
    const retried = syncSessionSchema.parse(await (await signup("retry@example.com")).json());
    assert.equal(retried.email, "retry@example.com");
  } finally { await server.close(); rmSync(directory, { recursive: true }); }
});
