import type { CSSProperties } from "react";
import type { Settings } from "@dock/contracts";

type Colors = Settings["themeColors"]["dark"];

export const interfacePresets = {
  ink: { name: "Ink", description: "Icon rail and a quiet writing page", sidebar: "54px", row: "30px", control: "26px" },
  precision: { name: "Precision", description: "Compact navigation and dense lists", sidebar: "144px", row: "30px", control: "26px" },
  native: { name: "Native", description: "Full labels and grouped properties", sidebar: "164px", row: "34px", control: "28px" },
  studio: { name: "Studio", description: "Workspace panels and a properties sidebar", sidebar: "144px", row: "34px", control: "28px" },
} satisfies Record<Settings["uiPreset"], { name: string; description: string; sidebar: string; row: string; control: string }>;

export const roundingLevels = {
  square: { name: "Square", control: "0px", small: "0px", panel: "0px" },
  subtle: { name: "Subtle", control: "3px", small: "2px", panel: "6px" },
  balanced: { name: "Balanced", control: "6px", small: "4px", panel: "10px" },
  rounded: { name: "Rounded", control: "10px", small: "6px", panel: "14px" },
} satisfies Record<Settings["rounding"], { name: string; control: string; small: string; panel: string }>;

export const colorPresets = {
  Graphite: {
    dark: { background: "#17191f", card: "#20232b", foreground: "#eef1f6", mutedForeground: "#a4adbe", border: "#363d4b", primary: "#92b4ff" },
    light: { background: "#ffffff", card: "#f5f7fa", foreground: "#202633", mutedForeground: "#647084", border: "#dbe1e9", primary: "#315bd3" },
  },
  Forest: {
    dark: { background: "#181e21", card: "#1e2529", foreground: "#e9edec", mutedForeground: "#a0aaa8", border: "#354046", primary: "#b0e5c2" },
    light: { background: "#ffffff", card: "#f8faf9", foreground: "#25312d", mutedForeground: "#69776f", border: "#dce5df", primary: "#2c7650" },
  },
  Violet: {
    dark: { background: "#1d1924", card: "#272230", foreground: "#f2edf8", mutedForeground: "#b1a6c2", border: "#40364e", primary: "#c5a4ff" },
    light: { background: "#ffffff", card: "#f7f5fa", foreground: "#2b2436", mutedForeground: "#756780", border: "#e3dcea", primary: "#7041bd" },
  },
} satisfies Record<Settings["colorPreset"], Record<Settings["theme"], Required<Colors>>>;

export function themeStyle(settings: Settings): CSSProperties & Record<`--${string}`, string> {
  const { theme: mode, colorPreset, uiPreset, rounding, themeColors } = settings;
  const colors = { ...colorPresets[colorPreset][mode] };
  for (const key of Object.keys(colors) as (keyof Colors)[]) {
    const value = themeColors[mode][key];
    if (value && /^#[0-9a-f]{6}$/i.test(value)) colors[key] = value;
  }
  const rgb = [1, 3, 5].map(offset => {
    const value = parseInt(colors.primary.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
  const layout = interfacePresets[uiPreset];
  const corners = roundingLevels[rounding];
  return {
    "--background": colors.background,
    "--card": colors.card,
    "--foreground": colors.foreground,
    "--muted-foreground": colors.mutedForeground,
    "--border": colors.border,
    "--primary": colors.primary,
    "--primary-foreground": luminance > 0.179 ? "#000000" : "#ffffff",
    "--secondary": `color-mix(in srgb, ${colors.card} 80%, ${colors.foreground} 20%)`,
    "--accent": `color-mix(in srgb, ${colors.background} 82%, ${colors.primary} 18%)`,
    "--accent-foreground": colors.foreground,
    "--sidebar-width": layout.sidebar,
    "--nav-row-height": layout.row,
    "--control-height": layout.control,
    "--radius": corners.control,
    "--radius-small": corners.small,
    "--radius-panel": corners.panel,
  };
}
