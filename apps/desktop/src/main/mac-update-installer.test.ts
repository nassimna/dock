import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { stageMacUpdate } from "./mac-update-installer.ts";

const execute = promisify(execFile);

test("Mac update preparation rejects a corrupted download before creating a replacement", async () => {
  const parent = process.env.DOCK_TEST_ROOT;
  assert.ok(parent, "DOCK_TEST_ROOT must point to task-owned disk-backed storage");
  const directory = mkdtempSync(join(parent, "update-hash-"));
  try {
    const archive = join(directory, "update.zip");
    writeFileSync(archive, "corrupted download");
    await assert.rejects(stageMacUpdate(join(directory, "Dock.app"), archive, "0.1.1", "wrong-checksum"), /checksum/);
    assert.deepEqual(readdirSync(directory), ["update.zip"]);
  } finally { rmSync(directory, { recursive: true }); }
});

test("Mac update preparation rejects another application's archive and removes only its own stage", { skip: process.platform !== "darwin" }, async () => {
  const parent = process.env.DOCK_TEST_ROOT;
  assert.ok(parent, "DOCK_TEST_ROOT must point to task-owned disk-backed storage");
  const directory = mkdtempSync(join(parent, "update-bundle-"));
  try {
    const installed = join(directory, "Dock.app");
    const replacement = join(directory, "Other.app");
    for (const [bundle, id] of [[installed, "dev.dock.desktop"], [replacement, "dev.other.desktop"]]) {
      mkdirSync(join(bundle!, "Contents"), { recursive: true });
      writeFileSync(join(bundle!, "Contents/Info.plist"), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${id}</string><key>CFBundleShortVersionString</key><string>0.1.1</string><key>CFBundleExecutable</key><string>dock</string></dict></plist>`);
    }
    const archive = join(directory, "update.zip");
    await execute("/usr/bin/ditto", ["-c", "-k", "--keepParent", replacement, archive]);
    const sha = createHash("sha512").update(readFileSync(archive)).digest("base64");
    await assert.rejects(stageMacUpdate(installed, archive, "0.1.1", sha), /does not match Rivnote/);
    assert.ok(readdirSync(directory).includes("Dock.app"));
    assert.equal(readdirSync(directory).some(name => name.startsWith(".dock-update-")), false);
  } finally { rmSync(directory, { recursive: true }); }
});
