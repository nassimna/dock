import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  itemSchema,
  nextOccurrence,
  settingsSchema,
  type DataCommand,
  type Item,
  type StoreSnapshot,
  type SyncMutation,
  type SyncRecord,
  type SyncItem,
} from "@dock/contracts";
import { schema, syncSchema, notesSchema } from "./schema.ts";

type Row = Record<string, string | number | null>;

export class DockDatabase {
  private readonly db: DatabaseSync;

  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    this.db.exec("PRAGMA busy_timeout = 5000");
    const version = this.db.prepare("PRAGMA user_version").get()?.user_version;
    if (typeof version === "number" && version > 3) {
      this.db.close();
      throw new Error("This database was created by a newer version of Dock.");
    }
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (Number(version) < 1) this.db.exec(schema);
      if (Number(version) < 2) this.db.exec(syncSchema);
      if (Number(version) < 3) this.db.exec(notesSchema);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      this.db.close();
      throw error;
    }
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
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      revision: row.revision,
    });
  }

  snapshot(): StoreSnapshot {
    const rows = this.db
      .prepare(
        "SELECT * FROM items WHERE deleted_at IS NULL ORDER BY created_at DESC, id",
      )
      .all();
    const settings = this.db
      .prepare("SELECT value FROM settings WHERE key = 'preferences'")
      .get();
    return {
      items: rows.map((row) => this.item(row as Row)),
      settings: settingsSchema.parse(
        settings ? JSON.parse(String(settings.value)) : {},
      ),
    };
  }

  execute(command: DataCommand, now = new Date()): StoreSnapshot {
    if (command.type === "snapshot") return this.snapshot();
    const timestamp = now.toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (command.type === "settings.save") {
        this.db
          .prepare(
            "INSERT INTO settings(key, value) VALUES('preferences', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          )
          .run(JSON.stringify(command.settings));
      } else if (command.type === "item.save") {
        const input = command.item;
        if (input.linkedNoteId) {
          const note = this.db
            .prepare(
              "SELECT id FROM items WHERE id = ? AND kind = 'note' AND deleted_at IS NULL",
            )
            .get(input.linkedNoteId);
          if (!note) throw new Error("The linked note is no longer available.");
        }
        if (input.id) {
          const existing = this.db
            .prepare("SELECT * FROM items WHERE id = ? AND deleted_at IS NULL")
            .get(input.id);
          if (!existing) throw new Error("This item is no longer available.");
          if (existing.revision !== input.expectedRevision)
            throw new Error(
              "This item changed in another window or device. Reopen it before saving.",
            );
          if (existing.kind !== input.kind)
            throw new Error("An item cannot change between a task and a note.");
          this.db
            .prepare(
              `UPDATE items SET title = ?, body = ?, space = ?, priority = ?, scheduled_at = ?, recurrence = ?, linked_note_id = ?,
            notified_at = CASE WHEN scheduled_at IS ? THEN notified_at ELSE NULL END, tags = ?, note_style = ?, updated_at = ?, revision = revision + 1 WHERE id = ?`,
            )
            .run(
              input.title,
              input.body,
              input.space,
              Number(input.priority),
              input.scheduledAt,
              input.recurrence,
              input.linkedNoteId,
              input.scheduledAt,
              input.tags === undefined ? String(existing.tags) : JSON.stringify(input.tags),
              input.noteStyle === undefined ? String(existing.note_style) : JSON.stringify(input.noteStyle),
              timestamp,
              input.id,
            );
        } else {
          this.db
            .prepare(
              `INSERT INTO items(id, kind, title, body, space, priority, scheduled_at, recurrence, linked_note_id, tags, note_style, created_at, updated_at)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              randomUUID(),
              input.kind,
              input.title,
              input.body,
              input.space,
              Number(input.priority),
              input.scheduledAt,
              input.recurrence,
              input.linkedNoteId,
              JSON.stringify(input.tags ?? []),
              JSON.stringify(input.noteStyle ?? {}),
              timestamp,
              timestamp,
            );
        }
      } else {
        const row = this.db
          .prepare("SELECT * FROM items WHERE id = ?")
          .get(command.id);
        if (!row || (row.deleted_at && command.type !== "item.restore"))
          throw new Error("This item is no longer available.");
        if (command.type === "item.delete") {
          this.db
            .prepare(
              "UPDATE items SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ?",
            )
            .run(timestamp, timestamp, command.id);
        } else if (command.type === "item.restore") {
          this.db
            .prepare(
              "UPDATE items SET deleted_at = NULL, updated_at = ?, revision = revision + 1 WHERE id = ?",
            )
            .run(timestamp, command.id);
        } else if (command.type === "item.priority") {
          this.db
            .prepare(
              "UPDATE items SET priority = 1 - priority, updated_at = ?, revision = revision + 1 WHERE id = ?",
            )
            .run(timestamp, command.id);
        } else {
          if (row.kind !== "task")
            throw new Error("This action applies to tasks only.");
          if (command.type === "item.snooze") {
            if (row.done) throw new Error("Completed tasks cannot be snoozed.");
            const due = new Date(
              now.getTime() + command.minutes * 60_000,
            ).toISOString();
            this.db
              .prepare(
                "UPDATE items SET scheduled_at = ?, notified_at = NULL, updated_at = ?, revision = revision + 1 WHERE id = ?",
              )
              .run(due, timestamp, command.id);
          } else if (
            command.type === "item.toggle" ||
            command.type === "item.complete"
          ) {
            const done = command.type === "item.complete" || !row.done;
            this.db
              .prepare(
                "UPDATE items SET done = ?, updated_at = ?, revision = revision + 1 WHERE id = ?",
              )
              .run(Number(done), timestamp, command.id);
            if (!row.done && row.recurrence !== "none" && row.scheduled_at) {
              const existing = this.db
                .prepare("SELECT id FROM items WHERE recurrence_source_id = ?")
                .get(command.id);
              if (!existing) {
                const item = this.item(row as Row);
                const due = nextOccurrence(
                  item.scheduledAt!,
                  item.recurrence as Exclude<Item["recurrence"], "none">,
                  now,
                );
                this.db
                  .prepare(
                    `INSERT INTO items(id, kind, title, body, space, priority, scheduled_at, recurrence, linked_note_id, recurrence_source_id, created_at, updated_at)
                  VALUES(?, 'task', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  )
                  .run(
                    recurrenceId(item.id),
                    item.title,
                    item.body,
                    item.space,
                    Number(item.priority),
                    due,
                    item.recurrence,
                    item.linkedNoteId,
                    item.id,
                    timestamp,
                    timestamp,
                  );
              }
            }
          }
        }
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.snapshot();
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
      pending: Number(this.db.prepare("SELECT count(*) AS count FROM sync_items WHERE dirty = 1").get()!.count),
      conflicts: Number(this.db.prepare(`SELECT count(*) AS count FROM sync_conflicts
        JOIN items ON items.id = sync_conflicts.item_id WHERE deleted_at IS NULL`).get()!.count),
    };
  }

  syncCursor(): number {
    return Number(this.db.prepare("SELECT value FROM sync_meta WHERE key = 'cursor'").get()?.value ?? 0);
  }

  pendingChanges(): SyncMutation[] {
    return this.db.prepare(`SELECT items.*, sync_items.remote_version, sync_items.mutation_id
      FROM items JOIN sync_items ON items.id = sync_items.item_id WHERE dirty = 1
      AND (linked_note_id IS NULL OR EXISTS (SELECT 1 FROM sync_items AS dependency WHERE dependency.item_id = items.linked_note_id AND dependency.remote_version > 0))
      AND (recurrence_source_id IS NULL OR EXISTS (SELECT 1 FROM sync_items AS dependency WHERE dependency.item_id = items.recurrence_source_id AND dependency.remote_version > 0))
      ORDER BY created_at, items.id LIMIT 50`).all().map(row => ({
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
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT INTO sync_meta(key, value) VALUES('applying_remote', '1')").run();
      for (const record of records) {
        const { item, version } = record;
        const local = this.db.prepare(`SELECT items.*, remote_version, dirty FROM items
          JOIN sync_items ON items.id = sync_items.item_id WHERE items.id = ?`).get(item.id);
        if (local && Number(local.remote_version) >= version) continue;
        if (local?.dirty && !local.deleted_at && JSON.stringify({ ...this.syncItem(local as Row), createdAt: item.createdAt, updatedAt: item.updatedAt }) !== JSON.stringify(item)) {
          const copyId = randomUUID();
          this.db.prepare(`INSERT INTO items(id, kind, title, body, space, priority, done, scheduled_at, recurrence, linked_note_id, tags, note_style, created_at, updated_at)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(copyId, String(local.kind),
              `${String(local.title).slice(0, 484)} (conflict copy)`, String(local.body), String(local.space),
              Number(local.priority), Number(local.done), local.scheduled_at as string | null,
              String(local.recurrence), local.linked_note_id as string | null, String(local.tags), String(local.note_style), String(local.created_at), new Date().toISOString());
          this.db.prepare("INSERT INTO sync_items(item_id) VALUES(?)").run(copyId);
          this.db.prepare("INSERT INTO sync_conflicts(item_id) VALUES(?)").run(copyId);
        }
        this.db.prepare(`INSERT INTO items(id, kind, title, body, space, priority, done, scheduled_at, recurrence, linked_note_id, recurrence_source_id, deleted_at, tags, note_style, created_at, updated_at)
          VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET title = excluded.title, body = excluded.body, space = excluded.space,
          priority = excluded.priority, done = excluded.done, scheduled_at = excluded.scheduled_at,
          recurrence = excluded.recurrence, linked_note_id = excluded.linked_note_id,
          recurrence_source_id = excluded.recurrence_source_id, deleted_at = excluded.deleted_at,
          tags = excluded.tags, note_style = excluded.note_style,
          updated_at = excluded.updated_at, revision = items.revision + 1,
          notified_at = CASE WHEN items.scheduled_at IS excluded.scheduled_at THEN items.notified_at ELSE NULL END`)
          .run(item.id, item.kind, item.title, item.body, item.space, Number(item.priority), Number(item.done),
            item.scheduledAt, item.recurrence, item.linkedNoteId, item.recurrenceSourceId, item.deletedAt,
            JSON.stringify(item.tags), JSON.stringify(item.noteStyle), item.createdAt, item.updatedAt);
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
      AND scheduled_at <= ? AND notified_at IS NULL ORDER BY scheduled_at`,
      )
      .all(now.toISOString())
      .map((row) => this.item(row as Row));
  }

  markNotified(id: string, now: Date): void {
    this.db
      .prepare("UPDATE items SET notified_at = ? WHERE id = ?")
      .run(now.toISOString(), id);
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
