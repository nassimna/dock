import type { Item, Settings } from "@dock/contracts";
import type { DockDatabase } from "./database.ts";

export function isQuiet(settings: Settings, now: Date): boolean {
  if (!settings.quietHours) return false;
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return settings.quietStart <= settings.quietEnd
    ? time >= settings.quietStart && time < settings.quietEnd
    : time >= settings.quietStart || time < settings.quietEnd;
}

export function checkReminders(
  database: DockDatabase,
  notify: (item: Item) => boolean,
  now = new Date(),
): void {
  if (isQuiet(database.snapshot().settings, now)) return;
  for (const item of database.due(now)) {
    if (notify(item)) database.markNotified(item.id, now);
  }
}
