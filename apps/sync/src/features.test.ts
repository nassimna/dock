import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { commandSchema, syncItemSchema, syncSessionSchema } from "../../../packages/contracts/src/index.ts";
import { startSyncFixture } from "./server.fixture.ts";
import { DockDatabase } from "../../desktop/src/main/database.ts";
import { DockSync } from "../../desktop/src/main/sync.ts";

async function fixture() {
  assert.ok(process.env.DOCK_TEST_ROOT, "Use task-owned disk-backed test storage.");
  const directory = mkdtempSync(join(process.env.DOCK_TEST_ROOT, "sync-features-"));
  const server = await startSyncFixture(directory);
  const request = (path: string, body?: unknown, token?: string) => fetch(server.endpoint + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const signup = async (email: string) => {
    const response = await request("/auth/signup", { email, password: "long-test-password-2026", inviteCode: server.env.REGISTRATION_SECRET, deviceName: "Test Mac" });
    assert.equal(response.status, 200);
    return response.json() as Promise<{ accountId: string; email: string; token: string; expiresAt: string; recoveryCode: string }>;
  };
  return { server, request, signup, async close() { await server.close(); rmSync(directory, { recursive: true }); } };
}

test("recovery codes rotate, reset revokes old sessions, and device revocation is account-scoped", async () => {
  const f = await fixture();
  try {
    const a = await f.signup("recovery@example.com");
    const b = await f.signup("other@example.com");
    assert.match(a.recoveryCode, /^[0-9a-f]{64}$/);
    assert.notEqual(f.server.database.prepare("SELECT recovery_hash FROM accounts WHERE id = ?").get(a.accountId)!.recovery_hash, a.recoveryCode);
    const second = syncSessionSchema.parse(await (await f.request("/auth/login", { email: a.email, password: "long-test-password-2026", deviceName: "Second Mac" })).json());
    const devices = await (await f.request("/auth/devices", undefined, a.token)).json() as { devices: { id: string; name: string; current: boolean }[] };
    assert.equal(devices.devices.length, 2);
    const otherDevice = devices.devices.find(device => !device.current)!;
    assert.equal(otherDevice.name, "Second Mac");
    assert.equal((await f.request("/auth/revoke", { id: otherDevice.id }, b.token)).status, 200);
    assert.equal((await f.request("/account", undefined, second.token)).status, 200);
    assert.equal((await f.request("/auth/revoke", { id: otherDevice.id }, a.token)).status, 200);
    assert.equal((await f.request("/account", undefined, second.token)).status, 401);
    assert.equal((await f.request("/auth/recover", { email: a.email, password: "new-test-password-2026", recoveryCode: "0".repeat(64) })).status, 401);
    const recoveredResponse = await f.request("/auth/recover", { email: a.email, password: "new-test-password-2026", recoveryCode: a.recoveryCode });
    assert.equal(recoveredResponse.status, 200);
    const recovered = await recoveredResponse.json() as { token: string; recoveryCode: string };
    assert.notEqual(recovered.recoveryCode, a.recoveryCode);
    assert.equal((await f.request("/account", undefined, a.token)).status, 401);
    assert.equal((await f.request("/account", undefined, recovered.token)).status, 200);
    assert.equal((await f.request("/auth/recover", { email: a.email, password: "next-test-password-2026", recoveryCode: a.recoveryCode })).status, 401);
    assert.equal((await f.request("/auth/login", { email: a.email, password: "new-test-password-2026" })).status, 200);
  } finally { await f.close(); }
});

test("project members share versioned tasks; outsiders and revoked members cannot read or change them", async () => {
  const f = await fixture();
  try {
    const owner = await f.signup("owner@example.com");
    const member = await f.signup("member@example.com");
    const outsider = await f.signup("outsider@example.com");
    const project = { id: randomUUID(), name: "Launch", parentId: null, color: "#a78bfa", favorite: true, sections: [{ id: randomUUID(), name: "In progress" }] };
    assert.equal((await f.request("/projects", { project }, owner.token)).status, 200);
    assert.equal((await f.request("/projects/invite", { projectId: project.id, email: member.email }, owner.token)).status, 200);
    assert.equal((await f.request("/projects/invite", { projectId: project.id, email: outsider.email }, member.token)).status, 403);
    const item = syncItemSchema.parse({ id: randomUUID(), kind: "task", title: "Shared work", body: "", space: "Work", priority: true, done: false, scheduledAt: null, recurrence: "none", linkedNoteId: null,
      recurrenceSourceId: null, deletedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), task: { projectId: project.id, sectionId: project.sections[0]!.id, assignee: member.email } });
    const privateItem = { ...item, id: randomUUID(), title: "Owner private work", task: { ...item.task, projectId: null, sectionId: null, assignee: "" } };
    assert.equal((await f.request("/sync", { item: privateItem, mutationId: randomBytes(16).toString("hex"), baseVersion: 0 }, owner.token)).status, 200);
    const dependentProject = { ...project, id: randomUUID(), name: "Private recurrence project" };
    const dependent = { ...privateItem, id: randomUUID(), recurrenceSourceId: privateItem.id, task: { ...privateItem.task, projectId: dependentProject.id } };
    assert.equal((await f.request("/sync", { item: dependent, mutationId: randomBytes(16).toString("hex"), baseVersion: 0 }, owner.token)).status, 200);
    assert.equal((await f.request("/projects", { project: dependentProject }, owner.token)).status, 400);
    const forged = { ...privateItem, title: "Stolen", task: { ...privateItem.task, projectId: project.id } };
    assert.equal((await f.request("/sync", { item: forged, mutationId: randomBytes(16).toString("hex"), baseVersion: 1 }, member.token)).status, 403);
    const mutation = { item, mutationId: randomBytes(16).toString("hex"), baseVersion: 0 };
    const created = await f.request("/sync", mutation, member.token);
    assert.equal(created.status, 200);
    assert.equal((await created.json()).version, 1);
    const owned = f.server.database.prepare("SELECT account_id FROM records WHERE item_id = ?").get(item.id)!;
    assert.equal(owned.account_id, owner.accountId);
    const shared = await (await f.request("/projects", undefined, member.token)).json();
    assert.equal(shared.projects[0].members.length, 2);
    assert.equal(shared.records[0].item.id, item.id);
    assert.equal((await (await f.request("/sync?cursor=0", undefined, owner.token)).json()).changes.some((change: { item: { id: string } }) => change.item.id === item.id), true);
    assert.equal((await (await f.request("/sync?cursor=0", undefined, outsider.token)).json()).changes.length, 0);
    assert.equal((await f.request("/sync", { ...mutation, mutationId: randomBytes(16).toString("hex"), baseVersion: 1 }, outsider.token)).status, 403);
    const changed = { ...mutation, mutationId: randomBytes(16).toString("hex"), baseVersion: 1, item: { ...item, title: "Finished draft" } };
    assert.equal((await f.request("/sync", changed, owner.token)).status, 200);
    assert.equal((await f.request("/sync", { ...changed, mutationId: randomBytes(16).toString("hex"), baseVersion: 2, item: { ...changed.item, task: { ...item.task, assignee: outsider.email } } }, member.token)).status, 400);
    assert.equal((await f.request("/projects/remove", { projectId: project.id, email: member.email }, owner.token)).status, 200);
    assert.equal((await (await f.request("/projects", undefined, member.token)).json()).records.length, 0);
    assert.equal((await (await f.request("/sync?cursor=0", undefined, member.token)).json()).changes.length, 0);
    assert.equal((await f.request("/sync", { ...changed, mutationId: randomBytes(16).toString("hex"), baseVersion: 2 }, member.token)).status, 403);
  } finally { await f.close(); }
});

test("two account clients bootstrap shared metadata and hide revoked offline edits without uploading them", async () => {
  const f = await fixture();
  const clientDirectory = mkdtempSync(join(process.env.DOCK_TEST_ROOT!, "shared-clients-"));
  const a = new DockDatabase(join(clientDirectory, "a.sqlite"));
  const b = new DockDatabase(join(clientDirectory, "b.sqlite"));
  const syncA = new DockSync(a, () => {});
  const syncB = new DockSync(b, () => {});
  try {
    const owner = await f.signup("client-owner@example.com");
    const member = await f.signup("client-member@example.com");
    syncA.restore({ ...owner, endpoint: f.server.endpoint });
    syncB.restore({ ...member, endpoint: f.server.endpoint });
    const project = { id: randomUUID(), name: "Client project", parentId: null, color: "#b49bdf", favorite: false, sections: [] };
    a.execute({ type: "workspace.save", workspace: { ...a.snapshot().workspace, projects: [project] } });
    a.execute(commandSchema.parse({ type: "item.save", item: { kind: "task", title: "Shared client task", task: { projectId: project.id } } }) as Extract<ReturnType<typeof commandSchema.parse>, { type: "item.save" }>);
    await syncA.feature({ type: "sync.project.share", project });
    await syncA.feature({ type: "sync.project.invite", projectId: project.id, email: member.email });
    await syncA.sync(); await syncB.sync();
    assert.equal(b.snapshot().workspace.projects[0]!.id, project.id);
    const shared = b.snapshot().items.find(item => item.title === "Shared client task")!;
    assert.ok(shared);
    b.execute(commandSchema.parse({ type: "item.save", item: { ...shared, expectedRevision: shared.revision, title: "Member edit" } }) as Extract<ReturnType<typeof commandSchema.parse>, { type: "item.save" }>);
    await syncB.sync(); await syncA.sync();
    assert.equal(a.snapshot().items.find(item => item.id === shared.id)!.title, "Member edit");
    const edited = b.snapshot().items.find(item => item.id === shared.id)!;
    b.execute(commandSchema.parse({ type: "item.save", item: { ...edited, expectedRevision: edited.revision, title: "Revoked edit" } }) as Extract<ReturnType<typeof commandSchema.parse>, { type: "item.save" }>);
    await syncA.feature({ type: "sync.project.remove", projectId: project.id, email: member.email });
    await syncB.sync(); await syncA.sync();
    assert.equal(b.snapshot().items.some(item => item.id === shared.id), false);
    assert.equal(b.snapshot().workspace.projects.length, 0);
    assert.equal(syncB.status().pending, 0);
    assert.equal(a.snapshot().items.find(item => item.id === shared.id)!.title, "Member edit");
  } finally {
    await syncA.stop(); await syncB.stop(); a.close(); b.close(); await f.close(); rmSync(clientDirectory, { recursive: true });
  }
});

test("private nested project metadata follows account tasks and concurrent additions merge without sharing", async () => {
  const f = await fixture();
  const directory = mkdtempSync(join(process.env.DOCK_TEST_ROOT!, "private-projects-"));
  const a = new DockDatabase(join(directory, "a.sqlite"));
  const b = new DockDatabase(join(directory, "b.sqlite"));
  const syncA = new DockSync(a, () => {});
  const syncB = new DockSync(b, () => {});
  try {
    const account = await f.signup("private-projects@example.com");
    const outsider = await f.signup("no-access@example.com");
    syncA.restore({ ...account, endpoint: f.server.endpoint });
    const second = await syncB.authenticate({ type: "sync.login", endpoint: f.server.endpoint, email: account.email, password: "long-test-password-2026" });
    syncB.restore(second);
    const parent = { id: randomUUID(), name: "Work", parentId: null, color: "#b49bdf", favorite: true, sections: [] };
    const child = { ...parent, id: randomUUID(), name: "Launch", parentId: parent.id, sections: [{ id: randomUUID(), name: "Design" }] };
    a.execute({ type: "workspace.save", workspace: { ...a.snapshot().workspace, projects: [parent, child] } });
    const command = commandSchema.parse({ type: "item.save", item: { kind: "task", title: "Private design", task: { projectId: child.id, sectionId: child.sections[0]!.id } } });
    if (command.type !== "item.save") throw new Error("Expected task save.");
    a.execute(command);
    await syncA.sync(); await syncB.sync();
    assert.equal(b.snapshot().workspace.projects.find(project => project.id === child.id)!.parentId, parent.id);
    const item = b.snapshot().items.find(item => item.title === "Private design")!;
    assert.ok(item);
    const edit = commandSchema.parse({ type: "item.save", item: { ...item, expectedRevision: item.revision, title: "Edited on second Mac" } });
    if (edit.type !== "item.save") throw new Error("Expected task save.");
    b.execute(edit);
    const alpha = { ...parent, id: randomUUID(), name: "Alpha" };
    const beta = { ...parent, id: randomUUID(), name: "Beta" };
    a.execute({ type: "workspace.save", workspace: { ...a.snapshot().workspace, projects: [...a.snapshot().workspace.projects, alpha] } });
    b.execute({ type: "workspace.save", workspace: { ...b.snapshot().workspace, projects: [...b.snapshot().workspace.projects, beta] } });
    await syncA.sync(); await syncB.sync(); await syncA.sync();
    assert.deepEqual(a.snapshot().workspace.projects.map(project => project.name).sort(), ["Alpha", "Beta", "Launch", "Work"]);
    assert.equal(a.snapshot().items.find(task => task.id === item.id)!.title, "Edited on second Mac");
    assert.equal((await (await f.request("/workspace", undefined, outsider.token)).json()).projects.length, 0);
    assert.equal((await (await f.request("/projects", undefined, account.token)).json()).projects.length, 0);
  } finally {
    await syncA.stop(); await syncB.stop(); a.close(); b.close(); await f.close(); rmSync(directory, { recursive: true });
  }
});
