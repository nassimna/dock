import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { settingsSchema, updateStateSchema, type Snapshot } from "@dock/contracts";
import { startLocalApi } from "./local-api.ts";

test("local commands require the profile token and reject browser origins and malformed writes", async () => {
  const parent = process.env.DOCK_TEST_ROOT;
  assert.ok(
    parent,
    "DOCK_TEST_ROOT must point to task-owned disk-backed storage",
  );
  const directory = mkdtempSync(join(parent, "local-api-"));
  let calls = 0;
  const snapshot: Snapshot = {
    items: [],
    settings: settingsSchema.parse({}),
    sync: { connected: false, endpoint: "", email: "", phase: "disconnected", pending: 0, conflicts: 0, lastSyncedAt: null, error: "" },
    update: updateStateSchema.parse({ status: "unavailable" }),
    system: {
      platform: process.platform,
      version: "0.1.0",
      dataPath: join(directory, "dock.sqlite"),
      shortcutRegistered: true,
      topmostSupported: true,
      trayAvailable: false,
      notificationsSupported: false,
      launchAtLoginSupported: false,
      notificationError: "",
      miniOpen: false,
    },
  };
  const stop = await startLocalApi(directory, async () => {
    calls++;
    return snapshot;
  });
  const descriptor = join(directory, "local-api.json");
  try {
    const { port, token } = JSON.parse(readFileSync(descriptor, "utf8"));
    if (process.platform !== "win32")
      assert.equal(statSync(descriptor).mode & 0o777, 0o600);
    const send = (body: unknown, headers: Record<string, string> = {}) =>
      fetch(`http://127.0.0.1:${port}/commands`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    assert.equal((await send({ type: "snapshot" })).status, 401);
    const auth = { Authorization: `Bearer ${token}` };
    assert.equal(
      (
        await send(
          { type: "snapshot" },
          { ...auth, Origin: "https://example.com" },
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await send(
          { type: "item.save", item: { kind: "task", title: "" } },
          auth,
        )
      ).status,
      400,
    );
    assert.equal(
      (await send({ type: "window", action: "quit" }, auth)).status,
      400,
    );
    assert.equal((await send({ type: "capture.resize", height: 224 }, auth)).status, 400);
    for (const action of ["check", "download", "install"])
      assert.equal((await send({ type: "update", action }, auth)).status, 400);
    assert.equal((await send({
      type: "sync.login", endpoint: "https://sync.example.com",
      email: "owner@example.com", password: "not-a-real-password",
    }, auth)).status, 400);
    const accepted = await send({ type: "snapshot" }, auth);
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), snapshot);
    assert.equal(calls, 1);
  } finally {
    stop();
    rmSync(directory, { recursive: true });
  }
  assert.equal(existsSync(descriptor), false);
});
