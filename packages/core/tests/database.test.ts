import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { commandSchema } from "@dock/contracts";
import { DockDatabase } from "../src/database.ts";

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
