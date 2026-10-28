import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { syncItemSchema } from "../../../packages/contracts/src/index.ts";
import { startSyncFixture } from "./server.fixture.ts";

test("sync preserves conflict links and their resolution while requiring an accessible original", async () => {
  assert.ok(process.env.DOCK_TEST_ROOT);
  const root = mkdtempSync(
    join(process.env.DOCK_TEST_ROOT, "conflict-worker-"),
  );
  const server = await startSyncFixture(root);
  try {
    const session = await (
      await fetch(server.endpoint + "/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "conflict-test@dock.invalid",
          password: "test-only-conflict-password",
          inviteCode: server.env.REGISTRATION_SECRET,
          deviceName: "Conflict test",
        }),
      })
    ).json();
    const request = (body?: unknown) =>
      fetch(server.endpoint + "/sync", {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${session.token}`,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const original = syncItemSchema.parse({
      id: randomUUID(),
      kind: "note",
      title: "Original",
      body: "Server version",
      space: "Inbox",
      priority: false,
      done: false,
      scheduledAt: null,
      recurrence: "none",
      linkedNoteId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      recurrenceSourceId: null,
    });
    const push = (item: typeof original, baseVersion: number) =>
      request({
        item,
        baseVersion,
        mutationId: randomBytes(16).toString("hex"),
      });
    assert.equal((await push(original, 0)).status, 200);
    const copy = {
      ...original,
      id: randomUUID(),
      title: "Saved copy",
      body: "Offline version",
      conflictOf: original.id,
    };
    assert.equal(
      (await push({ ...copy, conflictOf: randomUUID() }, 0)).status,
      409,
    );
    assert.equal((await push(copy, 0)).status, 200);
    const pull = await (await request()).json();
    assert.equal(
      pull.changes.find(
        (record: { item: { id: string } }) => record.item.id === copy.id,
      ).item.conflictOf,
      original.id,
    );
    assert.equal((await push({ ...copy, conflictOf: null }, 1)).status, 200);
    const resolved = await (await request()).json();
    assert.equal(
      resolved.changes
        .filter(
          (record: { item: { id: string } }) => record.item.id === copy.id,
        )
        .at(-1).item.conflictOf,
      null,
    );
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
