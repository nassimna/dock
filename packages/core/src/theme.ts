import type { Settings } from "@dock/contracts";
type Colors = Settings["themeColors"]["dark"];

export const colorPresets = {
  River: {
    dark: {
      background: "#15131d",
      card: "#201c2e",
      foreground: "#f3f0ff",
      mutedForeground: "#b4adc8",
      border: "#393249",
      primary: "#ad9bff",
    },
    light: {
      background: "#ffffff",
      card: "#f6f4ff",
      foreground: "#241d3b",
      mutedForeground: "#6b617f",
      border: "#ddd7ef",
      primary: "#5639e6",
    },
  },
  Graphite: {
    dark: {
      background: "#17191f",
      card: "#20232b",
      foreground: "#eef1f6",
      mutedForeground: "#a4adbe",
      border: "#363d4b",
      primary: "#92b4ff",
    },
    light: {
      background: "#ffffff",
      card: "#f5f7fa",
      foreground: "#202633",
      mutedForeground: "#647084",
      border: "#dbe1e9",
      primary: "#315bd3",
    },
  },
  Forest: {
    dark: {
      background: "#181e21",
      card: "#1e2529",
      foreground: "#e9edec",
      mutedForeground: "#a0aaa8",
      border: "#354046",
      primary: "#b0e5c2",
    },
    light: {
      background: "#ffffff",
      card: "#f8faf9",
      foreground: "#25312d",
      mutedForeground: "#69776f",
      border: "#dce5df",
      primary: "#2c7650",
    },
  },
  Violet: {
    dark: {
      background: "#1d1924",
      card: "#272230",
      foreground: "#f2edf8",
      mutedForeground: "#b1a6c2",
      border: "#40364e",
      primary: "#c5a4ff",
    },
    light: {
      background: "#ffffff",
      card: "#f7f5fa",
      foreground: "#2b2436",
      mutedForeground: "#756780",
      border: "#e3dcea",
      primary: "#7041bd",
    },
  },
} satisfies Record<
  Settings["colorPreset"],
  Record<Settings["theme"], Required<Colors>>
>;
