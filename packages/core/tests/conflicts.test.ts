import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  commandSchema,
  itemInputSchema,
  syncMutationSchema,
} from "@dock/contracts";
import { DockDatabase } from "../src/database.ts";

const runtime = {
  randomUUID,
  sha256: (value: string) => createHash("sha256").update(value).digest(),
};
function fixture(kind: "note" | "task" = "note") {
  const sqlite = new DatabaseSync(":memory:");
  const db = new DockDatabase(sqlite, runtime);
  const item = db.execute({
    type: "item.save",
    item: itemInputSchema.parse({
      kind,
      title: "Shared item",
      body: "Initial body",
      task: { priority: 2 },
    }),
  }).items[0]!;
  const initial = db.pendingChanges()[0]!;
  db.acknowledgeSync(initial, 1);
  db.execute({
    type: "item.save",
    item: {
      ...item,
      expectedRevision: item.revision,
      body: "Saved offline body",
    },
  });
  db.applySync([
    { item: { ...initial.item, body: "Current server body" }, version: 2 },
  ]);
  const conflict = db.syncConflicts()[0]!;
  return { db, sqlite, conflict, initial };
}
function resolution(
  conflict: ReturnType<DockDatabase["syncConflicts"]>[number],
  choice: "original" | "copy" | "both",
) {
  return {
    type: "sync.resolve" as const,
    copyId: conflict.copy.id,
    choice,
    expectedRevision: conflict.copy.revision,
    expectedOriginalRevision: conflict.original?.revision ?? null,
  };
}

for (const choice of ["original", "copy", "both"] as const) {
  test(`conflict ${choice} preserves the chosen data and resolves on a second client`, () => {
    const { db, conflict, initial } = fixture(
      choice === "copy" ? "task" : "note",
    );
    const other = new DockDatabase(new DatabaseSync(":memory:"), runtime);
    try {
      assert.equal(conflict.original?.id, initial.item.id);
      const copyChange = db
        .pendingChanges()
        .find((entry) => entry.item.id === conflict.copy.id)!;
      assert.equal(
        syncMutationSchema.parse(copyChange).item.conflictOf,
        initial.item.id,
      );
      other.applySync([
        { item: { ...initial.item, body: "Current server body" }, version: 2 },
        { item: copyChange.item, version: 1 },
      ]);
      assert.equal(other.syncConflicts()[0]?.original?.id, initial.item.id);
      db.acknowledgeSync(copyChange, 1);
      db.execute(resolution(conflict, choice));
      const original = db
        .snapshot()
        .items.find((item) => item.id === initial.item.id)!;
      assert.equal(
        original.body,
        choice === "copy" ? "Saved offline body" : "Current server body",
      );
      assert.equal(original.task.priority, 2);
      assert.equal(
        db.snapshot().items.some((item) => item.id === conflict.copy.id),
        choice === "both",
      );
      if (choice !== "both")
        assert.equal(
          db
            .snapshot()
            .deletedItems.find((item) => item.id === conflict.copy.id)?.body,
          choice === "copy" ? "Current server body" : "Saved offline body",
        );
      const changes = db.pendingChanges();
      for (const change of changes)
        other.applySync([
          {
            item: syncMutationSchema.parse(change).item,
            version: change.baseVersion + 1,
          },
        ]);
      assert.equal(other.syncConflicts().length, 0);
      assert.deepEqual(
        other
          .snapshot()
          .items.map((item) => [item.id, item.body])
          .sort(),
        db
          .snapshot()
          .items.map((item) => [item.id, item.body])
          .sort(),
      );
      assert.equal(db.syncCounts().conflicts, 0);
      assert.equal(other.syncCounts().conflicts, 0);
    } finally {
      db.close();
      other.close();
    }
  });
}

test("a stale resolution changes neither version and linked work requires keeping both", () => {
  const { db, initial, conflict } = fixture("task");
  try {
    db.applySync([
      { item: { ...initial.item, body: "Newer server body" }, version: 3 },
    ]);
    const before = db.snapshot();
    assert.throws(
      () => db.execute(resolution(conflict, "copy")),
      /conflictChanged/,
    );
    assert.deepEqual(db.snapshot(), before);
    const current = db.syncConflicts()[0]!;
    db.execute({
      type: "item.save",
      item: itemInputSchema.parse({
        kind: "task",
        title: "Linked child",
        task: { parentId: current.copy.id },
      }),
    });
    assert.throws(
      () => db.execute(resolution(current, "original")),
      /conflictLinkedWork/,
    );
    db.execute(resolution(current, "both"));
    assert.equal(
      db.snapshot().items.find((item) => item.title === "Linked child")?.task
        .parentId,
      current.copy.id,
    );
  } finally {
    db.close();
  }
});

test("version5 upgrades preserve legacy copies without guessing their original", () => {
  const { db, sqlite, conflict } = fixture();
  try {
    sqlite.exec(
      "ALTER TABLE sync_conflicts DROP COLUMN original_id; PRAGMA user_version = 5",
    );
    const upgraded = new DockDatabase(sqlite, runtime);
    const legacy = upgraded.syncConflicts()[0]!;
    assert.equal(legacy.copy.id, conflict.copy.id);
    assert.equal(legacy.original, null);
    assert.throws(
      () => upgraded.execute(resolution(legacy, "copy")),
      /conflictOriginalMissing/,
    );
    upgraded.execute(resolution(legacy, "both"));
    assert.equal(upgraded.syncConflicts().length, 0);
    assert.equal(upgraded.snapshot().items.length, 2);
  } finally {
    db.close();
  }
});

test("edit versus deletion can restore the saved copy on the original identity", () => {
  const { db, conflict, initial } = fixture();
  try {
    db.applySync([
      {
        item: { ...initial.item, deletedAt: new Date().toISOString() },
        version: 3,
      },
    ]);
    const deleted = db
      .syncConflicts()
      .find((entry) => entry.copy.id === conflict.copy.id)!;
    assert.equal(deleted.originalDeleted, true);
    db.execute(resolution(deleted, "copy"));
    assert.equal(
      db.snapshot().items.find((item) => item.id === initial.item.id)?.body,
      "Saved offline body",
    );
    assert.equal(
      db.snapshot().deletedItems.some((item) => item.id === initial.item.id),
      false,
    );
  } finally {
    db.close();
  }
});

test("using a saved copy does not repeat a reminder whose schedule is unchanged", () => {
  const { db, sqlite, conflict } = fixture("task");
  try {
    const scheduledAt = "2026-10-28T08:00:00.000Z";
    const notifiedAt = "2026-10-28T08:01:00.000Z";
    sqlite
      .prepare("UPDATE items SET scheduled_at = ? WHERE id IN (?, ?)")
      .run(scheduledAt, conflict.original!.id, conflict.copy.id);
    db.markNotified(conflict.original!.id, new Date(notifiedAt));
    const current = db.syncConflicts()[0]!;
    db.execute(resolution(current, "copy"));
    assert.equal(
      sqlite
        .prepare("SELECT notified_at FROM items WHERE id = ?")
        .get(current.original!.id)!.notified_at,
      notifiedAt,
    );
    assert.equal(db.due(new Date("2026-10-28T09:00:00.000Z")).length, 0);
  } finally {
    db.close();
  }
});

for (const metadata of ["current", "saved"] as const) {
  test(`manual merge preserves both originals, rich text and ${metadata} details across sync`, () => {
    const { db, initial, conflict } = fixture(
      metadata === "current" ? "note" : "task",
    );
    const other = new DockDatabase(new DatabaseSync(":memory:"), runtime);
    try {
      db.execute({
        type: "item.save",
        item: {
          ...conflict.copy,
          expectedRevision: conflict.copy.revision,
          task: { ...conflict.copy.task, priority: 1 },
        },
      });
      const current = db.syncConflicts()[0]!;
      const copyChange = db
        .pendingChanges()
        .find((change) => change.item.id === current.copy.id)!;
      other.applySync([
        { item: { ...initial.item, body: "Current server body" }, version: 2 },
        { item: copyChange.item, version: 1 },
      ]);
      db.acknowledgeSync(copyChange, 1);
      const body =
        '# Merged plan\n\n<aside data-type="callout"><p>Both ideas محفوظة</p></aside>';
      db.execute(
        commandSchema.parse({
          ...resolution(current, "both"),
          choice: "merge",
          merged: { title: "Combined result", body, metadata },
        }),
      );
      const merged = db
        .snapshot()
        .items.find((item) => item.id === initial.item.id)!;
      assert.equal(merged.title, "Combined result");
      assert.equal(merged.body, body);
      assert.equal(merged.task.priority, metadata === "saved" ? 1 : 2);
      assert.deepEqual(
        db
          .snapshot()
          .deletedItems.map((item) => item.body)
          .sort(),
        ["Current server body", "Saved offline body"].sort(),
      );
      for (const change of db.pendingChanges())
        other.applySync([
          {
            item: syncMutationSchema.parse(change).item,
            version: change.baseVersion + 1,
          },
        ]);
      assert.equal(
        other.snapshot().items.find((item) => item.id === initial.item.id)
          ?.body,
        body,
      );
      assert.deepEqual(
        other
          .snapshot()
          .deletedItems.map((item) => item.body)
          .sort(),
        ["Current server body", "Saved offline body"].sort(),
      );
      assert.equal(other.syncConflicts().length, 0);
    } finally {
      db.close();
      other.close();
    }
  });
}

test("invalid and stale manual merges do not change either version or create archives", () => {
  const { db, initial, conflict } = fixture();
  try {
    const input = {
      ...resolution(conflict, "both"),
      choice: "merge",
      merged: {
        title: "Manual result",
        body: "Combined draft",
        metadata: "current",
      },
    };
    assert.equal(
      commandSchema.safeParse({ ...input, merged: undefined }).success,
      false,
    );
    assert.equal(
      commandSchema.safeParse({
        ...input,
        merged: { ...input.merged, title: " " },
      }).success,
      false,
    );
    db.applySync([
      { item: { ...initial.item, body: "A newer edit" }, version: 3 },
    ]);
    const before = db.snapshot();
    assert.throws(
      () => db.execute(commandSchema.parse(input)),
      /conflictChanged/,
    );
    assert.deepEqual(db.snapshot(), before);
    assert.equal(db.snapshot().deletedItems.length, 0);
  } finally {
    db.close();
  }
});

test("a failed merge rolls back the result, archives and conflict marker together", () => {
  const { db, sqlite, conflict } = fixture();
  try {
    sqlite.exec(`CREATE TRIGGER reject_merge_delete BEFORE UPDATE OF deleted_at ON items
      WHEN OLD.id = '${conflict.copy.id}' BEGIN SELECT RAISE(ABORT, 'task-owned simulated write failure'); END`);
    const before = db.snapshot();
    assert.throws(
      () =>
        db.execute(
          commandSchema.parse({
            ...resolution(conflict, "both"),
            choice: "merge",
            merged: {
              title: "Combined",
              body: "Combined body",
              metadata: "current",
            },
          }),
        ),
      /simulated write failure/,
    );
    assert.deepEqual(db.snapshot(), before);
    assert.equal(db.syncConflicts().length, 1);
    assert.equal(db.snapshot().deletedItems.length, 0);
  } finally {
    db.close();
  }
});
