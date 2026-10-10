import { z } from "zod";

export const spaceSchema = z.enum(["Inbox", "Work", "Personal"]);
export const recurrenceSchema = z.enum(["none", "daily", "weekly", "monthly"]);
const scheduledAtSchema = z.iso
  .datetime()
  .transform((value) => new Date(value).toISOString())
  .nullable();

export const noteStyleSchema = z.object({
  font: z.enum(["system", "serif", "mono"]).optional(),
  size: z.union([z.literal(14), z.literal(16), z.literal(18)]).optional(),
  fullWidth: z.boolean().optional(),
});
const tagsSchema = z.array(z.string().trim().min(1).max(40)).max(30)
  .transform(tags => [...new Set(tags)]);

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
    tags: tagsSchema.optional(),
    noteStyle: noteStyleSchema.optional(),
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
  tags: tagsSchema.default([]),
  noteStyle: noteStyleSchema.default({}),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  revision: z.number().int().positive(),
});

const clockSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const colorSchema = z.string().regex(/^#[0-9a-f]{6}$/i, "Use a six-digit hex color, such as #5264d8.");
const themeColorsSchema = z.object({
  background: colorSchema.optional(),
  card: colorSchema.optional(),
  foreground: colorSchema.optional(),
  mutedForeground: colorSchema.optional(),
  border: colorSchema.optional(),
  primary: colorSchema.optional(),
});
export const settingsSchema = z.object({
  theme: z.enum(["dark", "light"]).default("dark"),
  uiPreset: z.enum(["ink", "precision", "native", "studio"]).default("ink"),
  colorPreset: z.enum(["Graphite", "Forest", "Violet"]).default("Violet"),
  rounding: z.enum(["square", "subtle", "balanced", "rounded"]).default("subtle"),
  themeColors: z.object({
    dark: themeColorsSchema.default({}),
    light: themeColorsSchema.default({}),
  }).default({ dark: {}, light: {} }),
  density: z.enum(["compact", "comfortable"]).default("compact"),
  noteFont: z.enum(["system", "serif", "mono"]).default("system"),
  noteSize: z.union([z.literal(14), z.literal(16), z.literal(18)]).default(16),
  shortcut: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .default("CommandOrControl+Shift+Space"),
  closeToTray: z.boolean().default(true),
  capturePinned: z.boolean().default(true),
  launchAtLogin: z.boolean().default(false),
  quietHours: z.boolean().default(false),
  quietStart: clockSchema.default("22:00"),
  quietEnd: clockSchema.default("07:00"),
});

export const syncTokenSchema = z.string().regex(/^[0-9a-f-]{36}\.[0-9a-f]{64}$/)
  .refine((token) => z.uuid().safeParse(token.split(".")[0]).success);
export const syncLoginSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  password: z.string().min(12, "Use at least 12 characters for your password.").max(128),
});
export const syncSignupSchema = syncLoginSchema.extend({
  inviteCode: z.string().min(1).max(256),
});
export const syncSessionSchema = z.object({
  accountId: z.uuid(),
  email: z.email(),
  token: syncTokenSchema,
  expiresAt: z.iso.datetime(),
});

export const syncEndpointSchema = z.url().superRefine((value, context) => {
  const url = new URL(value);
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    context.addIssue({ code: "custom", message: "Use an HTTPS server address (HTTP is allowed only on localhost)." });
  }
}).transform((value) => new URL(value).origin);

export const syncCredentialsSchema = syncSessionSchema.extend({ endpoint: syncEndpointSchema });
export type SyncCredentials = z.infer<typeof syncCredentialsSchema>;

export const syncItemSchema = itemSchema.omit({ revision: true }).extend({
  deletedAt: z.iso.datetime().nullable(),
  recurrenceSourceId: z.uuid().nullable(),
}).superRefine((item, context) => {
  const result = itemInputSchema.safeParse({ ...item, id: undefined });
  if (!result.success)
    for (const issue of result.error.issues) context.addIssue({ ...issue, code: "custom" });
  if (item.id === item.linkedNoteId || item.id === item.recurrenceSourceId)
    context.addIssue({ code: "custom", message: "An item cannot link to itself." });
});
export const syncRecordSchema = z.object({
  item: syncItemSchema,
  version: z.number().int().positive(),
});
export const syncMutationSchema = z.object({
  mutationId: z.string().regex(/^[0-9a-f]{32}$/),
  baseVersion: z.number().int().nonnegative(),
  item: syncItemSchema,
});
export const syncPushResultSchema = z.object({
  accepted: z.boolean(),
  version: z.number().int().nonnegative(),
  current: syncRecordSchema,
});
export const syncPullResultSchema = z.object({
  changes: z.array(syncRecordSchema.extend({ sequence: z.number().int().positive() })).max(100),
  cursor: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});
export const syncStatusSchema = z.object({
  connected: z.boolean(),
  endpoint: z.string(),
  email: z.string(),
  phase: z.enum(["disconnected", "pending", "syncing", "synced", "offline", "error"]),
  pending: z.number().int().nonnegative(),
  conflicts: z.number().int().nonnegative(),
  lastSyncedAt: z.iso.datetime().nullable(),
  error: z.string(),
});
export type SyncItem = z.infer<typeof syncItemSchema>;
export type SyncRecord = z.infer<typeof syncRecordSchema>;
export type SyncMutation = z.infer<typeof syncMutationSchema>;
export type SyncStatus = z.infer<typeof syncStatusSchema>;

export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("snapshot") }),
  z.object({ type: z.literal("capture.resize"), height: z.number().int().min(180).max(600) }),
  syncLoginSchema.extend({ type: z.literal("sync.login"), endpoint: syncEndpointSchema }),
  syncSignupSchema.extend({ type: z.literal("sync.signup"), endpoint: syncEndpointSchema }),
  z.object({ type: z.literal("sync.now") }),
  z.object({ type: z.literal("sync.disconnect") }),
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
  sync: syncStatusSchema,
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
export type DataCommand = Exclude<Command, { type: "window" | "capture.resize" | "sync.login" | "sync.signup" | "sync.now" | "sync.disconnect" }>;
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
