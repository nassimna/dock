import * as Notifications from "expo-notifications";
import dayjs from "dayjs";
import { getSnapshot, notifyChanged } from "./database";
import { storage } from "./storage";

type Planned = {
  notificationId: string;
  itemId: string;
  title: string;
  at: string;
};
const PLAN_KEY = "reminders.plan.v1";
let fingerprint = "";
let pending = Promise.resolve();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export function reminderState(): { plans: Planned[]; error: string } {
  return {
    plans: Object.values(
      JSON.parse(storage.getString(PLAN_KEY) ?? "{}") as Record<
        string,
        Planned
      >,
    ),
    error: storage.getString("reminders.error") ?? "",
  };
}

export function reconcileReminders(force = false) {
  pending = pending
    .catch(() => {})
    .then(async () => {
      const { items, settings } = getSnapshot();
      const permission = await Notifications.getPermissionsAsync();
      const nextFingerprint = JSON.stringify([
        items.map((item) => [
          item.id,
          item.title,
          item.done,
          item.scheduledAt,
          item.task.reminders,
        ]),
        settings.quietHours,
        settings.quietStart,
        settings.quietEnd,
        permission.granted,
      ]);
      if (!force && nextFingerprint === fingerprint) return;
      fingerprint = nextFingerprint;
      if (!permission.granted) return;
      await Notifications.setNotificationChannelAsync("dock-reminders", {
        name: "Dock",
        importance: Notifications.AndroidImportance.HIGH,
      });
      const plans = JSON.parse(storage.getString(PLAN_KEY) ?? "{}") as Record<
        string,
        Planned
      >;
      let plansChanged = false;
      const wanted = new Map<
        string,
        { itemId: string; title: string; at: string }
      >();
      for (const item of items) {
        if (item.kind !== "task" || item.done) continue;
        const times = [
          ...new Set(
            [item.scheduledAt, ...item.task.reminders].filter(
              (value): value is string => !!value,
            ),
          ),
        ];
        for (const at of times) {
          let due = dayjs(at);
          if (settings.quietHours) {
            const [startHour, startMinute] = settings.quietStart
              .split(":")
              .map(Number);
            const [endHour, endMinute] = settings.quietEnd
              .split(":")
              .map(Number);
            const start = startHour! * 60 + startMinute!,
              end = endHour! * 60 + endMinute!,
              minute = due.hour() * 60 + due.minute();
            if (
              start <= end
                ? minute >= start && minute < end
                : minute >= start || minute < end
            ) {
              if (start >= end && minute >= start) due = due.add(1, "day");
              due = due.hour(endHour!).minute(endMinute!).second(0);
            }
          }
          if (!due.isAfter(dayjs())) continue;
          wanted.set(`${item.id}:${at}`, {
            itemId: item.id,
            title: item.title,
            at: due.toISOString(),
          });
        }
      }
      const scheduled = new Set(
        (await Notifications.getAllScheduledNotificationsAsync()).map(
          (value) => value.identifier,
        ),
      );
      for (const [key, plan] of Object.entries(plans)) {
        const target = wanted.get(key);
        if (
          !target ||
          target.at !== plan.at ||
          target.title !== plan.title ||
          !scheduled.has(plan.notificationId)
        ) {
          await Notifications.cancelScheduledNotificationAsync(
            plan.notificationId,
          );
          delete plans[key];
          storage.set(PLAN_KEY, JSON.stringify(plans));
          plansChanged = true;
        }
      }
      for (const [key, target] of wanted) {
        if (plans[key]) continue;
        const notificationId = await Notifications.scheduleNotificationAsync({
          identifier: `dock:${key}`,
          content: {
            title: "Dock",
            body: target.title,
            data: { itemId: target.itemId },
            sound: true,
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: dayjs(target.at).toDate(),
            channelId: "dock-reminders",
          },
        });
        plans[key] = { ...target, notificationId };
        storage.set(PLAN_KEY, JSON.stringify(plans));
        plansChanged = true;
      }
      if (storage.getString("reminders.error")) {
        storage.remove("reminders.error");
        plansChanged = true;
      }
      if (plansChanged) notifyChanged();
    })
    .catch((error) => {
      const message =
        error instanceof Error
          ? error.message
          : "Reminders could not be scheduled.";
      if (storage.getString("reminders.error") !== message) {
        storage.set("reminders.error", message);
        notifyChanged();
      }
      throw error;
    });
  return pending;
}

export async function enableReminders() {
  await Notifications.setNotificationChannelAsync("dock-reminders", {
    name: "Dock",
    importance: Notifications.AndroidImportance.HIGH,
  });
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error("notificationDenied");
  await reconcileReminders(true);
}
