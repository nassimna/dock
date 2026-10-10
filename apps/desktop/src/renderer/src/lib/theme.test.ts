import assert from "node:assert/strict";
import { test } from "node:test";
import { settingsSchema } from "@dock/contracts";
import { themeStyle } from "./theme.ts";

test("Ink is the default and legacy custom colors survive missing appearance fields", () => {
  const defaults = settingsSchema.parse({});
  assert.equal(defaults.uiPreset, "ink");
  assert.equal(defaults.colorPreset, "Violet");
  assert.equal(defaults.rounding, "subtle");
  assert.equal(themeStyle(defaults)["--sidebar-width"], "54px");
  assert.equal(themeStyle(defaults)["--primary"], "#c5a4ff");
  const legacy = settingsSchema.parse({ theme: "light", themeColors: { light: { primary: "#123456" }, dark: {} } });
  assert.equal(themeStyle(legacy)["--primary"], "#123456");
});

test("interface, palette and rounding are independent in both theme modes", () => {
  const settings = settingsSchema.parse({ uiPreset: "native", colorPreset: "Forest", rounding: "square" });
  const native = themeStyle(settings);
  assert.equal(native["--sidebar-width"], "164px");
  assert.equal(native["--primary"], "#b0e5c2");
  assert.equal(native["--radius"], "0px");
  assert.equal(native["--radius-panel"], "0px");
  const studio = themeStyle({ ...settings, uiPreset: "studio" });
  assert.equal(studio["--sidebar-width"], "144px");
  assert.equal(studio["--primary"], native["--primary"]);
  assert.equal(studio["--radius"], native["--radius"]);
  const rounded = themeStyle({ ...settings, rounding: "rounded", theme: "light" });
  assert.equal(rounded["--sidebar-width"], "164px");
  assert.equal(rounded["--primary"], "#2c7650");
  assert.equal(rounded["--radius"], "10px");
});

test("incomplete custom hex input previews the selected palette safely", () => {
  const draft = settingsSchema.parse({ colorPreset: "Graphite" });
  draft.themeColors.dark.primary = "#aa";
  assert.equal(themeStyle(draft)["--primary"], "#92b4ff");
});
