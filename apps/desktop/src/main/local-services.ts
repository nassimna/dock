import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { itemInputSchema, itemSchema, localDate, type Item, type LocalServicesState } from "@dock/contracts";
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

  ensureDailyBackup(now = new Date()): void {
    const day = localDate(now);
    if (this.backupDay === day) return;
    try {
      const todayExists = this.state().backups.some(backup => localDate(new Date(backup.createdAt)) === day);
      if (!todayExists) this.createBackup(now);
      this.backupDay = day;
    } catch (error) {
      this.message = `Automatic backup failed: ${error instanceof Error ? error.message : "Could not write the backup."}`;
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
    const workspace = this.database.snapshot().workspace;
    const projectId = randomUUID();
    const sections: { id: string; name: string }[] = [];
    const items: Item[] = [];
    const parents: string[] = [];
    let sectionId: string | null = null;
    const now = new Date().toISOString();
    for (const row of todoistRows(content)) {
      const type = (row.TYPE ?? "task").toLowerCase();
      if (type === "section") {
        const section = { id: randomUUID(), name: row.CONTENT?.trim() || "Section" };
        sections.push(section);
        sectionId = section.id;
        parents.length = 0;
        continue;
      }
      if (type !== "task" || !row.CONTENT?.trim()) continue;
      const indent = Math.max(1, Number(row.INDENT || 1));
      if (!Number.isInteger(indent) || indent > parents.length + 1) throw new Error("The CSV contains an invalid subtask indentation.");
      const scheduledAt = importDate(row.DATE ?? "");
      const deadline = importDate(row.DEADLINE ?? "");
      const duration = Number(row.DURATION || 30) * (row.DURATION_UNIT === "hour" ? 60 : 1);
      const id = randomUUID();
      items.push(itemSchema.parse({
        id, kind: "task", title: row.CONTENT, body: row.DESCRIPTION ?? "", space: "Inbox",
        priority: Number(row.PRIORITY || 1) > 1, done: false, scheduledAt, recurrence: "none", linkedNoteId: null,
        task: { priority: 5 - Number(row.PRIORITY || 1), projectId, sectionId, parentId: indent > 1 ? parents[indent - 2] : null, deadline, durationMinutes: duration },
        createdAt: now, updatedAt: now, revision: 1,
      }));
      parents[indent - 1] = id;
      parents.length = indent;
    }
    if (!items.length) throw new Error("No tasks were found. Choose a Todoist project CSV export.");
    const count = this.database.restoreBackup({
      items,
      workspace: { ...workspace, projects: [...workspace.projects, { id: projectId, name: name.slice(0, 80) || "Todoist import", parentId: null, color: "#9c80e8", favorite: false, sections }] },
    });
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

export function todoistRows(content: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], value = "", quoted = false;
  for (let index = 0; index < content.length; index++) {
    const character = content[index]!;
    if (character === '"') {
      if (quoted && content[index + 1] === '"') { value += '"'; index++; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) { row.push(value); value = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && content[index + 1] === "\n") index++;
      row.push(value); rows.push(row); row = []; value = "";
    } else value += character;
  }
  if (quoted) throw new Error("The CSV contains an unclosed quoted field.");
  if (value || row.length) { row.push(value); rows.push(row); }
  const headers = rows.shift()?.map(value => value.replace(/^\uFEFF/, "").trim().toUpperCase());
  if (!headers?.includes("CONTENT")) throw new Error("Choose a Todoist CSV export with a CONTENT column.");
  return rows.filter(row => row.some(Boolean)).map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function importDate(value: string): string | null {
  if (!value.trim()) return null;
  if (!/^\d{4}-\d{2}-\d{2}(?:[ T].*)?$/.test(value.trim()))
    throw new Error(`The CSV date “${value}” is unsupported. Export dates as YYYY-MM-DD or ISO timestamps.`);
  const date = new Date(value.trim().length === 10 ? `${value.trim()}T23:59:00` : value.trim());
  if (!Number.isFinite(date.getTime()) || (value.trim().length === 10 && localDate(date) !== value.trim())) throw new Error(`The CSV date “${value}” is invalid.`);
  return date.toISOString();
}
