import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { commandSchema, taskPropertiesSchema, workspaceSchema, syncItemSchema, type ItemInput, type DataCommand } from "@dock/contracts";
import { DockDatabase } from "./database.ts";
import { schema, syncSchema, notesSchema } from "./schema.ts";

const now = new Date("2026-10-25T12:00:00Z");
function dataCommand(input: unknown): DataCommand {
  const command = commandSchema.parse(input);
  if (command.type !== "item.save" && command.type !== "workspace.save" && command.type !== "item.bulk" && command.type !== "template.apply")
    throw new Error("Expected a test data command.");
  return command;
}
function save(database: DockDatabase, input: ItemInput) {
  return database.execute(dataCommand({ type: "item.save", item: input }), now);
}

test("v3 migration preserves important tasks, rich notes and completion history", () => {
  const directory = mkdtempSync(join(resolve(".validation"), "task-migration-"));
  const filename = join(directory, "dock.sqlite");
  const old = new DatabaseSync(filename);
  const taskId = randomUUID();
  const noteId = randomUUID();
  old.exec(schema + syncSchema + notesSchema);
  old.prepare(`INSERT INTO items(id,kind,title,body,priority,done,created_at,updated_at,tags,note_style,space)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Inbox')`).run(taskId, "task", "Review", "", 1, 1, now.toISOString(), now.toISOString(), "[]", "{}");
  old.prepare(`INSERT INTO items(id,kind,title,body,created_at,updated_at,tags,note_style,space)
    VALUES(?, 'note', 'Writing', ?, ?, ?, ?, ?, 'Inbox')`).run(noteId, "<h2>العربية</h2>", now.toISOString(), now.toISOString(), '["reference"]', '{"font":"serif"}');
  old.close();
  const database = new DockDatabase(filename);
  try {
    const state = database.snapshot();
    assert.equal(state.items.find(item => item.id === taskId)?.task.priority, 1);
    assert.equal(state.items.find(item => item.id === taskId)?.completedAt, now.toISOString());
    assert.equal(state.items.find(item => item.id === noteId)?.body, "<h2>العربية</h2>");
    assert.equal(state.items.find(item => item.id === noteId)?.noteStyle.font, "serif");
    assert.equal(state.workspace.goals.daily, 5);
  } finally { database.close(); rmSync(directory, { recursive: true }); }
});

test("task properties, sections, subtasks and bulk edits persist with atomic revision checks", () => {
  const database = new DockDatabase(":memory:");
  const projectId = randomUUID();
  const sectionId = randomUUID();
  try {
    database.execute(dataCommand({ type: "workspace.save", workspace: workspaceSchema.parse({
      projects: [{ id: projectId, name: "Launch", sections: [{ id: sectionId, name: "Doing" }] }],
    }) }));
    const parent = save(database, { kind: "task", title: "Ship", task: { projectId, sectionId, priority: 2,
      deadline: "2026-10-30T17:00:00Z", durationMinutes: 90, reminders: ["2026-10-25T11:45:00Z"] } }).items[0]!;
    const child = save(database, { kind: "task", title: "Review", task: { parentId: parent.id, projectId, sectionId } })
      .items.find(item => item.title === "Review")!;
    assert.equal(parent.priority, true);
    assert.equal(parent.task.priority, 2);
    assert.throws(() => save(database, { ...parent, expectedRevision: parent.revision, task: { ...parent.task, parentId: child.id } }), /own parent/);
    assert.throws(() => database.execute(dataCommand({ type: "item.bulk", ids: [parent.id, child.id], action: "update",
      expectedRevisions: { [parent.id]: parent.revision, [child.id]: child.revision + 1 }, patch: { task: { priority: 1 } } })), /changed/);
    assert.equal(database.snapshot().items.find(item => item.id === parent.id)?.task.priority, 2);
    const changed = database.execute(dataCommand({ type: "item.bulk", ids: [parent.id, child.id], action: "update", patch: { tags: ["release"], task: { priority: 3 } } }));
    assert.equal(changed.items.every(item => item.task.priority === 3 && item.tags[0] === "release"), true);
    assert.equal(changed.items.find(item => item.id === parent.id)?.task.durationMinutes, 90);
    const freshParent = changed.items.find(item => item.id === parent.id)!;
    save(database, { ...freshParent, expectedRevision: freshParent.revision, task: undefined, title: "Ship Dock" });
    assert.equal(database.snapshot().items.find(item => item.id === parent.id)?.task.durationMinutes, 90);
    const nextProjectId = randomUUID();
    database.execute(dataCommand({ type: "workspace.save", workspace: { ...database.workspace(), projects: [...database.workspace().projects, { id: nextProjectId, name: "Next" }] } }));
    database.execute(dataCommand({ type: "item.bulk", ids: [parent.id, child.id], action: "update", patch: { task: { projectId: nextProjectId, sectionId: null } } }));
    assert.equal(database.snapshot().items.every(item => item.task.projectId === nextProjectId), true);
    assert.equal(database.snapshot().items.find(item => item.id === child.id)?.task.parentId, parent.id);
    const pending = database.pendingChanges();
    assert.equal(pending.some(change => change.item.id === parent.id), true);
    assert.equal(pending.some(change => change.item.id === child.id), false);
    const parentMutation = pending.find(change => change.item.id === parent.id)!;
    database.acknowledgeSync(parentMutation, 1);
    assert.equal(database.pendingChanges().some(change => change.item.id === child.id), true);
    const oldWire = { ...parentMutation.item } as Record<string, unknown>;
    delete oldWire.task;
    assert.equal(syncItemSchema.parse({ ...oldWire, priority: true }).task.priority, 1);
    database.execute({ type: "item.complete", id: parent.id }, now);
    assert.equal(database.snapshot().items.every(item => item.done), true);
    database.execute({ type: "item.toggle", id: parent.id }, now);
    assert.equal(database.snapshot().items.find(item => item.id === child.id)?.done, true);
    database.execute({ type: "item.delete", id: child.id }, new Date(now.getTime() - 1000));
    database.execute({ type: "item.delete", id: parent.id }, now);
    database.execute({ type: "item.restore", id: parent.id }, now);
    assert.equal(database.snapshot().items.some(item => item.id === child.id), false);
    database.execute({ type: "item.restore", id: child.id }, now);
    const latest = database.snapshot();
    database.execute(dataCommand({ type: "item.bulk", ids: [parent.id, child.id], action: "delete",
      expectedRevisions: Object.fromEntries(latest.items.map(item => [item.id, item.revision])) }), now);
    assert.equal(database.snapshot().items.length, 0);
    database.execute({ type: "item.restore", id: parent.id }, now);
    assert.equal(database.snapshot().items.length, 2);
    const templateId = randomUUID();
    database.execute(dataCommand({ type: "workspace.save", workspace: { ...database.workspace(), templates: [{
      id: templateId, name: "Release checklist", tasks: [{ title: "Plan", task: taskPropertiesSchema.parse({ priority: 1, durationMinutes: 45 }) }, { title: "Ship" }],
    }] } }));
    const before = database.snapshot().items.length;
    assert.throws(() => database.execute(dataCommand({ type: "template.apply", id: templateId, projectId: randomUUID() })), /project/);
    assert.equal(database.snapshot().items.length, before);
    database.execute(dataCommand({ type: "template.apply", id: templateId, projectId }));
    assert.equal(database.snapshot().items.length, before + 2);
    assert.equal(database.snapshot().items.find(item => item.title === "Plan")?.task.durationMinutes, 45);
  } finally { database.close(); }
});

test("custom recurrence preserves task metadata and shifts reminders after completion", () => {
  const database = new DockDatabase(":memory:");
  try {
    const original = save(database, { kind: "task", title: "Water plants", tags: ["home"], recurrence: "custom", scheduledAt: "2026-10-20T09:00:00Z",
      task: { priority: 3, durationMinutes: 10, repeat: { interval: 2, unit: "day", afterCompletion: true }, reminders: ["2026-10-20T08:45:00Z"] } }).items[0]!;
    const state = database.execute({ type: "item.complete", id: original.id }, now);
    const next = state.items.find(item => item.id !== original.id)!;
    assert.equal(next.scheduledAt, "2026-10-27T12:00:00.000Z");
    assert.equal(next.task.reminders[0], "2026-10-27T11:45:00.000Z");
    assert.equal(next.tags[0], "home");
    assert.equal(next.task.priority, 3);
    assert.equal(state.items.find(item => item.id === original.id)?.completedAt, now.toISOString());
    database.execute({ type: "item.complete", id: original.id }, now);
    assert.equal(database.snapshot().items.length, 2);
    const restored = new DockDatabase(":memory:");
    try {
      restored.restoreBackup(database.backup());
      restored.execute({ type: "item.toggle", id: original.id }, now);
      restored.execute({ type: "item.complete", id: original.id }, now);
      assert.equal(restored.snapshot().items.length, 2);
    } finally { restored.close(); }
  } finally { database.close(); }
});

test("backup restore is additive, transactionally validates relationships, and revives deleted records", () => {
  const source = new DockDatabase(":memory:");
  const target = new DockDatabase(":memory:");
  try {
    const note = save(source, { kind: "note", title: "Reference", body: "Keep me" }).items[0]!;
    const task = save(source, { kind: "task", title: "Do it", linkedNoteId: note.id, task: { priority: 2 } }).items.find(item => item.kind === "task")!;
    const backup = source.backup();
    assert.equal(target.restoreBackup(backup), 2);
    assert.equal(target.restoreBackup(backup), 0);
    const latest = target.snapshot().items.find(item => item.id === note.id)!;
    save(target, { ...latest, expectedRevision: latest.revision, body: "Newer work" });
    target.restoreBackup(backup);
    assert.equal(target.snapshot().items.find(item => item.id === note.id)?.body, "Newer work");
    target.execute({ type: "item.delete", id: task.id });
    assert.equal(target.restoreBackup(backup), 1);
    assert.equal(target.snapshot().items.length, 2);
    assert.throws(() => target.restoreBackup({ items: [{ ...task, id: randomUUID(), task: taskPropertiesSchema.parse({ parentId: randomUUID() }) }] }), /parent task/);
    assert.equal(target.snapshot().items.length, 2);
  } finally { source.close(); target.close(); }
});

test("revoked shared projects retain local records but hide data and pending mutations until access returns", () => {
  const database = new DockDatabase(":memory:");
  const project = workspaceSchema.parse({ projects: [{ id: randomUUID(), name: "Shared" }] }).projects[0]!;
  try {
    database.applySharedProjects([project], [project.id]);
    const item = save(database, { kind: "task", title: "Shared task", task: { projectId: project.id } }).items[0]!;
    assert.equal(database.syncCounts().pending, 1);
    database.applySharedProjects([], []);
    assert.equal(database.snapshot().items.length, 0);
    assert.equal(database.pendingChanges().length, 0);
    assert.equal(database.syncCounts().pending, 0);
    assert.throws(() => database.execute({ type: "item.complete", id: item.id }), /access/);
    database.applySharedProjects([project], [project.id]);
    assert.equal(database.snapshot().items[0]?.id, item.id);
  } finally { database.close(); }
});

test("one bulk Undo restores changed descendants and preserves earlier completed or deleted children", () => {
  const database = new DockDatabase(":memory:");
  try {
    const parent = save(database, { kind: "task", title: "Parent" }).items[0]!;
    const activeChild = save(database, { kind: "task", title: "Active child", task: { parentId: parent.id } }).items.find(item => item.title === "Active child")!;
    const doneChild = save(database, { kind: "task", title: "Earlier done child", task: { parentId: parent.id } }).items.find(item => item.title === "Earlier done child")!;
    const other = save(database, { kind: "task", title: "Other" }).items.find(item => item.title === "Other")!;
    database.execute({ type: "item.complete", id: doneChild.id }, new Date(now.getTime() - 1000));
    const completedAt = database.snapshot().items.find(item => item.id === doneChild.id)!.completedAt;
    const completed = database.execute(dataCommand({ type: "item.bulk", ids: [parent.id, other.id], action: "complete" }), now);
    assert.equal(completed.undo?.action, "complete");
    assert.equal(completed.undo?.count, 3);
    const restored = database.execute({ type: "item.undo", token: completed.undo!.token }, now);
    assert.equal(restored.undo, null);
    assert.equal(restored.items.find(item => item.id === parent.id)!.done, false);
    assert.equal(restored.items.find(item => item.id === activeChild.id)!.done, false);
    assert.equal(restored.items.find(item => item.id === other.id)!.done, false);
    assert.equal(restored.items.find(item => item.id === doneChild.id)!.completedAt, completedAt);
    database.execute({ type: "item.delete", id: activeChild.id }, new Date(now.getTime() - 1000));
    const deleted = database.execute(dataCommand({ type: "item.bulk", ids: [parent.id, other.id], action: "delete" }), now);
    assert.equal(deleted.undo?.count, 3);
    const recovered = database.execute({ type: "item.undo", token: deleted.undo!.token }, now);
    assert.equal(recovered.items.some(item => item.id === activeChild.id), false);
    assert.equal(recovered.items.find(item => item.id === doneChild.id)!.done, true);
    assert.equal(recovered.items.some(item => item.id === parent.id), true);
    assert.equal(recovered.items.some(item => item.id === other.id), true);
  } finally { database.close(); }
});

test("Undo rejects later edits atomically and restores a deleted note without changing linked tasks", () => {
  const database = new DockDatabase(":memory:");
  try {
    const first = save(database, { kind: "task", title: "First" }).items[0]!;
    const second = save(database, { kind: "task", title: "Second" }).items.find(item => item.title === "Second")!;
    const completed = database.execute(dataCommand({ type: "item.bulk", ids: [first.id, second.id], action: "complete" }), now);
    const changed = completed.items.find(item => item.id === second.id)!;
    save(database, { ...changed, expectedRevision: changed.revision, body: "A later edit" });
    assert.throws(() => database.execute({ type: "item.undo", token: completed.undo!.token }, now), /later changes are safe/);
    assert.equal(database.snapshot().items.find(item => item.id === first.id)!.done, true);
    assert.equal(database.snapshot().items.find(item => item.id === second.id)!.body, "A later edit");
    const note = save(database, { kind: "note", title: "Context" }).items.find(item => item.kind === "note")!;
    const linked = save(database, { kind: "task", title: "Linked", linkedNoteId: note.id }).items.find(item => item.title === "Linked")!;
    const deleted = database.execute({ type: "item.delete", id: note.id }, now);
    assert.throws(() => database.execute({ type: "item.undo", token: completed.undo!.token }, now), /no longer available/);
    const restored = database.execute({ type: "item.undo", token: deleted.undo!.token }, now);
    assert.equal(restored.items.find(item => item.id === note.id)!.title, "Context");
    assert.equal(restored.items.find(item => item.id === linked.id)!.linkedNoteId, note.id);
  } finally { database.close(); }
});

test("Undo completion hides its recurring follow-up and recompletion after restart revives exactly one occurrence", () => {
  const directory = mkdtempSync(join(resolve(".validation"), "undo-recurrence-"));
  const filename = join(directory, "dock.sqlite");
  let database = new DockDatabase(filename);
  try {
    const original = save(database, { kind: "task", title: "Daily review", scheduledAt: now.toISOString(), recurrence: "daily" }).items[0]!;
    const completed = database.execute({ type: "item.complete", id: original.id }, now);
    const followUp = completed.items.find(item => item.id !== original.id)!;
    assert.equal(completed.undo?.count, 1);
    const undone = database.execute({ type: "item.undo", token: completed.undo!.token }, now);
    assert.equal(undone.items.length, 1);
    assert.equal(undone.items[0]!.done, false);
    assert.equal(undone.deletedItems.some(item => item.id === followUp.id), true);
    database.close();
    database = new DockDatabase(filename);
    const recompleted = database.execute({ type: "item.complete", id: original.id }, now);
    assert.equal(recompleted.items.length, 2);
    assert.equal(recompleted.items.find(item => item.id === followUp.id)!.done, false);
    assert.equal(recompleted.undo?.count, 1);
    assert.equal(database.pendingChanges().some(change => change.item.id === original.id), true);
    const final = database.execute({ type: "item.undo", token: recompleted.undo!.token }, now);
    assert.equal(final.items.length, 1);
    const again = database.execute({ type: "item.complete", id: original.id }, now);
    save(database, { kind: "task", title: "New work", task: { parentId: followUp.id } });
    assert.throws(() => database.execute({ type: "item.undo", token: again.undo!.token }, now), /new linked work/);
    assert.equal(database.snapshot().items.find(item => item.id === original.id)!.done, true);
    assert.equal(database.snapshot().items.some(item => item.id === followUp.id), true);
  } finally { database.close(); rmSync(directory, { recursive: true }); }
});

test("Work and Personal space tasks move into projects once, and permanent delete wipes trashed items", () => {
  const directory = mkdtempSync(join(resolve(".validation"), "task-spaces-"));
  const filename = join(directory, "dock.sqlite");
  try {
    let database = new DockDatabase(filename);
    database.execute(dataCommand({ type: "workspace.save", workspace: workspaceSchema.parse({ projects: [{ id: randomUUID(), name: "work" }] }) }), now);
    const parent = save(database, { kind: "task", title: "Ship", space: "Work" }).items[0]!;
    save(database, { kind: "task", title: "Draft", space: "Inbox", task: taskPropertiesSchema.parse({ parentId: parent.id }) });
    save(database, { kind: "task", title: "Gym", space: "Personal" });
    save(database, { kind: "note", title: "Ideas", space: "Work" });
    database.close();
    // Simulate a database from before spaces were folded into projects.
    const raw = new DatabaseSync(filename);
    raw.exec("DELETE FROM settings WHERE key = 'spaces_folded'");
    raw.close();
    database = new DockDatabase(filename);
    let state = database.snapshot();
    const work = state.workspace.projects.find(project => project.name === "work")!;
    const personal = state.workspace.projects.find(project => project.name === "Personal")!;
    assert.equal(state.workspace.projects.length, 2);
    assert.deepEqual(state.items.filter(item => item.kind === "task").map(item => [item.title, item.task.projectId]).sort(),
      [["Draft", work.id], ["Gym", personal.id], ["Ship", work.id]]);
    assert.equal(state.items.find(item => item.kind === "note")!.task.projectId, null);

    database.execute(commandSchema.parse({ type: "item.delete", id: parent.id }) as DataCommand, now);
    assert.equal(database.snapshot().deletedItems.length, 2);
    database.execute(commandSchema.parse({ type: "item.purge", id: parent.id }) as DataCommand, now);
    state = database.snapshot();
    assert.equal(state.deletedItems.length, 0);
    assert.ok(database.pendingChanges().some(change => change.item.id === parent.id && change.item.title === "Deleted item" && change.item.deletedAt));
    database.close();
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("removing a board column moves its tasks to No section and keeps hidden columns", () => {
  const directory = mkdtempSync(join(resolve(".validation"), "task-columns-"));
  try {
    const database = new DockDatabase(join(directory, "dock.sqlite"));
    const projectId = randomUUID(), doing = randomUUID(), done = randomUUID();
    const project = { id: projectId, name: "Board", sections: [{ id: doing, name: "Doing" }, { id: done, name: "Done" }], hiddenColumns: ["none"] };
    database.execute(dataCommand({ type: "workspace.save", workspace: workspaceSchema.parse({ projects: [project] }) }), now);
    const task = save(database, { kind: "task", title: "Card", task: taskPropertiesSchema.parse({ projectId, sectionId: doing }) }).items[0]!;
    const state = database.execute(dataCommand({ type: "workspace.save", workspace: workspaceSchema.parse({ projects: [{ ...project, sections: [project.sections[1]] }] }) }), now);
    const card = state.items.find(item => item.id === task.id)!;
    assert.equal(card.task.sectionId, null);
    assert.equal(card.revision, task.revision + 1);
    assert.deepEqual(state.workspace.projects[0]!.hiddenColumns, ["none"]);
    save(database, { id: card.id, expectedRevision: card.revision, kind: "task", title: "Card edited", task: card.task });
    database.close();
  } finally {
    rmSync(directory, { recursive: true });
  }
});


test("board reorder is atomic, revision checked and preserves task fields", () => {
  const database = new DockDatabase(":memory:");
  const projectId = randomUUID(), sectionId = randomUUID();
  try {
    database.execute({ type: "workspace.save", workspace: workspaceSchema.parse({ projects: [{ id: projectId, name: "Board", sections: [{ id: sectionId, name: "Queue" }] }] }) });
    const first = save(database, { kind: "task", title: "First", body: "Keep context", task: { projectId, sectionId, order: 0 } }).items[0]!;
    const second = save(database, { kind: "task", title: "Second", task: { projectId, sectionId, order: 0 } }).items.find(item => item.id !== first.id)!;
    const reorder = { type: "item.reorder" as const, projectId, sectionId: null, ids: [second.id, first.id], expectedRevisions: { [first.id]: first.revision, [second.id]: second.revision } };
    assert.throws(() => database.execute({ ...reorder, expectedRevisions: { ...reorder.expectedRevisions, [first.id]: 99 } }), /changed/);
    assert.ok(database.snapshot().items.every(item => item.task.sectionId === sectionId && item.revision === 1));
    const result = database.execute(reorder);
    assert.equal(result.items.find(item => item.id === first.id)!.task.order, 1);
    assert.equal(result.items.find(item => item.id === second.id)!.task.order, 0);
    assert.ok(result.items.every(item => item.task.sectionId === null && item.revision === 2));
    assert.equal(result.items.find(item => item.id === first.id)!.body, "Keep context");
    assert.throws(() => commandSchema.parse({ ...reorder, ids: [first.id, first.id] }), /only once/);
  } finally { database.close(); }
});
