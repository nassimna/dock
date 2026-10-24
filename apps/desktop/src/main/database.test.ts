import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { commandSchema, type ItemInput } from "@dock/contracts";
import { DockDatabase } from "./database.ts";

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
