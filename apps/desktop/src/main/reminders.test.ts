import assert from "node:assert/strict";
import { test } from "node:test";
import { commandSchema, nextOccurrence, settingsSchema } from "@dock/contracts";
import { DockDatabase } from "./database.ts";
import { checkReminders, isQuiet } from "./reminders.ts";

test("reminders dispatch once, retry if unavailable, and dispatch again after snooze", () => {
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
    checkReminders(database, () => false, now);
    assert.equal(database.due(now).length, 1);
    const notify = () => {
      dispatched++;
      return true;
    };
    checkReminders(database, notify, now);
    checkReminders(database, notify, now);
    assert.equal(dispatched, 1);
    database.execute({ type: "item.snooze", id: item.id, minutes: 10 }, now);
    checkReminders(database, notify, new Date("2026-10-08T12:09:00Z"));
    assert.equal(dispatched, 1);
    checkReminders(database, notify, new Date("2026-10-08T12:10:00Z"));
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
