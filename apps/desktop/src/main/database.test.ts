import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { appBrand, commandSchema, type ItemInput } from "@dock/contracts";
import { DockDatabase, openLocalDatabase } from "./database.ts";

function save(
  database: DockDatabase,
  item: ItemInput,
  now = new Date("2026-10-08T12:00:00Z"),
) {
  const command = commandSchema.parse({ type: "item.save", item });
  if (command.type !== "item.save")
    throw new Error("Expected an item command.");
  return database.execute(command, now);
}

test("tasks, notes, preferences, and linked content survive reopening the SQLite file", () => {
  const parent = process.env.DOCK_TEST_ROOT;
  assert.ok(
    parent,
    "DOCK_TEST_ROOT must point to task-owned disk-backed storage",
  );
  const directory = mkdtempSync(join(parent, "persistence-"));
  const filename = join(directory, "dock.sqlite");
  let database = new DockDatabase(filename);
  try {
    assert.equal(database.snapshot().settings.density, "compact");
    assert.equal(database.snapshot().settings.noteFont, "system");
    assert.equal(database.snapshot().settings.capturePinned, true);
    assert.equal(database.snapshot().settings.miniPinned, true);
    assert.equal(database.snapshot().settings.openMiniAtStartup, false);
    assert.equal(database.snapshot().settings.automaticUpdates, true);
    assert.deepEqual(database.snapshot().settings.themeColors, { dark: {}, light: {} });
    assert.throws(() => commandSchema.parse({
      type: "settings.save",
      settings: { ...database.snapshot().settings, themeColors: { dark: { background: "url(https://example.com)" }, light: {} } },
    }));
    const note = save(database, {
      kind: "note",
      title: "Call notes",
      body: "Follow up الجمعة",
      space: "Work",
    }).items[0]!;
    const task = save(database, {
      kind: "task",
      title: "Follow up",
      space: "Work",
      priority: true,
      linkedNoteId: note.id,
      scheduledAt: "2026-10-09T09:00:00Z",
    }).items.find((item) => item.kind === "task")!;
    database.execute({
      type: "settings.save",
      settings: {
        ...database.snapshot().settings,
        theme: "light",
        themeColors: {
          dark: { background: "#171923", primary: "#c4a1ff" },
          light: { background: "#ffffff", card: "#f6f5ff", foreground: "#252035", mutedForeground: "#6f6484", border: "#ded8ef", primary: "#6940bf" },
        },
        density: "comfortable",
        noteFont: "serif",
        noteSize: 18,
        shortcut: "Control+Alt+J",
        capturePinned: false,
        miniPinned: false,
        openMiniAtStartup: true,
        automaticUpdates: false,
      },
    });
    database.close();
    database = new DockDatabase(filename);
    const restored = database.snapshot();
    assert.equal(restored.items.length, 2);
    assert.equal(
      restored.items.find((item) => item.id === note.id)?.body,
      "Follow up الجمعة",
    );
    assert.equal(
      restored.items.find((item) => item.id === task.id)?.linkedNoteId,
      note.id,
    );
    assert.equal(restored.settings.theme, "light");
    assert.deepEqual(restored.settings.themeColors, {
      dark: { background: "#171923", primary: "#c4a1ff" },
      light: { background: "#ffffff", card: "#f6f5ff", foreground: "#252035", mutedForeground: "#6f6484", border: "#ded8ef", primary: "#6940bf" },
    });
    assert.equal(restored.settings.density, "comfortable");
    assert.equal(restored.settings.noteFont, "serif");
    assert.equal(restored.settings.noteSize, 18);
    assert.equal(restored.settings.shortcut, "Control+Alt+J");
    assert.equal(restored.settings.capturePinned, false);
    assert.equal(restored.settings.miniPinned, false);
    assert.equal(restored.settings.openMiniAtStartup, true);
    assert.equal(restored.settings.automaticUpdates, false);
  } finally {
    database.close();
    rmSync(directory, { recursive: true });
  }
});

test("stale updates fail without losing content, and deletion can be undone", () => {
  const database = new DockDatabase(":memory:");
  try {
    const original = save(database, {
      kind: "note",
      title: "Original",
      body: "Keep this",
    }).items[0]!;
    const changed = save(database, {
      ...original,
      expectedRevision: original.revision,
      title: "Changed",
    }).items[0]!;
    assert.throws(
      () =>
        save(database, {
          ...original,
          expectedRevision: original.revision,
          title: "Stale overwrite",
        }),
      /changed in another window/,
    );
    assert.equal(database.snapshot().items[0]?.title, "Changed");
    database.execute({ type: "item.delete", id: original.id });
    assert.equal(database.snapshot().items.length, 0);
    database.execute({ type: "item.restore", id: original.id });
    assert.equal(database.snapshot().items[0]?.body, "Keep this");
    assert.equal(database.snapshot().items[0]?.revision, changed.revision + 2);
  } finally {
    database.close();
  }
});

test("completing a recurring task creates one future occurrence, including after reopening", () => {
  const database = new DockDatabase(":memory:");
  const now = new Date("2026-10-08T12:00:00Z");
  try {
    const item = save(
      database,
      {
        kind: "task",
        title: "Weekly review",
        scheduledAt: "2026-10-01T09:00:00Z",
        recurrence: "weekly",
      },
      now,
    ).items[0]!;
    database.execute({ type: "item.toggle", id: item.id }, now);
    const next = database.snapshot().items.find((task) => task.id !== item.id)!;
    assert.equal(next.scheduledAt, "2026-10-15T09:00:00.000Z");
    assert.equal(next.done, false);
    database.execute({ type: "item.toggle", id: item.id }, now);
    database.execute({ type: "item.toggle", id: item.id }, now);
    database.execute({ type: "item.complete", id: item.id }, now);
    assert.equal(database.snapshot().items.length, 2);
    assert.equal(
      database.snapshot().items.find((task) => task.id === item.id)?.done,
      true,
    );
  } finally {
    database.close();
  }
});

test("invalid note links and recurrence fail before data can change", () => {
  const database = new DockDatabase(":memory:");
  try {
    const task = save(database, { kind: "task", title: "Existing task" })
      .items[0]!;
    assert.throws(
      () =>
        save(database, {
          kind: "task",
          title: "Bad link",
          linkedNoteId: task.id,
        }),
      /linked note/,
    );
    assert.throws(
      () =>
        commandSchema.parse({
          type: "item.save",
          item: { kind: "task", title: "Missing date", recurrence: "daily" },
        }),
      /scheduled date/,
    );
    assert.equal(database.snapshot().items.length, 1);
  } finally {
    database.close();
  }
});

test("branded database startup recovers legacy WAL data and preserves pending sync state", () => {
  assert.ok(process.env.DOCK_TEST_ROOT);
  const directory = mkdtempSync(join(process.env.DOCK_TEST_ROOT, "database-name-"));
  const oldPath = join(directory, "dock.sqlite");
  const newPath = join(directory, appBrand.databaseFilename);
  const fixture = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `
    import { DockDatabase } from ${JSON.stringify(new URL("./database.ts", import.meta.url).href)};
    import { DatabaseSync } from 'node:sqlite';
    import { commandSchema } from ${JSON.stringify(new URL("../../../../packages/contracts/src/index.ts", import.meta.url).href)};
    import { writeFileSync } from 'node:fs';
    import { join } from 'node:path';
    const directory = process.argv[1];
    const database = new DockDatabase(join(directory, 'dock.sqlite'));
    database.execute(commandSchema.parse({ type: 'item.save', item: { kind: 'note', title: 'Offline note', body: 'Recent WAL content' } }));
    database.execute({ type: 'settings.save', settings: { ...database.snapshot().settings, density: 'comfortable' } });
    database.bindSyncAccount('https://rivnote-sync.najjarnassim1995.workers.dev', '00000000-0000-4000-8000-000000000001');
    new DatabaseSync(join(directory, 'dock.sqlite')).prepare("INSERT INTO sync_meta(key,value) VALUES('cursor','147')").run();
    writeFileSync(join(directory, 'before.json'), JSON.stringify({ items: database.snapshot().items, settings: database.snapshot().settings, pending: database.pendingChanges(), account: database.syncAccount() }));
    process.kill(process.pid, 'SIGKILL');
  `, directory], { encoding: "utf8" });
  let database: DockDatabase | undefined;
  try {
    assert.equal(fixture.signal, "SIGKILL", fixture.stderr);
    assert.ok(statSync(oldPath + "-wal").size > 0);
    const before = JSON.parse(readFileSync(join(directory, "before.json"), "utf8"));
    database = openLocalDatabase(directory);
    assert.equal(existsSync(oldPath), false);
    assert.equal(existsSync(newPath), true);
    assert.deepEqual(database.snapshot().items, before.items);
    assert.deepEqual(database.snapshot().settings, before.settings);
    assert.deepEqual(database.pendingChanges(), before.pending);
    assert.deepEqual(database.syncAccount(), before.account);
    assert.equal(database.syncCursor(), 147);
    database.close();
    database = openLocalDatabase(directory);
    assert.equal(database.snapshot().items[0]!.body, "Recent WAL content");
    assert.deepEqual(database.pendingChanges(), before.pending);
  } finally { database?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("branded database startup keeps an existing branded database and leaves legacy data intact", () => {
  assert.ok(process.env.DOCK_TEST_ROOT);
  const directory = mkdtempSync(join(process.env.DOCK_TEST_ROOT, "database-existing-"));
  let database = openLocalDatabase(directory);
  try {
    save(database, { kind: "note", title: "Current Rivnote data" });
    database.close();
    const legacy = new DockDatabase(join(directory, "dock.sqlite"));
    try { save(legacy, { kind: "note", title: "Separate legacy data" }); } finally { legacy.close(); }
    database = openLocalDatabase(directory);
    assert.equal(database.snapshot().items[0]!.title, "Current Rivnote data");
    const preserved = new DockDatabase(join(directory, "dock.sqlite"));
    try { assert.equal(preserved.snapshot().items[0]!.title, "Separate legacy data"); } finally { preserved.close(); }
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("branded database startup refuses a busy legacy checkpoint without creating a replacement", () => {
  assert.ok(process.env.DOCK_TEST_ROOT);
  const directory = mkdtempSync(join(process.env.DOCK_TEST_ROOT, "database-busy-"));
  const path = join(directory, "dock.sqlite");
  const writer = new DatabaseSync(path);
  let reader: DatabaseSync | undefined;
  try {
    writer.exec("PRAGMA journal_mode=WAL; CREATE TABLE fixture(value TEXT); INSERT INTO fixture VALUES('before')");
    reader = new DatabaseSync(path);
    reader.exec("BEGIN; SELECT * FROM fixture");
    writer.exec("INSERT INTO fixture VALUES('recent WAL write')");
    assert.throws(() => openLocalDatabase(directory), /database is busy/);
    assert.equal(existsSync(join(directory, appBrand.databaseFilename)), false);
    assert.equal(writer.prepare("SELECT COUNT(*) AS count FROM fixture").get()!.count, 2);
  } finally { reader?.close(); writer.close(); rmSync(directory, { recursive: true, force: true }); }
});
