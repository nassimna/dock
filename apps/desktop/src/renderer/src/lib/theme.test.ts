import assert from "node:assert/strict";
import { test } from "node:test";
import { settingsSchema } from "@dock/contracts";
import { floatingStyle, themeStyle } from "./theme.ts";

test("Rivnote defaults and legacy appearance choices retain independent custom colors", () => {
  const defaults = settingsSchema.parse({});
  assert.equal(defaults.uiPreset, "ink");
  assert.equal(defaults.colorPreset, "River");
  assert.equal(defaults.rounding, "subtle");
  assert.equal(settingsSchema.parse({ colorPreset: "Violet" }).colorPreset, "Violet");
  assert.equal(themeStyle(defaults)["--sidebar-width"], "3.375rem");
  assert.equal(themeStyle(defaults)["--primary"], "#5ae0c5");
  const legacy = settingsSchema.parse({ theme: "light", themeColors: { light: { primary: "#123456" }, dark: {} } });
  assert.equal(themeStyle(legacy)["--primary"], "#123456");
});

test("interface, palette and rounding are independent in both theme modes", () => {
  const settings = settingsSchema.parse({ uiPreset: "native", colorPreset: "Forest", rounding: "square" });
  const native = themeStyle(settings);
  assert.equal(native["--sidebar-width"], "10.25rem");
  assert.equal(native["--primary"], "#b0e5c2");
  assert.equal(native["--radius"], "0rem");
  assert.equal(native["--radius-panel"], "0rem");
  const studio = themeStyle({ ...settings, uiPreset: "studio" });
  assert.equal(studio["--sidebar-width"], "9rem");
  assert.equal(studio["--primary"], native["--primary"]);
  assert.equal(studio["--radius"], native["--radius"]);
  const rounded = themeStyle({ ...settings, rounding: "rounded", theme: "light" });
  assert.equal(rounded["--sidebar-width"], "10.25rem");
  assert.equal(rounded["--primary"], "#2c7650");
  assert.equal(rounded["--radius"], "0.625rem");
  assert.equal(themeStyle({ ...settings, density: "comfortable" })["--nav-row-height"], "2.1875rem");
});

test("incomplete custom hex input previews the selected palette safely", () => {
  const draft = settingsSchema.parse({ colorPreset: "Graphite" });
  draft.themeColors.dark.primary = "#aa";
  assert.equal(themeStyle(draft)["--primary"], "#92b4ff");
});

test("small custom floating icons retain contrast and cannot become invisible", () => {
  const white = settingsSchema.parse({ floating: { size: 28, color: '#ffffff', shape: 'square', opacity: 0.3 } });
  assert.equal(floatingStyle(white.floating)['--floating-foreground'], '#000000');
  assert.equal(floatingStyle(white.floating)['--floating-size'], '28px');
  assert.equal(floatingStyle(white.floating)['--floating-radius'], '0');
  assert.equal(floatingStyle(white.floating).opacity, 0.3);
  assert.equal(floatingStyle({ ...white.floating, color: '#000000' })['--floating-foreground'], '#ffffff');
  assert.equal(settingsSchema.safeParse({ floating: { opacity: 0 } }).success, false);
  assert.equal(settingsSchema.safeParse({ floating: { size: 0 } }).success, false);
});
