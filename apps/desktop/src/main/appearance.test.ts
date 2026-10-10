import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { settingsSchema } from "@dock/contracts";
import { DockDatabase } from "./database.ts";

test("appearance choices and custom colors survive reopening the local database", () => {
  const parent = process.env.DOCK_TEST_ROOT;
  assert.ok(parent, "DOCK_TEST_ROOT must point to task-owned disk-backed storage");
  const directory = mkdtempSync(join(parent, "appearance-"));
  const filename = join(directory, "dock.sqlite");
  let database = new DockDatabase(filename);
  try {
    const settings = settingsSchema.parse({ ...database.snapshot().settings, uiPreset: "studio", colorPreset: "Forest", rounding: "rounded",
      themeColors: { dark: { primary: "#123456" }, light: { background: "#f0f0f0" } } });
    database.execute({ type: "settings.save", settings });
    database.close();
    database = new DockDatabase(filename);
    assert.equal(database.snapshot().settings.uiPreset, "studio");
    assert.equal(database.snapshot().settings.colorPreset, "Forest");
    assert.equal(database.snapshot().settings.rounding, "rounded");
    assert.deepEqual(database.snapshot().settings.themeColors, settings.themeColors);
  } finally {
    database.close();
    rmSync(directory, { recursive: true });
  }
});
