import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { beforeEach, after, afterEach, mock, test } from "node:test";
import { DockDatabase } from "@dock/core/database";
import type { DataCommand } from "@dock/contracts";

const parent = resolve("../../.validation");
mkdirSync(parent, { recursive: true });
const root = mkdtempSync(join(parent, "mobile-api-"));
let database: DockDatabase;
let filename: string;
const runtime = {
  randomUUID,
  sha256: (value: string) =>
    new Uint8Array(createHash("sha256").update(value).digest()),
};
mock.module("../../../lib/database.ts", {
  namedExports: { getSnapshot: () => database.snapshot() },
});
mock.module("../../../lib/actions.ts", {
  namedExports: {
    execute: (command: DataCommand) => database.execute(command),
  },
});
const { listItems, saveItem, setTaskDone } = await import("./items.ts");
beforeEach(() => {
  filename = join(root, randomUUID() + ".sqlite");
  database = new DockDatabase(new DatabaseSync(filename), runtime);
});
afterEach(() => database.close());
after(() => rmSync(root, { recursive: true, force: true }));

test("tasks and rich notes preserve priority and metadata across edits and SQLite reopening", () => {
  const task = saveItem({
    kind: "task",
    title: "  Prepare mobile handoff  ",
    body: "Check capture",
    task: { priority: 2 },
  });
  const note = saveItem({
    kind: "note",
    title: "Rich note",
    body: '<aside data-type="callout" data-emoji="💡"><p>Keep this</p></aside>',
  });
  const edited = saveItem({
    ...task,
    expectedRevision: task.revision,
    title: "Ready for review",
  });
  assert.equal(task.title, "Prepare mobile handoff");
  assert.equal(edited.task.priority, 2);
  assert.equal(edited.body, "Check capture");
  assert.equal(edited.createdAt, task.createdAt);
  database.close();
  database = new DockDatabase(new DatabaseSync(filename), runtime);
  assert.equal(
    listItems().find((item) => item.id === note.id)?.body,
    note.body,
  );
  assert.equal(
    listItems().find((item) => item.id === task.id)?.title,
    "Ready for review",
  );
});

test("completion cascades to subtasks and creates one deterministic recurring follow-up", () => {
  const parent = saveItem({
    kind: "task",
    title: "Daily review",
    scheduledAt: "2026-10-26T09:00:00.000Z",
    recurrence: "daily",
  });
  const child = saveItem({
    kind: "task",
    title: "Review notes",
    task: { parentId: parent.id },
  });
  const done = setTaskDone({
    id: parent.id,
    revision: parent.revision,
    done: true,
  });
  assert.equal(done.done, true);
  assert.equal(listItems().find((item) => item.id === child.id)?.done, true);
  const followUp = listItems().find(
    (item) => item.id !== parent.id && item.id !== child.id,
  )!;
  assert.equal(followUp.title, parent.title);
  assert.equal(followUp.done, false);
  const reopened = setTaskDone({
    id: done.id,
    revision: done.revision,
    done: false,
  });
  setTaskDone({ id: reopened.id, revision: reopened.revision, done: true });
  assert.equal(listItems().length, 3);
  assert.equal(
    listItems().find((item) => item.id === followUp.id)?.done,
    false,
  );
});

test("invalid input and stale edits/toggles never replace newer saved content", () => {
  const item = saveItem({ kind: "task", title: "Original" });
  saveItem({ ...item, expectedRevision: item.revision, title: "Latest" });
  assert.throws(() => saveItem({ kind: "note", title: "   " }));
  assert.throws(() =>
    saveItem({ ...item, expectedRevision: item.revision, title: "Stale" }),
  );
  assert.throws(
    () => setTaskDone({ id: item.id, revision: item.revision, done: true }),
    /staleItem/,
  );
  assert.equal(listItems()[0]?.title, "Latest");
});

test("saving quick capture directly parses date, priority and labels without requiring blur", () => {
  const item = saveItem({
    kind: "task",
    title: "Call Alex tomorrow p2 @phone",
  });
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(23, 59, 0, 0);
  assert.equal(item.title, "Call Alex");
  assert.equal(item.task.priority, 2);
  assert.equal(item.scheduledAt, tomorrow.toISOString());
  assert.deepEqual(item.tags, ["phone"]);
  const edited = saveItem({
    ...item,
    expectedRevision: item.revision,
    title: "Keep p3 literal on edit",
  });
  assert.equal(edited.title, "Keep p3 literal on edit");
  assert.equal(edited.task.priority, 2);
});
