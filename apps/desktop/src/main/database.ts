import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  itemSchema,
  itemInputSchema,
  backupSchema,
  taskPropertiesSchema,
  workspaceSchema,
  projectSchema,
  type TaskProperties,
  type Workspace,
  type Project,
  nextOccurrence,
  settingsSchema,
  type DataCommand,
  type Item,
  type StoreSnapshot,
  type SyncMutation,
  type SyncRecord,
  type SyncItem,
  type UndoState,
} from "@dock/contracts";
import { schema, syncSchema, notesSchema, tasksSchema, taskIndexesSchema } from "./schema.ts";

type Row = Record<string, string | number | null>;
type UndoEntry = {
  id: string;
  revision: number;
  before: { done: number; completedAt: string | null; deletedAt: string | null } | null;
};
type UndoReceipt = NonNullable<UndoState> & { entries: UndoEntry[] };

export class DockDatabase {
  private readonly db: DatabaseSync;
  private undoReceipt: UndoReceipt | null = null;

  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    this.db.exec("PRAGMA busy_timeout = 5000");
    const version = this.db.prepare("PRAGMA user_version").get()?.user_version;
    if (typeof version === "number" && version > 5) {
      this.db.close();
      throw new Error("This database was created by a newer version of Dock.");
    }
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (Number(version) < 1) this.db.exec(schema);
      if (Number(version) < 2) this.db.exec(syncSchema);
      if (Number(version) < 3) this.db.exec(notesSchema);
      if (Number(version) < 4) this.db.exec(tasksSchema);
      if (Number(version) < 5) this.db.exec(taskIndexesSchema);
      if (!this.db.prepare("SELECT 1 FROM settings WHERE key = 'spaces_folded'").get()) this.foldSpaces();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      this.db.close();
      throw error;
    }
  }

  /** Spaces are no longer shown for tasks: Work and Personal tasks without a project move to projects of the same name. */
  private foldSpaces(): void {
    const workspace = this.workspace();
    const projects = [...workspace.projects];
    const timestamp = new Date().toISOString();
    for (const space of ["Work", "Personal"]) {
      const roots = this.db.prepare(`SELECT id FROM items WHERE kind = 'task' AND deleted_at IS NULL AND space = ?
        AND json_extract(task_properties, '$.projectId') IS NULL AND json_extract(task_properties, '$.parentId') IS NULL`).all(space);
      if (!roots.length) continue;
      let project = projects.find(project => !project.parentId && project.name.toLowerCase() === space.toLowerCase());
      if (!project) projects.push(project = projectSchema.parse({ id: randomUUID(), name: space }));
      for (const root of roots) {
        this.db.prepare(`WITH RECURSIVE tree(id) AS (
          SELECT ? UNION SELECT items.id FROM items JOIN tree ON json_extract(items.task_properties, '$.parentId') = tree.id
        ) UPDATE items SET task_properties = json_set(task_properties, '$.projectId', ?, '$.sectionId', NULL),
          updated_at = ?, revision = revision + 1 WHERE id IN tree AND deleted_at IS NULL`).run(String(root.id), project.id, timestamp);
      }
    }
    if (projects.length !== workspace.projects.length) this.saveWorkspace(workspaceSchema.parse({ ...workspace, projects }));
    this.db.prepare("INSERT INTO settings(key, value) VALUES('spaces_folded', '1')").run();
  }

  private item(row: Row): Item {
    return itemSchema.parse({
      id: row.id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      space: row.space,
      priority: Boolean(row.priority),
      done: Boolean(row.done),
      scheduledAt: row.scheduled_at,
      recurrence: row.recurrence,
      linkedNoteId: row.linked_note_id,
      tags: JSON.parse(String(row.tags)),
      noteStyle: JSON.parse(String(row.note_style)),
      task: JSON.parse(String(row.task_properties)),
      completedAt: row.completed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      revision: row.revision,
    });
  }

  snapshot(): StoreSnapshot {
    const hidden = new Set(this.hiddenProjectIds());
    const rows = this.db
      .prepare(
        "SELECT * FROM items WHERE deleted_at IS NULL ORDER BY created_at DESC, id",
      )
      .all();
    return {
      undo: this.undoReceipt ? { token: this.undoReceipt.token, action: this.undoReceipt.action, count: this.undoReceipt.count } : null,
      items: rows.map((row) => this.item(row as Row)).filter(item => !hidden.has(item.task.projectId ?? "")),
      workspace: this.workspace(),
      deletedItems: this.db.prepare("SELECT * FROM items WHERE deleted_at >= ? ORDER BY deleted_at DESC")
        .all(new Date(Date.now() - 30 * 86400_000).toISOString()).map(row => ({ ...this.item(row as Row), deletedAt: String(row.deleted_at) }))
        .filter(item => !hidden.has(item.task.projectId ?? "")),
      settings: this.settings(),
    };
  }

  settings() {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'preferences'").get();
    return settingsSchema.parse(row ? JSON.parse(String(row.value)) : {});
  }

  workspace(): Workspace {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'workspace'").get();
    return workspaceSchema.parse(row ? JSON.parse(String(row.value)) : {});
  }

  private saveWorkspace(workspace: Workspace, trackProjects = true): void {
    if (trackProjects) {
      const shared = this.sharedProjectIds();
      const privateProjects = (projects: Project[]) => projects.filter(project => !shared.includes(project.id));
      if (JSON.stringify(privateProjects(this.workspace().projects)) !== JSON.stringify(privateProjects(workspace.projects))) {
        this.db.prepare("INSERT INTO sync_meta(key,value) VALUES('project_mutation',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
          .run(randomUUID().replaceAll("-", ""));
        this.db.prepare("INSERT INTO sync_meta(key,value) VALUES('projects_dirty','1') ON CONFLICT(key) DO UPDATE SET value='1'").run();
      }
    }
    this.db.prepare("INSERT INTO settings(key, value) VALUES('workspace', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify(workspace));
    // Tasks in a removed section move to No section so they stay valid.
    for (const project of workspace.projects) {
      this.db.prepare(`UPDATE items SET task_properties = json_set(task_properties, '$.sectionId', NULL), updated_at = ?, revision = revision + 1
        WHERE json_extract(task_properties, '$.projectId') = ? AND json_extract(task_properties, '$.sectionId') IS NOT NULL
        AND json_extract(task_properties, '$.sectionId') NOT IN (SELECT value FROM json_each(?))`)
        .run(new Date().toISOString(), project.id, JSON.stringify(project.sections.map(section => section.id)));
    }
  }

  private sharedProjectIds(): string[] {
    const row = this.db.prepare("SELECT value FROM sync_meta WHERE key = 'shared_projects'").get();
    return row ? JSON.parse(String(row.value)) : [];
  }

  projectSyncState(): { version: number; mutationId: string; dirty: boolean; projects: Project[] } {
    const shared = this.sharedProjectIds();
    return {
      version: Number(this.db.prepare("SELECT value FROM sync_meta WHERE key = 'project_version'").get()?.value ?? 0),
      mutationId: String(this.db.prepare("SELECT value FROM sync_meta WHERE key = 'project_mutation'").get()?.value ?? "0".repeat(32)),
      dirty: this.db.prepare("SELECT value FROM sync_meta WHERE key = 'projects_dirty'").get()?.value === "1",
      projects: this.workspace().projects.filter(project => !shared.includes(project.id)),
    };
  }

  applyPrivateProjects(projects: Project[], version: number): void {
    const state = this.projectSyncState();
    if (version < state.version) return;
    const current = this.workspace();
    const shared = this.sharedProjectIds();
    const privateProjects = state.dirty ? [...state.projects, ...projects.filter(project => !state.projects.some(local => local.id === project.id))] : projects;
    const combined = [...current.projects.filter(project => shared.includes(project.id)), ...privateProjects.filter(project => !shared.includes(project.id))];
    const availableIds = new Set(combined.map(project => project.id));
    const workspace = workspaceSchema.parse({ ...current, projects: combined.map(project => ({ ...project,
      parentId: project.parentId && availableIds.has(project.parentId) ? project.parentId : null,
    })) });
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.saveWorkspace(workspace, false);
      this.db.prepare("INSERT INTO sync_meta(key,value) VALUES('project_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(version));
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  acknowledgeProjects(mutationId: string, version: number): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT INTO sync_meta(key,value) VALUES('project_version',?) ON CONFLICT(key) DO UPDATE SET value=max(CAST(value AS INTEGER),CAST(excluded.value AS INTEGER))")
        .run(String(version));
      this.db.prepare("UPDATE sync_meta SET value='0' WHERE key='projects_dirty' AND EXISTS(SELECT 1 FROM sync_meta WHERE key='project_mutation' AND value=?)").run(mutationId);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  execute(command: DataCommand, now = new Date()): StoreSnapshot {
    if (command.type === "snapshot") return this.snapshot();
    this.db.exec("BEGIN IMMEDIATE");
    const undoAction = command.type === "item.delete" ? "delete" : command.type === "item.complete" ? "complete" :
      command.type === "item.bulk" && command.action !== "update" ? command.action : null;
    const undoIds = command.type === "item.bulk" ? command.ids :
      command.type === "item.complete" || command.type === "item.delete" ? [command.id] : [];
    const undoRows = () => this.db.prepare(`WITH RECURSIVE affected(id) AS (
      SELECT value FROM json_each(?)
      UNION SELECT items.id FROM items JOIN affected
        ON json_extract(items.task_properties, '$.parentId') = affected.id OR items.recurrence_source_id = affected.id
    ) SELECT id, done, completed_at, deleted_at, revision FROM items WHERE id IN affected`)
      .all(JSON.stringify(undoIds)) as Row[];
    let nextReceipt = this.undoReceipt;
    try {
      const beforeRows = undoAction ? undoRows() : [];
      if (command.type === "item.undo") {
        const receipt = this.undoReceipt;
        if (!receipt || receipt.token !== command.token) throw new Error("This action is no longer available to undo.");
        const hidden = new Set(this.hiddenProjectIds());
        for (const entry of receipt.entries) {
          const current = this.db.prepare("SELECT * FROM items WHERE id = ?").get(entry.id) as Row | undefined;
          if (!current || current.revision !== entry.revision)
            throw new Error("An affected item changed. Undo was not applied; your later changes are safe.");
          if (hidden.has(this.item(current).task.projectId ?? ""))
            throw new Error("You no longer have access to this shared project.");
          if ((!entry.before || entry.before.deletedAt !== null) && this.db.prepare(`SELECT id FROM items WHERE deleted_at IS NULL
            AND (json_extract(task_properties, '$.parentId') = ? OR linked_note_id = ? OR recurrence_source_id = ?)`)
            .all(entry.id, entry.id, entry.id).some(row => !receipt.entries.some(affected => affected.id === row.id)))
            throw new Error("A follow-up task has new linked work. Undo was not applied; your later changes are safe.");
        }
        for (const entry of receipt.entries) {
          if (entry.before) {
            this.db.prepare(`UPDATE items SET done = ?, completed_at = ?, deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ?`)
              .run(entry.before.done, entry.before.completedAt, entry.before.deletedAt, now.toISOString(), entry.id);
          } else {
            this.db.prepare("UPDATE items SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ?")
              .run(now.toISOString(), now.toISOString(), entry.id);
          }
        }
        nextReceipt = null;
      } else if (command.type === "item.purge") {
        // Tombstones stay so sync can propagate the deletion; content is wiped and hidden from Recently deleted.
        this.db.prepare(`WITH RECURSIVE tree(id) AS (
          SELECT id FROM items WHERE deleted_at > '1970-01-02' AND (? IS NULL OR id = ?)
          UNION SELECT items.id FROM items JOIN tree ON json_extract(items.task_properties, '$.parentId') = tree.id
        ) UPDATE items SET title = 'Deleted item', body = '', tags = '[]', linked_note_id = NULL, scheduled_at = NULL, recurrence = 'none',
          task_properties = json_set(task_properties, '$.comments', json('[]'), '$.reminders', json('[]')),
          deleted_at = '1970-01-01T00:00:00.000Z', updated_at = ?, revision = revision + 1
          WHERE id IN tree AND deleted_at IS NOT NULL`).run(command.id ?? null, command.id ?? null, now.toISOString());
      } else if (command.type === "settings.save") {
        this.db.prepare("INSERT INTO settings(key, value) VALUES('preferences', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
          .run(JSON.stringify(command.settings));
      } else if (command.type === "workspace.save") {
        this.saveWorkspace(workspaceSchema.parse(command.workspace));
      } else if (command.type === "template.apply") {
        const template = this.workspace().templates.find(template => template.id === command.id);
        if (!template) throw new Error("This template is no longer available.");
        for (const task of template.tasks) {
          this.executeItem({ type: "item.save", item: itemInputSchema.parse({ kind: "task", title: task.title, body: task.body,
            tags: task.tags, task: { ...task.task, projectId: command.projectId, sectionId: null, parentId: null,
              comments: [], reminders: [], assignee: "" } }) }, now);
        }
      } else if (command.type === "item.reorder") {
        const project = this.workspace().projects.find(project => project.id === command.projectId);
        if (!project || this.hiddenProjectIds().includes(project.id)) throw new Error("This project is no longer available.");
        if (command.sectionId && !project.sections.some(section => section.id === command.sectionId))
          throw new Error("This column is no longer available.");
        const items = command.ids.map(id => {
          const row = this.db.prepare("SELECT * FROM items WHERE id = ? AND deleted_at IS NULL").get(id);
          if (!row || row.kind !== "task" || row.revision !== command.expectedRevisions[id])
            throw new Error("A task changed. Refresh the board before reordering.");
          const item = this.item(row as Row);
          if (item.task.projectId !== project.id || item.task.parentId || item.done)
            throw new Error("Choose open cards from this project.");
          return item;
        });
        const update = this.db.prepare("UPDATE items SET task_properties = ?, updated_at = ?, revision = revision + 1 WHERE id = ?");
        items.forEach((item, order) => {
          if (item.task.order !== order || item.task.sectionId !== command.sectionId)
            update.run(JSON.stringify({ ...item.task, sectionId: command.sectionId, order }), now.toISOString(), item.id);
        });
      } else if (command.type === "item.bulk") {
        const ids = [...new Set(command.ids)];
        for (const id of ids) {
          const row = this.db.prepare("SELECT * FROM items WHERE id = ? AND deleted_at IS NULL").get(id);
          if (!row || row.kind !== "task") throw new Error("One of these tasks is no longer available.");
          if (command.expectedRevisions && command.expectedRevisions[id] !== row.revision)
            throw new Error("A selected task changed. Refresh your selection before editing.");
        }
        for (const id of ids) {
          const row = this.db.prepare("SELECT * FROM items WHERE id = ?").get(id)!;
          if (command.action === "delete" && row.deleted_at) continue;
          if (command.action === "update") {
            if (!command.patch) throw new Error("Choose a change to apply to the selected tasks.");
            const item = this.item(row as Row);
            const patch = command.patch;
            this.executeItem({ type: "item.save", item: itemInputSchema.parse({ ...item, ...patch,
              task: { ...item.task, ...patch.task }, expectedRevision: item.revision }) }, now);
          } else {
            this.executeItem({ type: command.action === "complete" ? "item.complete" : "item.delete", id }, now);
          }
        }
      } else {
        this.executeItem(command, now);
      }
      if (undoAction) {
        const beforeById = new Map(beforeRows.map(row => [String(row.id), row]));
        const entries: UndoEntry[] = [];
        let count = 0;
        for (const row of undoRows()) {
          const before = beforeById.get(String(row.id));
          if (before && before.done === row.done && before.completed_at === row.completed_at && before.deleted_at === row.deleted_at) continue;
          if (before && (undoAction === "complete" ? before.done !== row.done : before.deleted_at !== row.deleted_at)) count++;
          entries.push({ id: String(row.id), revision: Number(row.revision), before: before ? {
            done: Number(before.done), completedAt: before.completed_at as string | null, deletedAt: before.deleted_at as string | null,
          } : null });
        }
        nextReceipt = count ? { token: randomUUID(), action: undoAction, count, entries } : null;
      }
      this.db.exec("COMMIT");
      this.undoReceipt = nextReceipt;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.snapshot();
  }

  private validateTask(task: TaskProperties, id?: string): void {
    const project = this.workspace().projects.find(project => project.id === task.projectId);
    if (task.projectId && !project) throw new Error("This project is no longer available.");
    if (task.sectionId && !project?.sections.some(section => section.id === task.sectionId))
      throw new Error("Choose a section in this task's project.");
    const visited = new Set(id ? [id] : []);
    let parentId = task.parentId;
    while (parentId) {
      if (visited.has(parentId)) throw new Error("A task cannot be its own parent.");
      visited.add(parentId);
      const parent = this.db.prepare("SELECT * FROM items WHERE id = ? AND kind = 'task' AND deleted_at IS NULL").get(parentId);
      if (!parent) throw new Error("The parent task is no longer available.");
      const parentTask = this.item(parent as Row).task;
      if (parentTask.projectId !== task.projectId) throw new Error("Subtasks must stay in their parent's project.");
      parentId = parentTask.parentId;
    }
  }

  private executeItem(command: Exclude<DataCommand, { type: "snapshot" | "settings.save" | "workspace.save" | "item.bulk" | "item.reorder" | "template.apply" | "item.undo" | "item.purge" }>, now: Date): void {
    const timestamp = now.toISOString();
    if (command.type === "item.save") {
      const input = command.item;
      const existing = input.id ? this.db.prepare("SELECT * FROM items WHERE id = ? AND deleted_at IS NULL").get(input.id) : undefined;
      if (input.id && !existing) throw new Error("This item is no longer available.");
      if (existing && existing.revision !== input.expectedRevision)
        throw new Error("This item changed in another window or device. Reopen it before saving.");
      if (existing && existing.kind !== input.kind) throw new Error("An item cannot change between a task and a note.");
      if (input.linkedNoteId && !this.db.prepare("SELECT id FROM items WHERE id = ? AND kind = 'note' AND deleted_at IS NULL").get(input.linkedNoteId))
        throw new Error("The linked note is no longer available.");
      let task = input.task ?? (existing ? this.item(existing as Row).task : taskPropertiesSchema.parse({ priority: input.priority ? 1 : 4 }));
      if (!input.task && existing && Boolean(existing.priority) !== input.priority)
        task = { ...task, priority: input.priority ? 1 : 4 };
      const oldTask = existing ? this.item(existing as Row).task : null;
      if (oldTask && oldTask.projectId !== task.projectId) {
        if (this.sharedProjectIds().includes(oldTask.projectId ?? ""))
          throw new Error("Shared tasks must stay in their shared project.");
        const parent = task.parentId ? this.db.prepare("SELECT * FROM items WHERE id = ?").get(task.parentId) : null;
        task = { ...task, assignee: "", parentId: parent && this.item(parent as Row).task.projectId === task.projectId ? task.parentId : null };
      }
      if (input.kind === "task") this.validateTask(task, input.id);
      const priority = input.kind === "task" ? task.priority < 4 : input.priority;
      if (existing) {
        this.db.prepare(`UPDATE items SET title = ?, body = ?, space = ?, priority = ?, scheduled_at = ?, recurrence = ?, linked_note_id = ?,
          notified_at = CASE WHEN scheduled_at IS ? THEN notified_at ELSE NULL END, tags = ?, note_style = ?, task_properties = ?, updated_at = ?, revision = revision + 1 WHERE id = ?`)
          .run(input.title, input.body, input.space, Number(priority), input.scheduledAt, input.recurrence, input.linkedNoteId, input.scheduledAt,
            input.tags === undefined ? String(existing.tags) : JSON.stringify(input.tags),
            input.noteStyle === undefined ? String(existing.note_style) : JSON.stringify(input.noteStyle), JSON.stringify(task), timestamp, input.id!);
        if (oldTask && oldTask.projectId !== task.projectId) {
          this.db.prepare(`WITH RECURSIVE descendants(id) AS (
            SELECT id FROM items WHERE json_extract(task_properties, '$.parentId') = ?
            UNION SELECT items.id FROM items JOIN descendants ON json_extract(items.task_properties, '$.parentId') = descendants.id
          ) UPDATE items SET task_properties = json_set(task_properties, '$.projectId', ?, '$.sectionId', ?, '$.assignee', ''),
            updated_at = ?, revision = revision + 1 WHERE id IN descendants AND deleted_at IS NULL`)
            .run(input.id!, task.projectId, task.sectionId, timestamp);
        }
      } else {
        this.db.prepare(`INSERT INTO items(id, kind, title, body, space, priority, scheduled_at, recurrence, linked_note_id, tags, note_style, task_properties, created_at, updated_at)
          VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(randomUUID(), input.kind, input.title, input.body, input.space, Number(priority), input.scheduledAt, input.recurrence, input.linkedNoteId,
            JSON.stringify(input.tags ?? []), JSON.stringify(input.noteStyle ?? {}), JSON.stringify(task), timestamp, timestamp);
      }
      return;
    }
    const row = this.db.prepare("SELECT * FROM items WHERE id = ?").get(command.id);
    if (!row || (row.deleted_at && command.type !== "item.restore")) throw new Error("This item is no longer available.");
    if (this.hiddenProjectIds().includes(this.item(row as Row).task.projectId ?? ""))
      throw new Error("You no longer have access to this shared project.");
    if (command.type === "item.delete") {
      this.db.prepare(`WITH RECURSIVE descendants(id) AS (
        SELECT ? UNION SELECT items.id FROM items JOIN descendants ON json_extract(items.task_properties, '$.parentId') = descendants.id
      ) UPDATE items SET deleted_at = ?, updated_at = ?, revision = revision + 1
        WHERE id IN descendants AND deleted_at IS NULL`).run(command.id, timestamp, timestamp);
    } else if (command.type === "item.restore") {
      this.db.prepare(`WITH RECURSIVE ancestors(id) AS (
        SELECT ? UNION SELECT json_extract(items.task_properties, '$.parentId') FROM items JOIN ancestors ON items.id = ancestors.id
          WHERE json_extract(items.task_properties, '$.parentId') IS NOT NULL
      ) UPDATE items SET deleted_at = NULL, updated_at = ?, revision = revision + 1
        WHERE id IN ancestors AND id != ? AND deleted_at IS NOT NULL`).run(command.id, timestamp, command.id);
      this.db.prepare(`WITH RECURSIVE descendants(id) AS (
        SELECT ? UNION SELECT items.id FROM items JOIN descendants ON json_extract(items.task_properties, '$.parentId') = descendants.id
      ) UPDATE items SET deleted_at = NULL, updated_at = ?, revision = revision + 1
        WHERE id IN descendants AND deleted_at IS ?`).run(command.id, timestamp, row.deleted_at ? String(row.deleted_at) : null);
    } else if (command.type === "item.priority") {
      const task = this.item(row as Row).task;
      this.db.prepare("UPDATE items SET priority = 1 - priority, task_properties = ?, updated_at = ?, revision = revision + 1 WHERE id = ?")
        .run(JSON.stringify({ ...task, priority: row.priority ? 4 : 1 }), timestamp, command.id);
    } else {
      if (row.kind !== "task") throw new Error("This action applies to tasks only.");
      if (command.type === "item.snooze") {
        if (row.done) throw new Error("Completed tasks cannot be snoozed.");
        const due = new Date(now.getTime() + command.minutes * 60_000).toISOString();
        this.db.prepare("UPDATE items SET scheduled_at = ?, notified_at = NULL, updated_at = ?, revision = revision + 1 WHERE id = ?").run(due, timestamp, command.id);
      } else {
        const done = command.type === "item.complete" || !row.done;
        this.db.prepare("UPDATE items SET done = ?, completed_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ?")
          .run(Number(done), done ? row.completed_at ?? timestamp : null, timestamp, command.id);
        if (done) {
          const children = this.db.prepare("SELECT id FROM items WHERE json_extract(task_properties, '$.parentId') = ? AND deleted_at IS NULL AND done = 0").all(command.id);
          for (const child of children) this.executeItem({ type: "item.complete", id: String(child.id) }, now);
        }
        if (!row.done && done && row.recurrence !== "none" && row.scheduled_at) {
          const followUp = this.db.prepare("SELECT id, deleted_at FROM items WHERE recurrence_source_id = ?").get(command.id);
          if (followUp) {
            if (followUp.deleted_at) this.db.prepare("UPDATE items SET deleted_at = NULL, updated_at = ?, revision = revision + 1 WHERE id = ?")
              .run(timestamp, String(followUp.id));
            return;
          }
          const item = this.item(row as Row);
          const due = nextOccurrence(item.scheduledAt!, item.recurrence as Exclude<Item["recurrence"], "none">, now, item.task.repeat);
          const shift = new Date(due).getTime() - new Date(item.scheduledAt!).getTime();
          const task = { ...item.task, comments: [], reminders: item.task.reminders.map(reminder => new Date(new Date(reminder).getTime() + shift).toISOString()) };
          this.db.prepare(`INSERT INTO items(id, kind, title, body, space, priority, scheduled_at, recurrence, linked_note_id, recurrence_source_id, tags, task_properties, created_at, updated_at)
            VALUES(?, 'task', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(recurrenceId(item.id), item.title, item.body, item.space, Number(item.priority), due, item.recurrence, item.linkedNoteId, item.id,
              JSON.stringify(item.tags), JSON.stringify(task), timestamp, timestamp);
        }
      }
    }
  }

  backup(): unknown {
    const state = this.snapshot();
    const included = new Set(state.items.map(item => item.id));
    const sources = new Map(this.db.prepare("SELECT id, recurrence_source_id FROM items WHERE recurrence_source_id IS NOT NULL").all()
      .map(row => [String(row.id), String(row.recurrence_source_id)]));
    return { version: 1, createdAt: new Date().toISOString(), items: state.items.map(item => ({ ...item,
      recurrenceSourceId: included.has(sources.get(item.id) ?? "") ? sources.get(item.id) : null,
    })), workspace: state.workspace, settings: state.settings };
  }

  restoreBackup(data: unknown): number {
    const backup = backupSchema.parse(data);
    const items = backup.items;
    for (const item of items) itemInputSchema.parse({ ...item, id: undefined });
    if (new Set(items.map(item => item.id)).size !== items.length) throw new Error("Backup item IDs must be unique.");
    const incomingWorkspace = workspaceSchema.parse(backup.workspace ?? {});
    let restored = 0;
    this.db.exec("BEGIN IMMEDIATE; PRAGMA defer_foreign_keys = ON");
    try {
      const current = this.workspace();
      const merge = <T extends { id: string }>(existing: T[], incoming: T[]) => [...existing, ...incoming.filter(value => !existing.some(entry => entry.id === value.id))];
      this.saveWorkspace(workspaceSchema.parse({ ...current, projects: merge(current.projects, incomingWorkspace.projects),
        filters: merge(current.filters, incomingWorkspace.filters), templates: merge(current.templates, incomingWorkspace.templates),
        labels: [...new Set([...current.labels, ...incomingWorkspace.labels])] }));
      const restoredItems: Item[] = [];
      for (const item of items) {
        const existing = this.db.prepare("SELECT deleted_at FROM items WHERE id = ?").get(item.id);
        if (existing && !existing.deleted_at) continue;
        if (existing) {
          this.db.prepare("UPDATE items SET deleted_at = NULL, updated_at = ?, revision = revision + 1 WHERE id = ?").run(new Date().toISOString(), item.id);
        } else {
          this.db.prepare(`INSERT INTO items(id, kind, title, body, space, priority, done, scheduled_at, recurrence, linked_note_id, tags, note_style, task_properties, completed_at, recurrence_source_id, created_at, updated_at)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(item.id, item.kind, item.title, item.body, item.space, Number(item.kind === "task" ? item.task.priority < 4 : item.priority), Number(item.done),
              item.scheduledAt, item.recurrence, item.linkedNoteId, JSON.stringify(item.tags), JSON.stringify(item.noteStyle), JSON.stringify(item.task), item.completedAt, item.recurrenceSourceId, item.createdAt, item.updatedAt);
        }
        restoredItems.push(this.item(this.db.prepare("SELECT * FROM items WHERE id = ?").get(item.id) as Row));
        restored++;
      }
      for (const item of restoredItems) {
        if (item.kind === "task") this.validateTask(item.task, item.id);
        if (item.linkedNoteId && !this.db.prepare("SELECT id FROM items WHERE id = ? AND kind = 'note' AND deleted_at IS NULL").get(item.linkedNoteId))
          throw new Error("A backup task links to a missing note.");
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return restored;
  }

  private hiddenProjectIds(): string[] {
    const row = this.db.prepare("SELECT value FROM sync_meta WHERE key = 'hidden_projects'").get();
    return row ? JSON.parse(String(row.value)) : [];
  }

  applySharedProjects(projects: Project[], accessibleProjectIds: string[]): void {
    const row = this.db.prepare("SELECT value FROM sync_meta WHERE key = 'shared_projects'").get();
    const previous: string[] = row ? JSON.parse(String(row.value)) : [];
    const hidden = [...new Set([...this.hiddenProjectIds(), ...previous])].filter(id => !accessibleProjectIds.includes(id));
    const current = this.workspace();
    const projectIds = new Set(projects.map(project => project.id));
    const mergedProjects = [...current.projects.filter(project => !previous.includes(project.id) && !projectIds.has(project.id)), ...projects];
    const availableIds = new Set(mergedProjects.map(project => project.id));
    const workspace = workspaceSchema.parse({ ...current, projects: mergedProjects.map(project => ({ ...project,
      parentId: project.parentId && availableIds.has(project.parentId) ? project.parentId : null,
    })) });
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.saveWorkspace(workspace);
      for (const [key, value] of [["shared_projects", accessibleProjectIds], ["hidden_projects", hidden]] as const)
        this.db.prepare("INSERT INTO sync_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, JSON.stringify(value));
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  syncAccount(): { endpoint: string; accountId: string } | null {
    const row = this.db.prepare("SELECT value FROM sync_meta WHERE key = 'account'").get();
    return row ? JSON.parse(String(row.value)) : null;
  }

  bindSyncAccount(endpoint: string, accountId: string): void {
    const existing = this.syncAccount();
    if (existing && (existing.endpoint !== endpoint || existing.accountId !== accountId))
      throw new Error("This workspace belongs to another sync account or server. Use a separate Dock profile to keep accounts apart.");
    this.db.prepare("INSERT OR IGNORE INTO sync_meta(key, value) VALUES('account', ?)")
      .run(JSON.stringify({ endpoint, accountId }));
  }

  syncCounts(): { pending: number; conflicts: number } {
    return {
      pending: Number(this.db.prepare(`SELECT count(*) AS count FROM sync_items JOIN items ON items.id = sync_items.item_id
        WHERE dirty = 1 AND (json_extract(task_properties, '$.projectId') IS NULL OR json_extract(task_properties, '$.projectId') NOT IN (SELECT value FROM json_each(?)))`)
        .get(JSON.stringify(this.hiddenProjectIds()))!.count),
      conflicts: Number(this.db.prepare(`SELECT count(*) AS count FROM sync_conflicts
        JOIN items ON items.id = sync_conflicts.item_id WHERE deleted_at IS NULL
        AND (json_extract(task_properties, '$.projectId') IS NULL OR json_extract(task_properties, '$.projectId') NOT IN (SELECT value FROM json_each(?)))`)
        .get(JSON.stringify(this.hiddenProjectIds()))!.count),
    };
  }

  syncCursor(): number {
    return Number(this.db.prepare("SELECT value FROM sync_meta WHERE key = 'cursor'").get()?.value ?? 0);
  }

  pendingChanges(): SyncMutation[] {
    return this.db.prepare(`SELECT items.*, sync_items.remote_version, sync_items.mutation_id
      FROM items JOIN sync_items ON items.id = sync_items.item_id WHERE dirty = 1
      AND (json_extract(task_properties, '$.projectId') IS NULL OR json_extract(task_properties, '$.projectId') NOT IN (SELECT value FROM json_each(?)))
      AND (json_extract(task_properties, '$.parentId') IS NULL OR EXISTS (SELECT 1 FROM sync_items AS dependency
        WHERE dependency.item_id = json_extract(items.task_properties, '$.parentId') AND dependency.remote_version > 0 AND dependency.dirty = 0))
      AND (linked_note_id IS NULL OR EXISTS (SELECT 1 FROM sync_items AS dependency WHERE dependency.item_id = items.linked_note_id AND dependency.remote_version > 0))
      AND (recurrence_source_id IS NULL OR EXISTS (SELECT 1 FROM sync_items AS dependency WHERE dependency.item_id = items.recurrence_source_id AND dependency.remote_version > 0))
      ORDER BY created_at, items.id LIMIT 50`).all(JSON.stringify(this.hiddenProjectIds())).map(row => ({
        mutationId: String(row.mutation_id),
        baseVersion: Number(row.remote_version),
        item: this.syncItem(row as Row),
      }));
  }

  private syncItem(row: Row): SyncItem {
    const { revision: _revision, ...item } = this.item(row);
    return { ...item, deletedAt: row.deleted_at ? String(row.deleted_at) : null,
      recurrenceSourceId: row.recurrence_source_id ? String(row.recurrence_source_id) : null };
  }

  acknowledgeSync(mutation: SyncMutation, version: number): void {
    this.db.prepare(`UPDATE sync_items SET remote_version = max(remote_version, ?),
      dirty = CASE WHEN mutation_id = ? THEN 0 ELSE dirty END WHERE item_id = ?`)
      .run(version, mutation.mutationId, mutation.item.id);
  }

  applySync(records: SyncRecord[], cursor?: number): void {
    this.db.exec("BEGIN IMMEDIATE; PRAGMA defer_foreign_keys = ON");
    try {
      this.db.prepare("INSERT INTO sync_meta(key, value) VALUES('applying_remote', '1')").run();
      for (const record of records) {
        const { item, version } = record;
        const local = this.db.prepare(`SELECT items.*, remote_version, dirty FROM items
          JOIN sync_items ON items.id = sync_items.item_id WHERE items.id = ?`).get(item.id);
        if (local && Number(local.remote_version) >= version) continue;
        if (local?.dirty && !local.deleted_at && JSON.stringify({ ...this.syncItem(local as Row), createdAt: item.createdAt, updatedAt: item.updatedAt }) !== JSON.stringify(item)) {
          const copyId = randomUUID();
          this.db.prepare(`INSERT INTO items(id, kind, title, body, space, priority, done, scheduled_at, recurrence, linked_note_id, tags, note_style, task_properties, completed_at, recurrence_source_id, created_at, updated_at)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(copyId, String(local.kind),
              `${String(local.title).slice(0, 484)} (conflict copy)`, String(local.body), String(local.space),
              Number(local.priority), Number(local.done), local.scheduled_at as string | null,
              String(local.recurrence), local.linked_note_id as string | null, String(local.tags), String(local.note_style), String(local.task_properties), local.completed_at as string | null, null, String(local.created_at), new Date().toISOString());
          this.db.prepare("INSERT INTO sync_items(item_id) VALUES(?)").run(copyId);
          this.db.prepare("INSERT INTO sync_conflicts(item_id) VALUES(?)").run(copyId);
        }
        this.db.prepare(`INSERT INTO items(id, kind, title, body, space, priority, done, scheduled_at, recurrence, linked_note_id, recurrence_source_id, deleted_at, tags, note_style, task_properties, completed_at, created_at, updated_at)
          VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET title = excluded.title, body = excluded.body, space = excluded.space,
          priority = excluded.priority, done = excluded.done, scheduled_at = excluded.scheduled_at,
          recurrence = excluded.recurrence, linked_note_id = excluded.linked_note_id,
          recurrence_source_id = excluded.recurrence_source_id, deleted_at = excluded.deleted_at,
          tags = excluded.tags, note_style = excluded.note_style, task_properties = excluded.task_properties, completed_at = excluded.completed_at,
          updated_at = excluded.updated_at, revision = items.revision + 1,
          notified_at = CASE WHEN items.scheduled_at IS excluded.scheduled_at THEN items.notified_at ELSE NULL END`)
          .run(item.id, item.kind, item.title, item.body, item.space, Number(item.priority), Number(item.done),
            item.scheduledAt, item.recurrence, item.linkedNoteId, item.recurrenceSourceId, item.deletedAt,
            JSON.stringify(item.tags), JSON.stringify(item.noteStyle), JSON.stringify(item.task), item.completedAt, item.createdAt, item.updatedAt);
        this.db.prepare(`INSERT INTO sync_items(item_id, remote_version, dirty) VALUES(?, ?, 0)
          ON CONFLICT(item_id) DO UPDATE SET remote_version = excluded.remote_version, dirty = 0`)
          .run(item.id, version);
      }
      if (cursor !== undefined) this.db.prepare("INSERT INTO sync_meta(key, value) VALUES('cursor', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(cursor));
      this.db.prepare("DELETE FROM sync_meta WHERE key = 'applying_remote'").run();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  due(now: Date): Item[] {
    return this.db
      .prepare(
        `SELECT * FROM items WHERE kind = 'task' AND done = 0 AND deleted_at IS NULL
      AND scheduled_at <= ? AND notified_at IS NULL
      AND (json_extract(task_properties, '$.projectId') IS NULL OR json_extract(task_properties, '$.projectId') NOT IN (SELECT value FROM json_each(?))) ORDER BY scheduled_at`,
      )
      .all(now.toISOString(), JSON.stringify(this.hiddenProjectIds()))
      .map((row) => this.item(row as Row));
  }

  reminderItems(): Item[] {
    return this.db.prepare(`SELECT * FROM items WHERE kind = 'task' AND done = 0 AND deleted_at IS NULL
      AND json_array_length(task_properties, '$.reminders') > 0
      AND (json_extract(task_properties, '$.projectId') IS NULL OR json_extract(task_properties, '$.projectId') NOT IN (SELECT value FROM json_each(?)))
      ORDER BY created_at DESC, id`)
      .all(JSON.stringify(this.hiddenProjectIds()))
      .map(row => this.item(row as Row));
  }

  markNotified(id: string, now: Date, scheduledAt?: string): void {
    if (scheduledAt !== undefined) {
      this.db.prepare("UPDATE items SET notified_at = ? WHERE id = ? AND scheduled_at IS ?")
        .run(now.toISOString(), id, scheduledAt);
    } else {
      this.db.prepare("UPDATE items SET notified_at = ? WHERE id = ?").run(now.toISOString(), id);
    }
  }

  close(): void {
    this.db.close();
  }
}

function recurrenceId(sourceId: string): string {
  const bytes = createHash("sha256").update(`dock:recurrence:${sourceId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const value = bytes.toString("hex");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
