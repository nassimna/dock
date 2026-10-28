import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { _electron, chromium, expect } from "@playwright/test";
import { stageMacUpdate, MAC_INSTALL_SCRIPT } from "../apps/desktop/src/main/mac-update-installer.ts";

const execute = promisify(execFile);
const arch = process.argv[2];
assert.equal(process.platform, "darwin");
assert(["arm64", "x64"].includes(arch));
assert.equal(process.arch, arch);
const version = JSON.parse(readFileSync("apps/desktop/package.json", "utf8")).version;
const release = resolve("apps/desktop/release");
const packagedDirectory = join(release, arch === "arm64" ? "mac-arm64" : "mac");
const bundles = readdirSync(packagedDirectory).filter(name => name.endsWith(".app"));
assert.equal(bundles.length, 1);
const packagedBundle = join(packagedDirectory, bundles[0]);
const root = resolve(`.validation/mac-release-${arch}`);
const installed = join(root, "installed/Dock.app");
const profile = join(root, "profile");
const archive = join(release, `Rivnote-${version}-${arch}-mac.zip`);
mkdirSync(root, { recursive: true });
mkdirSync(join(root, "installed"), { recursive: true });
mkdirSync(profile, { recursive: true });
const env = { ...process.env, DOCK_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
let app, browser, updatedPid, helper;
const descriptorPath = join(profile, "local-api.json");
try {
  if (arch === "arm64") {
    const legacyZip = join(root, "legacy.zip");
    await execute("curl", ["--fail", "--location", "--silent", "--show-error", "--output", legacyZip,
      "https://github.com/nassimna/dock/releases/download/v0.2.2/Dock-0.2.2-arm64-mac.zip"], { timeout: 180000 });
    assert.equal(createHash("sha256").update(readFileSync(legacyZip)).digest("hex"), "2e2a15fbac9c565274c580be6b875fe9e43b2f52aa6a08e01c096f21560d9cb5");
    await execute("/usr/bin/ditto", ["-x", "-k", legacyZip, join(root, "installed")]);
  } else {
    await execute("/usr/bin/ditto", [packagedBundle, installed]);
  }
  assert(existsSync(installed));
  app = await _electron.launch({ executablePath: join(installed, "Contents/MacOS/dock"), args: ["--mute-audio"], env, chromiumSandbox: true });
  const main = await app.firstWindow();
  await expect(main.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  await main.getByRole("button", { name: "New task", exact: true }).click();
  const task = main.getByRole("complementary", { name: "New task", exact: true });
  await task.getByLabel("Title", { exact: true }).fill("Mac release upgrade proof");
  await task.getByLabel("Notes", { exact: true }).fill("Preserve this task through the installer and database rename.");
  await task.getByRole("button", { name: "Save task", exact: true }).click();
  const before = await main.evaluate(() => window.dock.dispatch({ type: "snapshot" }));
  const saved = before.items.find(item => item.title === "Mac release upgrade proof");
  assert(saved);
  const oldDescriptor = JSON.parse(readFileSync(descriptorPath, "utf8"));
  const signature = await execute("/usr/bin/codesign", ["-dv", "--verbose=4", packagedBundle]);
  assert(signature.stderr.includes("Signature=adhoc"));
  const sha512 = createHash("sha512").update(readFileSync(archive)).digest("base64");
  const staged = await stageMacUpdate(installed, archive, version, sha512);
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  helper = spawn("/bin/sh", ["-c", MAC_INSTALL_SCRIPT, "dock-update", staged.stage, installed,
    staged.replacement, String(app.process().pid), profile, "--mute-audio", `--remote-debugging-port=${port}`],
    { detached: true, stdio: ["ignore", "pipe", "ignore"], env });
  await new Promise((resolve, reject) => {
    helper.once("error", reject);
    helper.once("exit", () => reject(new Error("Installer exited before handoff")));
    helper.stdout.once("data", resolve);
  });
  helper.stdout.destroy();
  writeFileSync(join(staged.stage, "commit"), "", { mode: 0o600 });
  await app.close();
  app = undefined;
  let snapshot;
  await expect.poll(async () => {
    try {
      const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8"));
      if (descriptor.token === oldDescriptor.token) return "old process";
      const response = await fetch(`http://127.0.0.1:${descriptor.port}/commands`, {
        method: "POST", headers: { Authorization: `Bearer ${descriptor.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ type: "snapshot" }),
        signal: AbortSignal.timeout(3000),
      });
      snapshot = await response.json();
      return snapshot.system?.version;
    } catch { return "starting"; }
  }, { timeout: 60000 }).toBe(version);
  const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8"));
  const listener = await execute("/usr/sbin/lsof", ["-nP", `-iTCP:${descriptor.port}`, "-sTCP:LISTEN", "-t"]);
  updatedPid = Number(listener.stdout.trim());
  const files = await execute("/usr/sbin/lsof", ["-a", "-p", String(updatedPid), "-d", "txt", "-Fn"]);
  assert(files.stdout.includes(join(installed, "Contents/MacOS/dock")));
  assert.equal(snapshot.system.name, "Rivnote");
  assert.equal(snapshot.items.find(item => item.id === saved.id)?.body, saved.body);
  assert.equal(snapshot.sync.pending, before.sync.pending);
  assert.equal(snapshot.system.dataPath, join(profile, "rivnote.sqlite"));
  assert.equal(existsSync(join(profile, "dock.sqlite")), false);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()[0].pages().find(page => page.url().includes("index.html"));
  assert(page);
  await page.getByRole("button", { name: /^All tasks/ }).click();
  await expect(page.getByText(saved.title, { exact: true })).toBeVisible();
  await page.screenshot({ path: join(root, "updated-mac.png") });
  writeFileSync(join(root, "result.json"), JSON.stringify({ arch, fromVersion: before.system.version, toVersion: version,
    checksum: sha512, bundleId: "dev.dock.desktop", signature: "adhoc", installerReplacedAndRelaunched: true,
    taskAndPendingQueuePreserved: true, database: "rivnote.sqlite", helperPid: helper.pid }, null, 2));
  console.log(`PASS ${arch}: packaged Mac installer replacement/relaunch, task persistence, database path and signature verified`);
} finally {
  helper?.kill("SIGTERM");
  if (app) await app.close();
  if (browser) await browser.close();
  if (!updatedPid && existsSync(descriptorPath)) {
    const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8"));
    const listener = await execute("/usr/sbin/lsof", ["-nP", `-iTCP:${descriptor.port}`, "-sTCP:LISTEN", "-t"]).catch(() => null);
    if (listener) {
      const pid = Number(listener.stdout.trim());
      const files = await execute("/usr/sbin/lsof", ["-a", "-p", String(pid), "-d", "txt", "-Fn"]);
      assert(files.stdout.includes(join(installed, "Contents/MacOS/dock")));
      updatedPid = pid;
    }
  }
  if (updatedPid) {
    try { process.kill(updatedPid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    await expect.poll(() => {
      try { process.kill(updatedPid, 0); return false; }
      catch (error) { if (error.code === "ESRCH") return true; throw error; }
    }, { timeout: 10000 }).toBe(true);
  }
  rmSync(join(root, "installed"), { recursive: true, force: true });
  rmSync(profile, { recursive: true, force: true });
  rmSync(join(root, "legacy.zip"), { force: true });
}
