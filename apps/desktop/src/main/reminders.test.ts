import assert from "node:assert/strict";
import { test } from "node:test";
import { commandSchema, itemInputSchema, nextOccurrence, settingsSchema, workspaceSchema } from "@dock/contracts";
import { randomUUID } from "node:crypto";
import { DockDatabase } from "./database.ts";
import { checkReminders, isQuiet, ReminderJournal } from "./reminders.ts";

test("reminders dispatch once, retry if unavailable, and dispatch again after snooze", async () => {
  const database = new DockDatabase(":memory:");
  const now = new Date("2026-10-08T12:00:00Z");
  try {
    const command = commandSchema.parse({
      type: "item.save",
      item: {
        kind: "task",
        title: "Remember this",
        scheduledAt: "2026-10-08T12:00:00Z",
      },
    });
    assert.equal(command.type, "item.save");
    const item = database.execute(command, now).items[0]!;
    let dispatched = 0;
    await checkReminders(database, () => false, now);
    assert.equal(database.due(now).length, 1);
    const notify = () => {
      dispatched++;
      return true;
    };
    await checkReminders(database, notify, now);
    await checkReminders(database, notify, now);
    assert.equal(dispatched, 1);
    database.execute({ type: "item.snooze", id: item.id, minutes: 10 }, now);
    await checkReminders(database, notify, new Date("2026-10-08T12:09:00Z"));
    assert.equal(dispatched, 1);
    await checkReminders(database, notify, new Date("2026-10-08T12:10:00Z"));
    assert.equal(dispatched, 2);
    database.execute({ type: "item.toggle", id: item.id }, now);
    assert.equal(database.due(new Date("2026-10-09T12:00:00Z")).length, 0);
  } finally {
    database.close();
  }
});

test("quiet hours cover midnight and monthly recurrence stays inside the next month", () => {
  const preferences = settingsSchema.parse({
    quietHours: true,
    quietStart: "22:00",
    quietEnd: "07:00",
  });
  assert.equal(isQuiet(preferences, new Date(2026, 9, 8, 23)), true);
  assert.equal(isQuiet(preferences, new Date(2026, 9, 9, 6)), true);
  assert.equal(isQuiet(preferences, new Date(2026, 9, 9, 7)), false);
  assert.equal(isQuiet(preferences, new Date(2026, 9, 9, 12)), false);
  const original = new Date(2027, 0, 31, 9).toISOString();
  const next = new Date(
    nextOccurrence(original, "monthly", new Date(2027, 0, 31, 10)),
  );
  assert.equal(next.getMonth(), 1);
  assert.equal(next.getDate(), 28);
  assert.equal(next.getHours(), 9);
});


test("multiple reminders await display acknowledgment and retry failures with backoff", async () => {
  const database = new DockDatabase(":memory:");
  const journal = new ReminderJournal();
  const now = new Date("2026-10-25T12:00:00Z");
  try {
    const result = database.execute({ type: "item.save", item: itemInputSchema.parse({
      kind: "task", title: "Two reminders", scheduledAt: "2026-10-25T13:00:00Z",
      task: { reminders: ["2026-10-25T11:00:00Z", "2026-10-25T12:00:00Z"] },
    }) }, now);
    let attempts = 0;
    await checkReminders(database, async () => { attempts++; return false; }, now, journal);
    assert.equal(attempts, 2);
    assert.ok(journal.entries().every(entry => entry.status === "failed" && entry.attempts === 1));
    await checkReminders(database, () => { attempts++; return true; }, now, journal);
    assert.equal(attempts, 2, "failed reminders wait for backoff");
    await checkReminders(database, async () => { attempts++; return true; }, new Date("2026-10-25T12:01:00Z"), journal);
    assert.equal(attempts, 4);
    assert.ok(journal.entries().every(entry => entry.status === "shown" && entry.attempts === 2));
    assert.equal(database.due(new Date("2026-10-25T13:00:00Z"))[0]?.id, result.items[0]?.id, "extra reminders do not acknowledge the scheduled reminder");
    await checkReminders(database, () => { attempts++; return true; }, new Date("2026-10-25T13:00:00Z"), journal);
    assert.equal(attempts, 5);
    await checkReminders(database, () => { attempts++; return true; }, new Date("2026-10-25T14:00:00Z"), journal);
    assert.equal(attempts, 5);
  } finally { database.close(); }
});

test("display confirmation for an old schedule cannot acknowledge a rescheduled reminder", async () => {
  const database = new DockDatabase(":memory:");
  const now = new Date("2026-10-25T12:00:00Z");
  try {
    const item = database.execute({ type: "item.save", item: itemInputSchema.parse({
      kind: "task", title: "Reschedule while displaying", scheduledAt: now.toISOString(),
    }) }, now).items[0]!;
    await checkReminders(database, async () => {
      database.execute({ type: "item.save", item: itemInputSchema.parse({
        ...item, expectedRevision: item.revision, scheduledAt: "2026-10-25T13:00:00Z",
      }) }, now);
      return true;
    }, now);
    assert.equal(database.due(new Date("2026-10-25T13:00:00Z")).length, 1);
  } finally { database.close(); }
});


test("unchanged reminder checks do not request a window update", async () => {
  const database = new DockDatabase(":memory:");
  const now = new Date("2026-10-26T12:00:00Z"), journal = new ReminderJournal();
  try {
    assert.equal(await checkReminders(database, () => true, now, journal), false);
    database.execute({ type: "item.save", item: itemInputSchema.parse({ kind: "task", title: "Due", scheduledAt: now.toISOString() }) }, now);
    assert.equal(await checkReminders(database, () => true, now, journal), true);
    assert.equal(await checkReminders(database, () => true, now, journal), false);
  } finally { database.close(); }
});

test("explicit reminders exclude completed, deleted and revoked tasks and return when access is restored", async () => {
  const database = new DockDatabase(":memory:");
  const now = new Date("2026-10-26T12:00:00Z");
  const project = workspaceSchema.parse({ projects: [{ id: randomUUID(), name: "Shared" }] }).projects[0]!;
  const save = (title: string, projectId: string | null = null) => database.execute({ type: "item.save", item: itemInputSchema.parse({
    kind: "task", title, task: { projectId, reminders: [now.toISOString()] },
  }) }, now).items.find(item => item.title === title)!;
  try {
    database.applySharedProjects([project], [project.id]);
    const open = save("Open"), completed = save("Completed"), deleted = save("Deleted"), shared = save("Shared", project.id);
    database.execute({ type: "item.complete", id: completed.id }, now);
    database.execute({ type: "item.delete", id: deleted.id }, now);
    database.applySharedProjects([], []);
    const shown: string[] = [];
    const journal = new ReminderJournal();
    const notify = (item: { id: string }) => { shown.push(item.id); return true; };
    await checkReminders(database, notify, now, journal);
    assert.deepEqual(shown, [open.id]);
    database.applySharedProjects([project], [project.id]);
    await checkReminders(database, notify, now, journal);
    assert.deepEqual(shown, [open.id, shared.id]);
  } finally { database.close(); }
});
