import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  itemSchema,
  nextOccurrence,
  settingsSchema,
  type DataCommand,
  type Item,
  type StoreSnapshot,
} from "@dock/contracts";
import { schema } from "./schema.ts";

type Row = Record<string, string | number | null>;

export class DockDatabase {
  private readonly db: DatabaseSync;

  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    this.db.exec("PRAGMA busy_timeout = 5000");
    const version = this.db.prepare("PRAGMA user_version").get()?.user_version;
    if (typeof version === "number" && version > 1) {
      this.db.close();
      throw new Error("This database was created by a newer version of Dock.");
    }
    this.db.exec(schema);
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
              "This item changed in another window or command. Reopen it before saving.",
            );
          if (existing.kind !== input.kind)
            throw new Error("An item cannot change between a task and a note.");
          this.db
            .prepare(
              `UPDATE items SET title = ?, body = ?, space = ?, priority = ?, scheduled_at = ?, recurrence = ?, linked_note_id = ?,
            notified_at = CASE WHEN scheduled_at IS ? THEN notified_at ELSE NULL END, updated_at = ?, revision = revision + 1 WHERE id = ?`,
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
              timestamp,
              input.id,
            );
        } else {
          this.db
            .prepare(
              `INSERT INTO items(id, kind, title, body, space, priority, scheduled_at, recurrence, linked_note_id, created_at, updated_at)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
                    randomUUID(),
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
