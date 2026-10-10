import type { CSSProperties } from "react";
import type { Settings } from "@dock/contracts";

type Colors = Settings["themeColors"]["dark"];

export const themePresets = {
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
} satisfies Record<string, Record<Settings["theme"], Required<Colors>>>;

export function themeStyle(mode: Settings["theme"], overrides: Colors): CSSProperties {
  const colors = { ...themePresets.Graphite[mode] };
  for (const key of Object.keys(colors) as (keyof Colors)[]) {
    const value = overrides[key];
    if (value && /^#[0-9a-f]{6}$/i.test(value)) colors[key] = value;
  }
  const rgb = [1, 3, 5].map(offset => {
    const value = parseInt(colors.primary.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
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
  } as CSSProperties;
}
