import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { itemInputSchema } from "@dock/contracts";
import { DockDatabase } from "./database.ts";
import { LocalServices, todoistRows } from "./local-services.ts";

test("local backups recover missing tasks and CSV imports hierarchy and priorities without overwriting current tasks", () => {
  mkdirSync(resolve(".validation"), { recursive: true });
  const directory = mkdtempSync(resolve(".validation", "services-test-"));
  const database = new DockDatabase(join(directory, "dock.sqlite"));
  try {
    const services = new LocalServices(directory, database);
    const original = database.execute({ type: "item.save", item: itemInputSchema.parse({ kind: "task", title: "Keep my changes" }) }).items[0]!;
    const now = new Date("2026-10-25T12:00:00Z");
    const blocked = join(directory, "backups", `dock-${now.toISOString().replace(/[:.Z]/g, "-")}.json.tmp`);
    mkdirSync(blocked);
    services.ensureDailyBackup(now);
    assert.match(services.state().message, /Automatic backup failed/);
    rmSync(blocked, { recursive: true });
    services.ensureDailyBackup(now);
    assert.equal(services.state().backups.length, 1);
    database.execute({ type: "item.save", item: itemInputSchema.parse({ ...original, expectedRevision: original.revision, title: "Updated after backup" }) });
    services.restore(services.state().backups[0]!.name);
    assert.equal(database.snapshot().items[0]!.title, "Updated after backup");
    services.importTodoist('TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,DATE\r\nsection,Launch,,,,\r\ntask,"Parent, task","Line one\nLine two",4,1,2026-10-26\r\ntask,Child,,1,2,\r\n', "Launch import");
    const snapshot = database.snapshot();
    const parent = snapshot.items.find(item => item.title === "Parent, task")!;
    const child = snapshot.items.find(item => item.title === "Child")!;
    assert.equal(parent.body, "Line one\nLine two");
    assert.equal(parent.task.priority, 1);
    assert.equal(child.task.priority, 4);
    assert.equal(child.task.parentId, parent.id);
    assert.equal(snapshot.workspace.projects.find(project => project.id === parent.task.projectId)!.sections[0]!.name, "Launch");
    const count = snapshot.items.length;
    assert.throws(() => services.importTodoist("TYPE,CONTENT,DATE\ntask,Invalid,every someday", "Bad"), /unsupported/);
    assert.equal(database.snapshot().items.length, count);
    assert.throws(() => services.restore("../dock.sqlite"), /Choose a Dock backup/);
  } finally { database.close(); rmSync(directory, { recursive: true }); }
});

test("attachments are profile-owned copies and executable file types are rejected", () => {
  const directory = mkdtempSync(resolve(".validation", "attachments-test-"));
  const database = new DockDatabase(join(directory, "dock.sqlite"));
  try {
    const services = new LocalServices(directory, database);
    const item = database.execute({ type: "item.save", item: itemInputSchema.parse({ kind: "task", title: "Attach this" }) }).items[0]!;
    const source = join(directory, "sample.txt");
    writeFileSync(source, "A local document");
    services.addAttachments(item.id, [source]);
    const attachment = database.snapshot().items[0]!.task.comments[0]!.attachments[0]!;
    assert.ok(services.attachmentPath(attachment.id).startsWith(join(directory, "attachments")));
    assert.notEqual(services.attachmentPath(attachment.id), source);
    const executable = join(directory, "danger.sh");
    writeFileSync(executable, "echo no");
    assert.throws(() => services.addAttachments(item.id, [executable]), /Choose an image/);
    assert.equal(database.snapshot().items[0]!.task.comments.length, 1);
    assert.throws(() => services.attachmentPath("missing"), /unavailable/);
  } finally { database.close(); rmSync(directory, { recursive: true }); }
});

test("CSV parser preserves escaped quotes and rejects truncated input", () => {
  assert.equal(todoistRows('TYPE,CONTENT\ntask,"Say ""hello"""')[0]!.CONTENT, 'Say "hello"');
  assert.throws(() => todoistRows('TYPE,CONTENT\ntask,"unfinished'), /unclosed/);
});
