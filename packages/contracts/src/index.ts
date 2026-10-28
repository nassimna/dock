import { z } from "zod";
import { localServiceCommands, localServicesSchema } from "./local-services.ts";
import { syncFeatureCommandSchemas, syncFeaturesSchema, projectSchema, type SyncFeatureCommand } from "./sync-features.ts";
export * from "./local-services.ts";
export * from "./sync-features.ts";

export const appBrand = {
  name: "Rivnote",
  arabicName: "ريفنوت",
  tagline: "Your notes. Your next step.",
  databaseFilename: "rivnote.sqlite",
  syncEndpoint: "https://rivnote-sync.najjarnassim1995.workers.dev",
} as const;

export const spaceSchema = z.enum(["Inbox", "Work", "Personal"]);
export const recurrenceSchema = z.enum(["none", "daily", "weekly", "monthly", "weekdays", "custom"]);
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

export const taskPropertiesSchema = z.object({
  priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(4),
  projectId: z.uuid().nullable().default(null),
  sectionId: z.uuid().nullable().default(null),
  parentId: z.uuid().nullable().default(null),
  deadline: scheduledAtSchema.default(null),
  durationMinutes: z.number().int().min(1).max(1440).default(30),
  reminders: z.array(z.iso.datetime()).max(20).default([]),
  repeat: z.object({
    interval: z.number().int().min(1).max(365).default(1),
    unit: z.enum(["day", "week", "month"]).default("day"),
    afterCompletion: z.boolean().default(false),
  }).default({ interval: 1, unit: "day", afterCompletion: false }),
  comments: z.array(z.object({
    id: z.uuid(),
    body: z.string().trim().max(20_000),
    createdAt: z.iso.datetime(),
    attachments: z.array(z.object({
      id: z.uuid(), name: z.string().min(1).max(255), path: z.string().min(1).max(4096),
      size: z.number().int().nonnegative(),
    })).max(20).default([]),
  })).max(500).default([]),
  assignee: z.string().trim().max(254).default(""),
  order: z.number().default(0),
});
const taskPatchSchema = z.object({
  priority: taskPropertiesSchema.shape.priority.unwrap().optional(),
  projectId: taskPropertiesSchema.shape.projectId.unwrap().optional(),
  sectionId: taskPropertiesSchema.shape.sectionId.unwrap().optional(),
  parentId: taskPropertiesSchema.shape.parentId.unwrap().optional(),
  deadline: taskPropertiesSchema.shape.deadline.unwrap().optional(),
  durationMinutes: taskPropertiesSchema.shape.durationMinutes.unwrap().optional(),
  reminders: taskPropertiesSchema.shape.reminders.unwrap().optional(),
  repeat: taskPropertiesSchema.shape.repeat.unwrap().optional(),
  comments: taskPropertiesSchema.shape.comments.unwrap().optional(),
  assignee: taskPropertiesSchema.shape.assignee.unwrap().optional(),
  order: taskPropertiesSchema.shape.order.unwrap().optional(),
});
export const taskSchema = taskPropertiesSchema;
export type TaskProperties = z.infer<typeof taskPropertiesSchema>;

export const workspaceSchema = z.object({
  projects: z.array(projectSchema).max(500).default([]),
  filters: z.array(z.object({ id: z.uuid(), name: z.string().trim().min(1).max(100),
    query: z.string().trim().min(1).max(1000), favorite: z.boolean().default(false) })).max(100).default([]),
  labels: tagsSchema.default([]),
  templates: z.array(z.object({ id: z.uuid(), name: z.string().trim().min(1).max(100),
    tasks: z.array(z.object({ title: z.string().trim().min(1).max(500), body: z.string().max(200_000).default(""),
      task: taskPropertiesSchema.optional(), tags: tagsSchema.optional(), recurrence: recurrenceSchema.optional(),
      scheduledAt: scheduledAtSchema.optional() })).min(1).max(100) })).max(100).default([]),
  goals: z.object({ daily: z.number().int().min(1).max(1000).default(5),
    weekly: z.number().int().min(1).max(7000).default(25), vacation: z.boolean().default(false),
    vacationPeriods: z.array(z.object({ start: z.iso.date(), end: z.iso.date().nullable() })).max(500).default([]),
  }).default({ daily: 5, weekly: 25, vacation: false, vacationPeriods: [] }),
}).superRefine((workspace, context) => {
  for (const entries of [workspace.projects, workspace.filters, workspace.templates]) {
    if (new Set(entries.map(entry => entry.id)).size !== entries.length)
      context.addIssue({ code: "custom", message: "Workspace IDs must be unique." });
  }
  const projects = new Map(workspace.projects.map(project => [project.id, project]));
  for (const project of workspace.projects) {
    if (new Set(project.sections.map(section => section.id)).size !== project.sections.length)
      context.addIssue({ code: "custom", message: "Section IDs must be unique." });
    const visited = new Set([project.id]);
    let parentId = project.parentId;
    while (parentId) {
      if (visited.has(parentId) || !projects.has(parentId)) {
        context.addIssue({ code: "custom", message: "Projects need an existing parent without a cycle." });
        break;
      }
      visited.add(parentId);
      parentId = projects.get(parentId)!.parentId;
    }
  }
});
export type Project = z.infer<typeof projectSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;

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
    task: taskPropertiesSchema.optional(),
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
  task: taskPropertiesSchema.default(() => taskPropertiesSchema.parse({})),
  completedAt: scheduledAtSchema.default(null),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  revision: z.number().int().positive(),
});

export const backupSchema = z.object({
  items: z.array(z.preprocess(value => {
    if (!value || typeof value !== "object") return value;
    const item = value as Record<string, unknown>;
    return { ...item, task: item.task ?? { priority: item.priority ? 1 : 4 },
      completedAt: item.completedAt ?? (item.done ? item.updatedAt : null) };
  }, itemSchema.extend({ recurrenceSourceId: z.uuid().nullable().default(null) }))).max(100_000),
  workspace: workspaceSchema.optional(),
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
export const floatingStyleSchema = z.object({
  size: z.number().int().min(28).max(72).default(36),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).default("#2563eb"),
  opacity: z.number().min(0.3).max(1).default(1),
  shape: z.enum(["circle", "rounded", "square"]).default("circle"),
  showCount: z.boolean().default(true),
  showHandle: z.boolean().default(false),
  locked: z.boolean().default(false),
  persistent: z.boolean().default(true),
});
export type FloatingStyle = z.infer<typeof floatingStyleSchema>;

export const settingsSchema = z.object({
  theme: z.enum(["dark", "light"]).default("dark"),
  uiPreset: z.enum(["ink", "precision", "native", "studio"]).default("ink"),
  colorPreset: z.enum(["River", "Graphite", "Forest", "Violet"]).default("River"),
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
  miniPinned: z.boolean().default(true),
  launchAtLogin: z.boolean().default(false),
  openMiniAtStartup: z.boolean().default(false),
  floatingAtStartup: z.boolean().default(true),
  floating: floatingStyleSchema.default(() => floatingStyleSchema.parse({})),
  rememberLastView: z.boolean().default(false),
  automaticUpdates: z.boolean().default(true),
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
export const syncSignupSchema = syncLoginSchema;
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
}).transform((value) => {
  const endpoint = new URL(value).origin;
  return endpoint === "https://dock-sync.jood-b3d.workers.dev"
    ? appBrand.syncEndpoint
    : endpoint;
});

export const syncCredentialsSchema = syncSessionSchema.extend({ endpoint: syncEndpointSchema });
export type SyncCredentials = z.infer<typeof syncCredentialsSchema>;

const syncItemObjectSchema = itemSchema.omit({ revision: true }).extend({
  deletedAt: z.iso.datetime().nullable(),
  recurrenceSourceId: z.uuid().nullable(),
  conflictOf: z.uuid().nullable().optional(),
}).superRefine((item, context) => {
  const result = itemInputSchema.safeParse({ ...item, id: undefined });
  if (!result.success)
    for (const issue of result.error.issues) context.addIssue({ ...issue, code: "custom" });
  if (item.id === item.linkedNoteId || item.id === item.recurrenceSourceId || item.id === item.task.parentId || item.id === item.conflictOf)
    context.addIssue({ code: "custom", message: "An item cannot link to itself." });
});
export const syncItemSchema = z.preprocess(value => {
  if (!value || typeof value !== "object") return value;
  const item = value as Record<string, unknown>;
  return { ...item, task: item.task ?? { priority: item.priority ? 1 : 4 },
    completedAt: item.completedAt ?? (item.done ? item.updatedAt : null) };
}, syncItemObjectSchema);
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

export const updateStateSchema = z.object({
  status: z.enum(["unavailable", "idle", "checking", "current", "available", "downloading", "ready", "installing", "error"]),
  version: z.string().default(""),
  progress: z.number().min(0).max(100).default(0),
  message: z.string().default(""),
  retry: z.enum(["check", "download", "install"]).default("check"),
});
export type UpdateState = z.infer<typeof updateStateSchema>;

export const undoStateSchema = z.object({
  token: z.uuid(),
  action: z.enum(["complete", "delete"]),
  count: z.number().int().positive(),
}).nullable().default(null);
export type UndoState = z.infer<typeof undoStateSchema>;

export const conflictMergeSchema = z.object({
  title: z.string().trim().min(1).max(500),
  body: z.string().max(200_000),
  metadata: z.enum(["current", "saved"]),
});

export const commandSchema = z.discriminatedUnion("type", [
  ...localServiceCommands,
  ...syncFeatureCommandSchemas,
  z.object({ type: z.literal("snapshot") }),
  z.object({ type: z.literal("capture.resize"), height: z.number().int().min(180).max(600) }),
  z.object({ type: z.literal("update"), action: z.enum(["check", "download", "install"]) }),
  syncLoginSchema.extend({ type: z.literal("sync.login"), endpoint: syncEndpointSchema }),
  syncSignupSchema.extend({ type: z.literal("sync.signup"), endpoint: syncEndpointSchema }),
  z.object({ type: z.literal("sync.now") }),
  z.object({ type: z.literal("sync.disconnect") }),
  z.object({
    type: z.literal("sync.resolve"),
    copyId: z.uuid(),
    choice: z.enum(["original", "copy", "both", "merge"]),
    merged: conflictMergeSchema.optional(),
    expectedRevision: z.number().int().positive(),
    expectedOriginalRevision: z.number().int().positive().nullable(),
  }).superRefine((command, context) => {
    if (command.choice === "merge" && !command.merged)
      context.addIssue({ code: "custom", path: ["merged"], message: "Add a merged result before resolving." });
  }),
  z.object({ type: z.literal("item.save"), item: itemInputSchema }),
  z.object({ type: z.literal("item.reorder"), projectId: z.uuid(), sectionId: z.uuid().nullable(),
    ids: z.array(z.uuid()).min(1).max(10000).refine(ids => new Set(ids).size === ids.length, "Each task may appear only once."),
    expectedRevisions: z.record(z.string(), z.number().int().positive()),
  }),
  z.object({ type: z.literal("item.toggle"), id: z.uuid() }),
  z.object({ type: z.literal("item.complete"), id: z.uuid() }),
  z.object({ type: z.literal("item.priority"), id: z.uuid() }),
  z.object({ type: z.literal("item.delete"), id: z.uuid() }),
  z.object({ type: z.literal("item.restore"), id: z.uuid() }),
  z.object({ type: z.literal("item.purge"), id: z.uuid().optional() }),
  z.object({ type: z.literal("item.undo"), token: z.uuid() }),
  z.object({
    type: z.literal("item.snooze"),
    id: z.uuid(),
    minutes: z.number().int().min(1).max(1440),
  }),
  z.object({ type: z.literal("settings.save"), settings: settingsSchema }),
  z.object({ type: z.literal("workspace.save"), workspace: workspaceSchema }),
  z.object({ type: z.literal("template.apply"), id: z.uuid(), projectId: z.uuid().nullable().default(null) }),
  z.object({ type: z.literal("item.bulk"), ids: z.array(z.uuid()).min(1).max(1000),
    action: z.enum(["complete", "delete", "update"]),
    expectedRevisions: z.record(z.string(), z.number().int().positive()).optional(),
    patch: z.object({ task: taskPatchSchema.optional(), tags: tagsSchema.optional(),
      scheduledAt: scheduledAtSchema.optional(), space: spaceSchema.optional() }).optional(),
  }),
  z.object({
    type: z.literal("window"),
    view: z.enum(["today", "all", "starred", "settings"]).optional(),
    action: z.enum([
      "main",
      "capture",
      "mini",
      "floating",
      "floating-reset",
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

export const syncConflictSchema = z.object({
  copy: itemSchema,
  original: itemSchema.nullable(),
  originalDeleted: z.boolean(),
});

export const snapshotSchema = z.object({
  undo: undoStateSchema,
  items: z.array(itemSchema),
  settings: settingsSchema,
  workspace: workspaceSchema,
  deletedItems: z.array(itemSchema.extend({ deletedAt: z.iso.datetime() })),
  localServices: localServicesSchema,
  syncFeatures: syncFeaturesSchema,
  sync: syncStatusSchema,
  syncConflicts: z.array(syncConflictSchema).default([]),
  update: updateStateSchema,
  system: z.object({
    name: z.string().default(appBrand.name),
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
export type DataCommand = Exclude<Command, { type: "window" | "update" | "capture.resize" | "sync.login" | "sync.signup" | "sync.now" | "sync.disconnect" | "backup.create" | "backup.restore" | "backup.import" | "attachment.add" | "attachment.open" | "reminder.retry" } | SyncFeatureCommand>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type StoreSnapshot = Pick<Snapshot, "items" | "settings" | "workspace" | "deletedItems" | "undo">;
export type WindowRole = "main" | "capture" | "mini" | "floating";

export function parseCommand(input: unknown): Command {
  const result = commandSchema.safeParse(input);
  if (!result.success)
    throw new Error(
      result.error.issues.map((issue) => issue.message).join(" "),
    );
  return result.data;
}

export interface DesktopBridge {
  setCaptureVisible(visible: boolean): Promise<void>;
  dispatch(command: Command): Promise<Snapshot>;
  moveFloating(x: number, y: number): void;
  onChanged(listener: (snapshot: Snapshot) => void): () => void;
  onCapture(listener: () => void): () => void;
  onNavigate(listener: (view: "today" | "all" | "starred" | "settings") => void): () => void;
  onBeforeUpdate(listener: () => Promise<void>, flushOnQuit?: boolean): () => void;
  onOpenTask(listener: (id: string) => void): () => void;
  prepareUpdate(quitting?: boolean): Promise<void>;
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
  repeat: TaskProperties["repeat"] = { interval: 1, unit: "day", afterCompletion: false },
): string {
  const next = new Date(recurrence === "custom" && repeat.afterCompletion ? now : value);
  const day = next.getDate();
  const unit = recurrence === "monthly" ? "month" : recurrence === "weekly" ? "week" :
    recurrence === "custom" ? repeat.unit : "day";
  const interval = recurrence === "custom" ? repeat.interval : 1;
  do {
    if (unit === "month") {
      next.setDate(1);
      next.setMonth(next.getMonth() + interval);
      const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
      next.setDate(Math.min(day, lastDay));
    } else {
      next.setDate(next.getDate() + interval * (unit === "week" ? 7 : 1));
    }
  } while (next <= now || (recurrence === "weekdays" && [0, 6].includes(next.getDay())));
  return next.toISOString();
}
