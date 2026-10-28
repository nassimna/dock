import type { CSSProperties } from "react";
import type { FloatingStyle, Settings } from "@dock/contracts";

type Colors = Settings["themeColors"]["dark"];

export const interfacePresets = {
  ink: {
    name: "Ink",
    description: "Icon rail and a quiet writing page",
    sidebar: "3.375rem",
    row: "1.75rem",
  },
  precision: {
    name: "Precision",
    description: "Compact navigation and dense lists",
    sidebar: "9rem",
    row: "1.75rem",
  },
  native: {
    name: "Native",
    description: "Full labels and grouped properties",
    sidebar: "10.25rem",
    row: "1.875rem",
  },
  studio: {
    name: "Studio",
    description: "Workspace panels and a properties sidebar",
    sidebar: "9rem",
    row: "1.875rem",
  },
} satisfies Record<
  Settings["uiPreset"],
  { name: string; description: string; sidebar: string; row: string }
>;

export const noteFontFamilies = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"SFMono-Regular", Consolas, monospace',
} satisfies Record<Settings["noteFont"], string>;

export const roundingLevels = {
  square: { name: "Square", control: "0rem", small: "0rem", panel: "0rem" },
  subtle: {
    name: "Subtle",
    control: "0.1875rem",
    small: "0.125rem",
    panel: "0.375rem",
  },
  balanced: {
    name: "Balanced",
    control: "0.375rem",
    small: "0.25rem",
    panel: "0.625rem",
  },
  rounded: {
    name: "Rounded",
    control: "0.625rem",
    small: "0.375rem",
    panel: "0.875rem",
  },
} satisfies Record<
  Settings["rounding"],
  { name: string; control: string; small: string; panel: string }
>;

import { colorPresets } from "@dock/core/theme";
export { colorPresets } from "@dock/core/theme";

function colorForeground(color: string): string {
  const rgb = [1, 3, 5].map((offset) => {
    const value = parseInt(color.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
  return luminance > 0.179 ? "#000000" : "#ffffff";
}

export function floatingStyle(
  style: FloatingStyle,
): CSSProperties & Record<`--${string}`, string> {
  return {
    opacity: style.opacity,
    "--floating-size": `${style.size}px`,
    "--floating-color": style.color,
    "--floating-foreground": colorForeground(style.color),
    "--floating-radius":
      style.shape === "circle"
        ? "50%"
        : style.shape === "rounded"
          ? "25%"
          : "0",
    "--floating-glyph": `${Math.round(style.size * 0.5)}px`,
    "--floating-badge": `${Math.max(16, Math.round(style.size * 0.35))}px`,
  };
}

export function themeStyle(
  settings: Settings,
): CSSProperties & Record<`--${string}`, string> {
  const {
    theme: mode,
    colorPreset,
    uiPreset,
    rounding,
    themeColors,
  } = settings;
  const colors = { ...colorPresets[colorPreset][mode] };
  for (const key of Object.keys(colors) as (keyof Colors)[]) {
    const value = themeColors[mode][key];
    if (value && /^#[0-9a-f]{6}$/i.test(value)) colors[key] = value;
  }
  const layout = interfacePresets[uiPreset];
  const corners = roundingLevels[rounding];
  return {
    "--background": colors.background,
    "--card": colors.card,
    "--foreground": colors.foreground,
    "--muted-foreground": colors.mutedForeground,
    "--border": colors.border,
    "--primary": colors.primary,
    "--primary-foreground": colorForeground(colors.primary),
    "--secondary": `color-mix(in srgb, ${colors.card} 80%, ${colors.foreground} 20%)`,
    "--accent": `color-mix(in srgb, ${colors.background} 82%, ${colors.primary} 18%)`,
    "--accent-foreground": colors.foreground,
    "--sidebar-width": layout.sidebar,
    "--nav-row-height":
      settings.density === "comfortable" ? "2.1875rem" : layout.row,
    "--radius": corners.control,
    "--radius-small": corners.small,
    "--radius-panel": corners.panel,
  };
}
