import { z } from "zod";

export const localServiceCommands = [
  z.object({ type: z.literal("backup.create") }),
  z.object({ type: z.literal("backup.restore"), name: z.string().regex(/^dock-[\dT-]+\.json$/) }),
  z.object({ type: z.literal("backup.import"), format: z.enum(["json", "todoist"]) }),
  z.object({ type: z.literal("attachment.add"), itemId: z.uuid(), commentId: z.uuid().optional() }),
  z.object({ type: z.literal("attachment.open"), id: z.uuid() }),
  z.object({ type: z.literal("reminder.retry"), key: z.string().min(1).max(150) }),
] as const;

export const reminderLogSchema = z.object({
  key: z.string(), itemId: z.uuid(), title: z.string(), dueAt: z.iso.datetime(),
  status: z.enum(["pending", "shown", "failed"]), attempts: z.number().int().nonnegative(),
  lastAttemptAt: z.iso.datetime(), nextAttemptAt: z.iso.datetime().nullable(), error: z.string(),
});

export const localServicesSchema = z.object({
  backups: z.array(z.object({ name: z.string(), createdAt: z.iso.datetime(), size: z.number() })),
  reminderLog: z.array(reminderLogSchema),
  message: z.string(),
});

export type ReminderLog = z.infer<typeof reminderLogSchema>;
export type LocalServicesState = z.infer<typeof localServicesSchema>;
