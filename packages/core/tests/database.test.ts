import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { appBrand, commandSchema, syncEndpointSchema } from "@dock/contracts";
import { DockDatabase } from "../src/database.ts";
import { DockSync } from "../src/sync.ts";

test("injected SQLite and hash providers retain the desktop recurrence UUID vector", () => {
  const database = new DockDatabase(new DatabaseSync(":memory:"), {
    randomUUID: () => "00000000-0000-4000-8000-000000000001",
    sha256: value => new Uint8Array(createHash("sha256").update(value).digest()),
  });
  try {
    const original = database.execute(commandSchema.parse({ type: "item.save", item: {
      kind: "task", title: "Daily review", recurrence: "daily", scheduledAt: "2026-10-27T09:00:00.000Z",
      task: { priority: 2 },
    } }), new Date("2026-10-27T08:00:00.000Z")).items[0]!;
    const completed = database.execute({ type: "item.complete", id: original.id }, new Date("2026-10-27T10:00:00.000Z"));
    const next = completed.items.find(item => item.id !== original.id)!;
    assert.equal(next.id, "85733a48-c6da-83cf-aaf5-204f2fae9b6e");
    assert.equal(next.scheduledAt, "2026-10-28T09:00:00.000Z");
    assert.equal(next.task.priority, 2);
    assert.equal(database.pendingChanges().find(change => change.item.id === original.id)?.item.done, true);
  } finally { database.close(); }
});

test("the hosted endpoint move preserves the bound account, cursor and pending edits", () => {
  const sqlite = new DatabaseSync(":memory:");
  const database = new DockDatabase(sqlite, {
    randomUUID,
    sha256: value => new Uint8Array(createHash("sha256").update(value).digest()),
  });
  const accountId = randomUUID();
  const oldEndpoint = "https://dock-sync.jood-b3d.workers.dev";
  try {
    database.execute(commandSchema.parse({ type: "item.save", item: { kind: "note", title: "Unsynced note", body: "Keep this offline edit" } }));
    sqlite.prepare("INSERT INTO sync_meta(key,value) VALUES('account',?)").run(JSON.stringify({ endpoint: oldEndpoint, accountId }));
    sqlite.prepare("INSERT INTO sync_meta(key,value) VALUES('cursor','147')").run();
    const pending = database.pendingChanges();
    database.bindSyncAccount(appBrand.syncEndpoint, accountId);
    assert.equal(syncEndpointSchema.parse(oldEndpoint + "/"), appBrand.syncEndpoint);
    assert.equal(syncEndpointSchema.parse("https://custom.example.com"), "https://custom.example.com");
    assert.deepEqual(database.syncAccount(), { endpoint: appBrand.syncEndpoint, accountId });
    assert.equal(JSON.parse(String(sqlite.prepare("SELECT value FROM sync_meta WHERE key='account'").get()!.value)).endpoint, appBrand.syncEndpoint);
    assert.equal(sqlite.prepare("SELECT value FROM sync_meta WHERE key='cursor'").get()!.value, "147");
    assert.deepEqual(database.pendingChanges(), pending);
    assert.throws(() => database.bindSyncAccount(appBrand.syncEndpoint, randomUUID()), /another sync account or server/);
    assert.throws(() => database.bindSyncAccount("https://custom.example.com", accountId), /another sync account or server/);
  } finally { database.close(); }
});

test("login and restored sessions use the personal host for the legacy hosted endpoint", async () => {
  const database = new DockDatabase(new DatabaseSync(":memory:"), {
    randomUUID,
    sha256: value => new Uint8Array(createHash("sha256").update(value).digest()),
  });
  const session = { accountId: randomUUID(), email: "migration@example.com", token: `${randomUUID()}.${"a".repeat(64)}`, expiresAt: "2030-01-01T00:00:00.000Z" };
  const urls: string[] = [];
  const sync = new DockSync(database, () => {}, "Migration test", async url => {
    urls.push(url);
    return { ok: true, status: 200, json: async () => session };
  });
  try {
    const credentials = await sync.authenticate({ type: "sync.login", endpoint: "https://dock-sync.jood-b3d.workers.dev", email: session.email, password: "migration-test-password" });
    assert.deepEqual(urls, [appBrand.syncEndpoint + "/auth/login"]);
    sync.restore({ ...credentials, endpoint: "https://dock-sync.jood-b3d.workers.dev" });
    assert.equal(sync.status().endpoint, appBrand.syncEndpoint);
    assert.equal(sync.status().connected, true);
    assert.equal(database.syncAccount()!.accountId, session.accountId);
  } finally { await sync.stop(); database.close(); }
});
