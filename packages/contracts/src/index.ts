import { z } from "zod";

export const spaceSchema = z.enum(["Inbox", "Work", "Personal"]);
export const recurrenceSchema = z.enum(["none", "daily", "weekly", "monthly"]);
const scheduledAtSchema = z.iso
  .datetime()
  .transform((value) => new Date(value).toISOString())
  .nullable();

export const itemInputSchema = z
  .object({
    id: z.uuid().optional(),
    expectedRevision: z.number().int().positive().optional(),
    kind: z.enum(["task", "note"]),
    title: z
      .string()
      .trim()
      .min(1, "Give this item a title.")
      .max(
        500,
        "Keep the title to 500 characters. Put extra details in the body.",
      ),
    body: z.string().max(200_000).default(""),
    space: spaceSchema.default("Inbox"),
    priority: z.boolean().default(false),
    scheduledAt: scheduledAtSchema.default(null),
    recurrence: recurrenceSchema.default("none"),
    linkedNoteId: z.uuid().nullable().default(null),
  })
  .superRefine((item, context) => {
    if (item.recurrence !== "none" && !item.scheduledAt) {
      context.addIssue({
        code: "custom",
        message: "Recurring tasks need a scheduled date.",
        path: ["scheduledAt"],
      });
    }
    if (
      item.kind === "note" &&
      (item.scheduledAt || item.recurrence !== "none" || item.linkedNoteId)
    ) {
      context.addIssue({
        code: "custom",
        message: "Scheduling and note links apply to tasks only.",
      });
    }
    if (item.id && !item.expectedRevision) {
      context.addIssue({
        code: "custom",
        message: "An existing item needs its revision.",
      });
    }
  });

export const itemSchema = z.object({
  id: z.uuid(),
  kind: z.enum(["task", "note"]),
  title: z.string(),
  body: z.string(),
  space: spaceSchema,
  priority: z.boolean(),
  done: z.boolean(),
  scheduledAt: scheduledAtSchema,
  recurrence: recurrenceSchema,
  linkedNoteId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  revision: z.number().int().positive(),
});

const clockSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const settingsSchema = z.object({
  theme: z.enum(["dark", "light"]).default("dark"),
  shortcut: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .default("CommandOrControl+Shift+Space"),
  closeToTray: z.boolean().default(true),
  launchAtLogin: z.boolean().default(false),
  quietHours: z.boolean().default(false),
  quietStart: clockSchema.default("22:00"),
  quietEnd: clockSchema.default("07:00"),
});

export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("snapshot") }),
  z.object({ type: z.literal("item.save"), item: itemInputSchema }),
  z.object({ type: z.literal("item.toggle"), id: z.uuid() }),
  z.object({ type: z.literal("item.complete"), id: z.uuid() }),
  z.object({ type: z.literal("item.priority"), id: z.uuid() }),
  z.object({ type: z.literal("item.delete"), id: z.uuid() }),
  z.object({ type: z.literal("item.restore"), id: z.uuid() }),
  z.object({
    type: z.literal("item.snooze"),
    id: z.uuid(),
    minutes: z.number().int().min(1).max(1440),
  }),
  z.object({ type: z.literal("settings.save"), settings: settingsSchema }),
  z.object({
    type: z.literal("window"),
    action: z.enum([
      "main",
      "capture",
      "mini",
      "hide",
      "minimize",
      "maximize",
      "close",
      "quit",
      "export",
      "test-notification",
    ]),
  }),
]);

export const snapshotSchema = z.object({
  items: z.array(itemSchema),
  settings: settingsSchema,
  system: z.object({
    platform: z.string(),
    version: z.string(),
    dataPath: z.string(),
    shortcutRegistered: z.boolean(),
    topmostSupported: z.boolean(),
    trayAvailable: z.boolean(),
    notificationsSupported: z.boolean(),
    launchAtLoginSupported: z.boolean(),
    notificationError: z.string(),
    miniOpen: z.boolean(),
  }),
});

export type Item = z.infer<typeof itemSchema>;
export type ItemInput = z.input<typeof itemInputSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type Command = z.infer<typeof commandSchema>;
export type DataCommand = Exclude<Command, { type: "window" }>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type StoreSnapshot = Pick<Snapshot, "items" | "settings">;
export type WindowRole = "main" | "capture" | "mini";

export function parseCommand(input: unknown): Command {
  const result = commandSchema.safeParse(input);
  if (!result.success)
    throw new Error(
      result.error.issues.map((issue) => issue.message).join(" "),
    );
  return result.data;
}

export interface DesktopBridge {
  dispatch(command: Command): Promise<Snapshot>;
  onChanged(listener: (snapshot: Snapshot) => void): () => void;
  onCapture(listener: () => void): () => void;
}

export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function dateTimeInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return `${localDate(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function nextOccurrence(
  value: string,
  recurrence: Exclude<Item["recurrence"], "none">,
  now: Date,
): string {
  const next = new Date(value);
  const day = next.getDate();
  do {
    if (recurrence === "monthly") {
      next.setDate(1);
      next.setMonth(next.getMonth() + 1);
      const lastDay = new Date(
        next.getFullYear(),
        next.getMonth() + 1,
        0,
      ).getDate();
      next.setDate(Math.min(day, lastDay));
    } else {
      next.setDate(next.getDate() + (recurrence === "weekly" ? 7 : 1));
    }
  } while (next <= now);
  return next.toISOString();
}
