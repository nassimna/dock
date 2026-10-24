import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { DockUpdates } from "./updates.ts";

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowDowngrade = true;
  allowPrerelease = true;
  checks = 0;
  downloads = 0;
  installs = 0;
  available: string | null = "0.1.1";
  downloadFails = false;
  async checkForUpdates() {
    this.checks++;
    this.emit("checking-for-update");
    this.emit(this.available ? "update-available" : "update-not-available", { version: this.available ?? "0.1.0" });
    return null;
  }
  async downloadUpdate(): Promise<string[]> {
    this.downloads++;
    this.emit("download-progress", { percent: 42 });
    if (this.downloadFails) throw new Error("Simulated network failure");
    this.emit("update-downloaded", { version: this.available });
    return [];
  }
  quitAndInstall() { this.installs++; }
}

test("updates stay manual until requested; download errors retain the known version and retry without restarting", async () => {
  const backend = new FakeUpdater();
  const seen: string[] = [];
  let prepared = false;
  const updates = new DockUpdates(backend, () => seen.push(updates.state().status), async () => { prepared = true; });
  try {
    updates.configure(false);
    assert.equal(backend.checks, 0);
    assert.equal(backend.autoDownload, false);
    assert.equal(backend.autoInstallOnAppQuit, false);
    assert.equal(backend.allowDowngrade, false);
    await updates.check();
    assert.equal(updates.state().status, "available");
    assert.equal(backend.downloads, 0);
    backend.downloadFails = true;
    await updates.download();
    assert.equal(updates.state().status, "error");
    assert.equal(updates.state().version, "0.1.1");
    assert.equal(updates.state().retry, "download");
    assert.equal(backend.installs, 0);
    backend.downloadFails = false;
    await updates.download();
    assert.equal(updates.state().status, "ready");
    assert.equal(backend.installs, 0);
    assert.ok(seen.includes("downloading"));
    await updates.install();
    assert.equal(prepared, true);
    assert.equal(backend.installs, 1);
  } finally { updates.stop(); }
});

test("automatic checks repeat every six hours, stop when disabled, and downloads never install automatically", async context => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  const backend = new FakeUpdater();
  backend.available = null;
  const updates = new DockUpdates(backend, () => {}, async () => {});
  try {
    updates.configure(true);
    await updates.check();
    assert.equal(backend.checks, 1);
    context.mock.timers.tick(6 * 60 * 60 * 1000);
    await updates.check();
    assert.equal(backend.checks, 2);
    updates.configure(false);
    context.mock.timers.tick(6 * 60 * 60 * 1000);
    assert.equal(backend.checks, 2);
    backend.available = "0.1.1";
    updates.configure(true);
    await updates.check();
    await updates.download();
    assert.equal(backend.downloads, 1);
    assert.equal(updates.state().status, "ready");
    assert.equal(backend.installs, 0);
  } finally { updates.stop(); }
});

test("an unsaved draft blocks installation and remains retryable after saving", async () => {
  const backend = new FakeUpdater();
  let unsaved = true;
  const updates = new DockUpdates(backend, () => {}, async () => {
    if (unsaved) throw new Error("Save your preferences before restarting Dock.");
  });
  try {
    await updates.check(); await updates.download(); await updates.install();
    assert.equal(updates.state().status, "error");
    assert.match(updates.state().message, /Save your preferences/);
    assert.equal(updates.state().retry, "install");
    assert.equal(backend.installs, 0);
    unsaved = false;
    await updates.install();
    assert.equal(backend.installs, 1);
  } finally { updates.stop(); }
});
