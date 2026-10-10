import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { commandSchema, type ItemInput } from "@dock/contracts";
import { DockDatabase } from "./database.ts";
import { schema, syncSchema } from "./schema.ts";

function save(database: DockDatabase, item: ItemInput) {
  const command = commandSchema.parse({ type: "item.save", item });
  assert.equal(command.type, "item.save");
  return database.execute(command).items;
}

test("note properties migrate existing data, survive reopening and queue for sync", () => {
  assert.ok(process.env.DOCK_TEST_ROOT);
  const folder = mkdtempSync(join(process.env.DOCK_TEST_ROOT, "note-properties-"));
  const filename = join(folder, "dock.sqlite");
  const legacy = new DatabaseSync(filename);
  legacy.exec(schema); legacy.exec(syncSchema);
  const id = randomUUID();
  legacy.prepare("INSERT INTO items(id,kind,title,body,space,created_at,updated_at) VALUES(?, 'note', 'Existing note', 'Keep الجمعة', 'Work', ?, ?)")
    .run(id, new Date().toISOString(), new Date().toISOString());
  legacy.close();
  let database = new DockDatabase(filename);
  try {
    const original = database.snapshot().items[0]!;
    assert.equal(original.body, "Keep الجمعة");
    assert.deepEqual(original.tags, []); assert.deepEqual(original.noteStyle, {});
    const first = database.pendingChanges()[0]!;
    database.acknowledgeSync(first, 1);
    const changed = save(database, { ...original, expectedRevision: original.revision,
      tags: ["Ideas", "Launch", "Ideas"], noteStyle: { font: "serif", size: 18, fullWidth: true } })[0]!;
    assert.deepEqual(changed.tags, ["Ideas", "Launch"]);
    assert.deepEqual(database.pendingChanges()[0]?.item.noteStyle, { font: "serif", size: 18, fullWidth: true });
    assert.deepEqual(database.pendingChanges()[0]?.item.tags, ["Ideas", "Launch"]);
    assert.equal(database.pendingChanges()[0]?.baseVersion, 1);
    save(database, { id, expectedRevision: changed.revision, kind: "note", title: changed.title, body: "New body", space: "Work" });
    database.close(); database = new DockDatabase(filename);
    const reopened = database.snapshot().items[0]!;
    assert.equal(reopened.body, "New body"); assert.deepEqual(reopened.tags, ["Ideas", "Launch"]);
    assert.deepEqual(reopened.noteStyle, { font: "serif", size: 18, fullWidth: true });
  } finally { database.close(); rmSync(folder, { recursive: true }); }
});

test("remote note properties and local conflict copies preserve their own tags and typography", () => {
  const a = new DockDatabase(":memory:"); const b = new DockDatabase(":memory:");
  try {
    const original = save(a, { kind: "note", title: "Shared note", tags: ["Work"], noteStyle: { font: "mono" } })[0]!;
    const first = a.pendingChanges()[0]!; a.acknowledgeSync(first, 1);
    b.applySync([{ item: first.item, version: 1 }]);
    assert.deepEqual(b.snapshot().items[0]?.tags, ["Work"]);
    const local = b.snapshot().items[0]!;
    save(b, { ...local, expectedRevision: local.revision, title: "My edits", tags: ["Local"], noteStyle: { size: 14 } });
    save(a, { ...original, expectedRevision: original.revision, title: "Remote edits", tags: ["Remote"], noteStyle: { font: "serif", fullWidth: true } });
    b.applySync([{ item: a.pendingChanges()[0]!.item, version: 2 }]);
    const notes = b.snapshot().items;
    const remote = notes.find(note => note.id === original.id)!;
    const copy = notes.find(note => note.id !== original.id)!;
    assert.deepEqual(remote.tags, ["Remote"]); assert.deepEqual(remote.noteStyle, { font: "serif", fullWidth: true });
    assert.deepEqual(copy.tags, ["Local"]); assert.deepEqual(copy.noteStyle, { size: 14 });
    assert.match(copy.title, /conflict copy/);
  } finally { a.close(); b.close(); }
});
