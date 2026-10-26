import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { reminderLogSchema, type Item, type ReminderLog, type Settings } from "@dock/contracts";
import type { DockDatabase } from "./database.ts";

export function isQuiet(settings: Settings, now: Date): boolean {
  if (!settings.quietHours) return false;
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return settings.quietStart <= settings.quietEnd
    ? time >= settings.quietStart && time < settings.quietEnd
    : time >= settings.quietStart || time < settings.quietEnd;
}

export class ReminderJournal {
  private readonly records = new Map<string, ReminderLog>();
  private readonly filename: string | undefined;
  constructor(filename?: string) {
    this.filename = filename;
    if (filename && existsSync(filename)) {
      for (const entry of reminderLogSchema.array().parse(JSON.parse(readFileSync(filename, "utf8")))) this.records.set(entry.key, entry);
    }
  }

  entries(): ReminderLog[] {
    return [...this.records.values()].sort((a, b) => b.lastAttemptAt.localeCompare(a.lastAttemptAt)).slice(0, 200);
  }

  get(key: string): ReminderLog | undefined { return this.records.get(key); }

  put(entry: ReminderLog): void {
    this.records.set(entry.key, entry);
    if (this.filename) {
      writeFileSync(`${this.filename}.tmp`, JSON.stringify([...this.records.values()]), { mode: 0o600 });
      renameSync(`${this.filename}.tmp`, this.filename);
    }
  }

  retry(key: string): void {
    const record = this.records.get(key);
    if (!record || record.status !== "failed") throw new Error("Choose a failed reminder to retry.");
    this.put({ ...record, attempts: 0, nextAttemptAt: new Date().toISOString(), error: "" });
  }
}

export async function checkReminders(
  database: DockDatabase,
  notify: (item: Item) => boolean | Promise<boolean>,
  now = new Date(),
  journal = new ReminderJournal(),
): Promise<void> {
  if (isQuiet(database.snapshot().settings, now)) return;
  const scheduled = database.due(now);
  const events = scheduled.map(item => ({ item, dueAt: item.scheduledAt! }));
  for (const item of database.snapshot().items) {
    if (item.kind !== "task" || item.done) continue;
    for (const reminder of item.task.reminders) {
      const dueAt = new Date(reminder).toISOString();
      if (dueAt <= now.toISOString() && !events.some(event => event.item.id === item.id && event.dueAt === dueAt)) events.push({ item, dueAt });
    }
  }
  for (const { item, dueAt } of events) {
    const key = `${item.id}:${dueAt}`;
    const previous = journal.get(key);
    if (previous?.status === "pending" && previous.attempts >= 3 && previous.nextAttemptAt && previous.nextAttemptAt <= now.toISOString())
      journal.put({ ...previous, status: "failed", nextAttemptAt: null, error: "Dock stopped before display was confirmed. Retry this reminder manually." });
    if (previous?.status === "shown" || (previous?.attempts ?? 0) >= 3 ||
        (previous?.nextAttemptAt && previous.nextAttemptAt > now.toISOString())) continue;
    const entry: ReminderLog = {
      key, itemId: item.id, title: item.title, dueAt, status: "pending", attempts: (previous?.attempts ?? 0) + 1,
      lastAttemptAt: now.toISOString(), nextAttemptAt: new Date(now.getTime() + 120_000).toISOString(), error: "",
    };
    journal.put(entry);
    try {
      if (!await notify(item)) throw new Error("The operating system did not confirm displaying the notification. Check notification permissions.");
      journal.put({ ...entry, status: "shown", nextAttemptAt: null });
      if (item.scheduledAt === dueAt) database.markNotified(item.id, now, dueAt);
    } catch (error) {
      journal.put({ ...entry, status: "failed", nextAttemptAt: entry.attempts < 3 ? new Date(now.getTime() + (entry.attempts === 1 ? 60_000 : 300_000)).toISOString() : null,
        error: error instanceof Error ? error.message : "Notification could not be displayed." });
    }
  }
}
