import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID } from "node:crypto";
import { commandSchema, syncSessionSchema, syncItemSchema, type Item, type ItemInput, type SyncMutation } from "../../../packages/contracts/src/index.ts";
import { DockDatabase } from "../../desktop/src/main/database.ts";
import { DockSync } from "../../desktop/src/main/sync.ts";
import { schema } from "../../desktop/src/main/schema.ts";
import { startSyncFixture } from "./server.fixture.ts";

function directory() {
  assert.ok(process.env.DOCK_TEST_ROOT, "DOCK_TEST_ROOT must be task-owned disk-backed storage");
  return mkdtempSync(join(process.env.DOCK_TEST_ROOT, "sync-"));
}
function save(database: DockDatabase, item: ItemInput): Item {
  const command = commandSchema.parse({ type: "item.save", item });
  assert.equal(command.type, "item.save");
  if (command.type !== "item.save") throw new Error("Expected save command.");
  const before = new Set(database.snapshot().items.map(item => item.id));
  const items = database.execute(command).items;
  return items.find(saved => item.id ? saved.id === item.id : !before.has(saved.id))!;
}

const password = "test-only-password-2026";

test("public email/password signup and sessions isolate accounts; sync writes use CAS and durable idempotency receipts", async () => {
  const root = directory();
  const server = await startSyncFixture(root);
  const request = (path: string, body?: unknown, token?: string) => fetch(server.endpoint + path, {
    method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  try {
    assert.equal((await request("/auth/signup", { email: "not-an-email", password })).status, 400);
    const first = syncSessionSchema.parse(await (await request("/auth/signup", { email: " First@Example.com ", password })).json());
    assert.equal(first.email, "first@example.com");
    assert.equal((await request("/auth/signup", { email: "first@example.com", password })).status, 409);
    const second = syncSessionSchema.parse(await (await request("/auth/signup", { email: "second@example.com", password })).json());
    assert.equal((await request("/auth/login", { email: "first@example.com", password: "incorrect-password" })).status, 401);
    const stored = server.database.prepare("SELECT password FROM auth_account WHERE userId = ? AND providerId = 'credential'").get(first.accountId)!;
    assert.notEqual(stored.password, password);
    assert.match(String(stored.password), /^[0-9a-f]+:[0-9a-f]+$/);
    assert.equal((await request("/sync")).status, 401);
    const mutation: SyncMutation = {
      mutationId: randomBytes(16).toString("hex"), baseVersion: 0,
      item: syncItemSchema.parse({ id: randomUUID(), kind: "note", title: "Private note", body: "First", tags: ["Launch"], noteStyle: { font: "serif", size: 14 }, space: "Inbox", priority: false,
        done: false, scheduledAt: null, recurrence: "none", linkedNoteId: null, recurrenceSourceId: null, deletedAt: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
    };
    assert.equal((await request("/sync", mutation, first.token)).status, 200);
    const newer = { ...mutation, mutationId: randomBytes(16).toString("hex"), baseVersion: 1, item: { ...mutation.item, body: "Second" } };
    assert.equal((await (await request("/sync", newer, first.token)).json()).version, 2);
    const retry = await (await request("/sync", mutation, first.token)).json();
    assert.equal(retry.accepted, true); assert.equal(retry.version, 1); assert.equal(retry.current.item.body, "Second");
    assert.deepEqual(retry.current.item.tags, ["Launch"]);
    assert.deepEqual(retry.current.item.noteStyle, { font: "serif", size: 14 });
    const conflict = await (await request("/sync", { ...newer, mutationId: randomBytes(16).toString("hex"), item: { ...newer.item, body: "Stale" } }, first.token)).json();
    assert.equal(conflict.accepted, false); assert.equal(conflict.current.item.body, "Second");
    assert.equal(server.database.prepare("SELECT count(*) AS count FROM changes").get()!.count, 2);
    assert.equal((await (await request("/sync?cursor=0", undefined, second.token)).json()).changes.length, 0);
    assert.equal((await request("/sync?cursor=invalid", undefined, first.token)).status, 400);
    assert.equal((await request("/auth/logout", {}, first.token)).status, 200);
    assert.equal((await request("/sync", undefined, first.token)).status, 401);
    server.database.prepare("UPDATE auth_session SET expiresAt = ? WHERE userId = ?").run("2000-01-01T00:00:00.000Z", second.accountId);
    assert.equal((await request("/sync", undefined, second.token)).status, 401);
    server.env.AUTH_LIMITER = { async limit() { return { success: false }; } };
    assert.equal((await request("/auth/login", { email: "first@example.com", password })).status, 429);
  } finally { await server.close(); rmSync(root, { recursive: true }); }
});

test("v1 SQLite migrates without data loss; pending edits survive restart and acknowledgements preserve later edits", () => {
  const root = directory();
  const filename = join(root, "legacy.sqlite");
  const legacy = new DatabaseSync(filename);
  const id = randomUUID();
  legacy.exec(schema);
  legacy.prepare("INSERT INTO items(id, kind, title, body, space, created_at, updated_at) VALUES(?, 'note', 'Legacy', 'Keep me', 'Work', ?, ?)").run(id, new Date().toISOString(), new Date().toISOString());
  legacy.close();
  let database = new DockDatabase(filename);
  try {
    assert.equal(database.snapshot().items[0]!.body, "Keep me");
    assert.equal(database.syncCounts().pending, 1);
    const sent = database.pendingChanges()[0]!;
    save(database, { ...database.snapshot().items[0]!, expectedRevision: 1, body: "New offline edit" });
    database.acknowledgeSync(sent, 1);
    assert.equal(database.syncCounts().pending, 1);
    database.close(); database = new DockDatabase(filename);
    assert.equal(database.pendingChanges()[0]!.baseVersion, 1);
    assert.equal(database.pendingChanges()[0]!.item.body, "New offline edit");
    database.bindSyncAccount("https://sync.example.com", randomUUID());
    assert.throws(() => database.bindSyncAccount("https://sync.example.com", randomUUID()), /another sync account/);
    database.execute({ type: "settings.save", settings: { ...database.snapshot().settings, theme: "light" } });
    database.markNotified(id, new Date());
    assert.equal(database.syncCounts().pending, 1);
  } finally { database.close(); rmSync(root, { recursive: true }); }
});

test("two offline clients converge after restart, preserve conflicts, sync deletion/undo, and deduplicate retries and recurrence", async () => {
  const root = directory();
  const server = await startSyncFixture(root);
  let a = new DockDatabase(join(root, "a.sqlite"));
  const b = new DockDatabase(join(root, "b.sqlite"));
  let syncA = new DockSync(a, () => {});
  const syncB = new DockSync(b, () => {});
  try {
    const markdown = "# Shared note\n\nKeep **formatting**.\n\n- [x] Offline\n\n[Dock](https://github.com/nassimna/dock)";
    const note = save(a, { kind: "note", title: "Shared note", body: markdown });
    const task = save(a, { kind: "task", title: "Weekly review", linkedNoteId: note.id, recurrence: "weekly", scheduledAt: "2030-10-08T12:00:00.000Z" });
    const credentialsA = await syncA.authenticate({ type: "sync.signup", endpoint: server.endpoint, email: "sync@example.com", password });
    syncA.restore(credentialsA);
    const credentialsB = await syncB.authenticate({ type: "sync.login", endpoint: server.endpoint, email: "sync@example.com", password });
    syncB.restore(credentialsB);
    await syncA.sync(); await syncA.sync(); await syncB.sync();
    assert.equal(b.snapshot().items.length, 2);
    assert.equal(b.snapshot().items.find(item => item.id === note.id)!.body, markdown);
    assert.equal(b.snapshot().items.find(item => item.id === task.id)!.linkedNoteId, note.id);
    b.execute({ type: "settings.save", settings: { ...b.snapshot().settings, theme: "light" } });
    server.setOffline(true);
    save(a, { ...a.snapshot().items.find(item => item.id === note.id)!, expectedRevision: a.snapshot().items.find(item => item.id === note.id)!.revision, body: "Edit from A" });
    save(b, { ...b.snapshot().items.find(item => item.id === note.id)!, expectedRevision: b.snapshot().items.find(item => item.id === note.id)!.revision, body: "Edit from B" });
    await syncA.sync();
    assert.equal(syncA.status().phase, "offline"); assert.equal(syncA.status().pending, 1);
    await syncA.stop(); a.close();
    a = new DockDatabase(join(root, "a.sqlite")); syncA = new DockSync(a, () => {}); syncA.restore(credentialsA);
    assert.equal(a.syncCounts().pending, 1);
    server.setOffline(false);
    await syncB.sync(); await syncA.sync(); await syncA.sync(); await syncB.sync();
    const notes = b.snapshot().items.filter(item => item.kind === "note");
    assert.deepEqual(notes.map(item => item.body).sort(), ["Edit from A", "Edit from B"]);
    const copy = notes.find(item => item.title.endsWith("(conflict copy)"))!;
    assert.ok(copy); assert.equal(syncA.status().conflicts, 1);
    assert.equal(a.snapshot().settings.theme, "dark"); assert.equal(b.snapshot().settings.theme, "light");
    a.execute({ type: "item.delete", id: copy.id }); await syncA.sync(); await syncB.sync();
    assert.equal(b.snapshot().items.some(item => item.id === copy.id), false);
    b.execute({ type: "item.restore", id: copy.id }); await syncB.sync(); await syncA.sync();
    assert.equal(a.snapshot().items.find(item => item.id === copy.id)!.body, "Edit from A");
    const retryItem = save(a, { kind: "task", title: "Retry safely" });
    server.dropNextPushResponse(); await syncA.sync();
    assert.equal(syncA.status().phase, "offline"); assert.equal(syncA.status().pending, 1);
    await syncA.sync(); await syncB.sync();
    assert.equal(b.snapshot().items.filter(item => item.id === retryItem.id).length, 1);
    assert.equal(server.database.prepare("SELECT count(*) AS count FROM changes WHERE item_id = ?").get(retryItem.id)!.count, 1);
    a.execute({ type: "item.complete", id: task.id }); b.execute({ type: "item.complete", id: task.id });
    await syncA.sync(); await syncB.sync(); await syncA.sync();
    assert.equal(server.database.prepare("SELECT count(*) AS count FROM records WHERE json_extract(payload, '$.recurrenceSourceId') = ?").get(task.id)!.count, 1);
    assert.equal(a.snapshot().items.filter(item => item.title === "Weekly review" && !item.done).length, 1);
    assert.equal(b.snapshot().items.filter(item => item.title === "Weekly review" && !item.done).length, 1);
    await syncA.disconnect();
    assert.equal(syncA.status().connected, false);
    assert.ok(a.snapshot().items.length > 0);
  } finally {
    await syncA.stop(); await syncB.stop(); a.close(); b.close(); await server.close(); rmSync(root, { recursive: true });
  }
});

test("authentication gives actionable transport errors and allows retry without changing local data", async (t) => {
  const root = directory();
  const server = await startSyncFixture(root);
  const database = new DockDatabase(join(root, "auth-retry.sqlite"));
  const { DockSync: CoreDockSync } = await import("../../../packages/core/src/sync.ts");
  let failure: Error | null = new TypeError("fetch failed");
  let timeout = false;
  const sync = new CoreDockSync(database, () => {}, "Retry test", async (url, init) => {
    if (failure) throw failure;
    if (timeout) return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
    return fetch(url, init);
  });
  const command = { type: "sync.signup" as const, endpoint: server.endpoint, email: "retry@example.com", password };
  try {
    const note = save(database, { kind: "note", title: "Keep my local work" });
    await assert.rejects(sync.authenticate(command), /Could not reach the sync server. Check your connection and try again/);
    failure = new Error("Native transport failed");
    failure.name = "TypeError";
    await assert.rejects(sync.authenticate(command), /Could not reach the sync server. Check your connection and try again/);
    assert.equal(database.syncAccount(), null);
    assert.equal(sync.status().connected, false);
    failure = null;
    timeout = true;
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const attempt = sync.authenticate(command);
    t.mock.timers.tick(10_000);
    await assert.rejects(attempt, { name: "TimeoutError", message: "The sync server took too long to respond. Try again." });
    t.mock.timers.reset();
    timeout = false;
    const session = await sync.authenticate(command);
    assert.equal(session.email, "retry@example.com");
    assert.equal(database.snapshot().items.find(item => item.id === note.id)?.title, note.title);
  } finally {
    await sync.stop();
    database.close();
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
