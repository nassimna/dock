import { todoistBackup } from "@dock/core/import";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { itemInputSchema, localDate, type LocalServicesState } from "@dock/contracts";
import type { DockDatabase } from "./database.ts";
import { ReminderJournal } from "./reminders.ts";

const backupName = /^dock-[\dT-]+\.json$/;
const attachmentExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".txt", ".md", ".csv", ".json", ".docx", ".xlsx", ".pptx"]);

export class LocalServices {
  readonly reminders: ReminderJournal;
  private readonly backupsDirectory: string;
  private readonly attachmentsDirectory: string;
  private message = "";
  private backupDay = "";
  private readonly database: DockDatabase;

  constructor(directory: string, database: DockDatabase) {
    this.database = database;
    this.backupsDirectory = join(directory, "backups");
    this.attachmentsDirectory = join(directory, "attachments");
    mkdirSync(this.backupsDirectory, { recursive: true, mode: 0o700 });
    mkdirSync(this.attachmentsDirectory, { recursive: true, mode: 0o700 });
    this.reminders = new ReminderJournal(join(directory, "reminder-log.json"));
  }

  state(): LocalServicesState {
    return {
      backups: readdirSync(this.backupsDirectory).filter(name => backupName.test(name)).map(name => {
        const file = statSync(join(this.backupsDirectory, name));
        return { name, createdAt: file.mtime.toISOString(), size: file.size };
      }).sort((a, b) => b.name.localeCompare(a.name)),
      reminderLog: this.reminders.entries(),
      message: this.message,
    };
  }

  ensureDailyBackup(now = new Date()): boolean {
    const day = localDate(now);
    if (this.backupDay === day) return false;
    try {
      const todayExists = this.state().backups.some(backup => localDate(new Date(backup.createdAt)) === day);
      if (!todayExists) this.createBackup(now);
      this.backupDay = day;
      return !todayExists;
    } catch (error) {
      const message = `Automatic backup failed: ${error instanceof Error ? error.message : "Could not write the backup."}`;
      const changed = this.message !== message;
      this.message = message;
      return changed;
    }
  }

  createBackup(now = new Date()): void {
    const name = `dock-${now.toISOString().replace(/[:.Z]/g, "-")}.json`;
    const filename = join(this.backupsDirectory, name);
    writeFileSync(`${filename}.tmp`, JSON.stringify(this.database.backup(), null, 2), { mode: 0o600 });
    renameSync(`${filename}.tmp`, filename);
    const backups = this.state().backups;
    for (const old of backups.slice(30)) unlinkSync(join(this.backupsDirectory, old.name));
    this.message = "Local backup saved. The 30 most recent backups are retained.";
  }

  restore(name: string): void {
    if (!backupName.test(name)) throw new Error("Choose a Dock backup from the list.");
    const path = join(this.backupsDirectory, name);
    if (realpathSync(path) !== resolve(path)) throw new Error("The backup must be a file in Dock’s backup folder.");
    this.importJson(readFileSync(path, "utf8"));
  }

  importJson(content: string): void {
    const count = this.database.restoreBackup(JSON.parse(content));
    this.message = `Recovered ${count} missing item${count === 1 ? "" : "s"}. Existing items and preferences were preserved.`;
  }

  importTodoist(content: string, name: string): void {
    const count = this.database.restoreBackup(todoistBackup(content, name, this.database.snapshot().workspace, randomUUID));
    this.message = `Imported ${count} task${count === 1 ? "" : "s"} into ${name}.`;
  }

  addAttachments(itemId: string, paths: string[], commentId?: string): void {
    const item = this.database.snapshot().items.find(item => item.id === itemId && item.kind === "task");
    if (!item) throw new Error("This task is no longer available.");
    if (commentId && !item.task.comments.some(comment => comment.id === commentId)) throw new Error("This comment is no longer available.");
    const files = paths.map(path => {
      const extension = extname(path).toLowerCase();
      const stat = statSync(path);
      if (!attachmentExtensions.has(extension)) throw new Error("Choose an image, PDF, text, or Office document.");
      if (!stat.isFile() || stat.size > 25 * 1024 * 1024) throw new Error("Attachments must be files no larger than 25 MB.");
      return { source: path, id: randomUUID(), name: basename(path), size: stat.size, extension };
    });
    const copied: string[] = [];
    try {
      const attachments = files.map(file => {
        const path = `${file.id}${file.extension}`;
        copyFileSync(file.source, join(this.attachmentsDirectory, path));
        copied.push(path);
        return { id: file.id, name: file.name, size: file.size, path };
      });
      const comments = commentId
        ? item.task.comments.map(comment => comment.id === commentId ? { ...comment, attachments: [...comment.attachments, ...attachments] } : comment)
        : [...item.task.comments, { id: randomUUID(), body: "", createdAt: new Date().toISOString(), attachments }];
      this.database.execute({ type: "item.save", item: itemInputSchema.parse({ ...item, expectedRevision: item.revision, task: { ...item.task, comments } }) });
    } catch (error) {
      for (const path of copied) unlinkSync(join(this.attachmentsDirectory, path));
      throw error;
    }
  }

  attachmentPath(id: string): string {
    const attachment = this.database.snapshot().items.flatMap(item => item.task.comments.flatMap(comment => comment.attachments)).find(file => file.id === id);
    if (!attachment || !attachmentExtensions.has(extname(attachment.path).toLowerCase()) ||
        basename(attachment.path) !== attachment.path || attachment.path !== `${attachment.id}${extname(attachment.path)}`)
      throw new Error("This attachment is unavailable on this device.");
    const path = join(this.attachmentsDirectory, attachment.path);
    if (!existsSync(path) || realpathSync(path) !== resolve(path)) throw new Error("This attachment is unavailable on this device.");
    return path;
  }
}

export { todoistRows } from "@dock/core/csv";
