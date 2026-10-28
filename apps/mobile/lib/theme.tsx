import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { colorPresets } from "@dock/core/theme";
import { useDock } from "./use-dock";
import { vars } from "nativewind";
import { Appearance, Platform } from "react-native";
import {
  type ThemePreference,
  applyThemePreference,
  getStoredThemePreference,
} from "./theme-preference";

type ResolvedScheme = "light" | "dark";

function hsl(hex: string) {
  const [r, g, b] = [1, 3, 5].map(
    (at) => parseInt(hex.slice(at, at + 2), 16) / 255,
  ) as [number, number, number];
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    delta = max - min,
    light = (max + min) / 2;
  let hue = 0;
  if (delta)
    hue =
      max === r
        ? ((g - b) / delta) % 6
        : max === g
          ? (b - r) / delta + 2
          : (r - g) / delta + 4;
  return `${(hue * 60 + 360) % 360} ${delta ? (delta / (1 - Math.abs(2 * light - 1))) * 100 : 0}% ${light * 100}%`;
}

type ThemeContextValue = {
  preference: ThemePreference;
  scheme: ResolvedScheme;
  colors: Record<
    | "background"
    | "card"
    | "foreground"
    | "mutedForeground"
    | "primary"
    | "border",
    string
  >;
  style: ReturnType<typeof vars>;
  density: "compact" | "comfortable";
  setPreference: (next: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function resolve(preference: ThemePreference): ResolvedScheme {
  if (preference === "system") {
    return Appearance.getColorScheme() === "dark" ? "dark" : "light";
  }
  return preference;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const settings = useDock().data?.settings;
  const [preference, setPreferenceState] = useState<ThemePreference>(
    getStoredThemePreference,
  );
  const [scheme, setScheme] = useState<ResolvedScheme>(() =>
    resolve(getStoredThemePreference()),
  );

  useEffect(() => {
    if (preference !== "system") {
      return;
    }

    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      setScheme(colorScheme === "dark" ? "dark" : "light");
      if (Platform.OS === "web") applyThemePreference("system");
    });

    return () => subscription.remove();
  }, [preference]);

  const value = useMemo<ThemeContextValue>(() => {
    const colors = {
      ...colorPresets[settings?.colorPreset ?? "River"][scheme],
      ...settings?.themeColors[scheme],
    };
    const radius = { square: 0, subtle: 3, balanced: 6, rounded: 10 }[
      settings?.rounding ?? "balanced"
    ];
    const properties: Record<string, string> = {};
    for (const [name, color] of Object.entries(colors))
      properties[
        `--${name === "mutedForeground" ? "muted-foreground" : name}`
      ] = hsl(color);
    for (const name of [
      "card-foreground",
      "secondary-foreground",
      "accent-foreground",
    ])
      properties[`--${name}`] = hsl(colors.foreground);
    for (const name of ["input", "ring"])
      properties[`--${name}`] = hsl(
        name === "input" ? colors.border : colors.primary,
      );
    for (const name of ["secondary", "muted", "accent"])
      properties[`--${name}`] = hsl(colors.card);
    const rgb = [1, 3, 5].map((at) =>
      parseInt(colors.primary.slice(at, at + 2), 16),
    );
    properties["--primary-foreground"] =
      rgb[0]! * 0.299 + rgb[1]! * 0.587 + rgb[2]! * 0.114 > 150
        ? "0 0% 0%"
        : "0 0% 100%";
    properties["--radius"] = `${radius}px`;
    return {
      preference,
      scheme,
      colors,
      style: vars(properties),
      density: settings?.density ?? "compact",
      setPreference: (next) => {
        applyThemePreference(next);
        setPreferenceState(next);
        setScheme(resolve(next));
      },
    };
  }, [preference, scheme, settings]);

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }
  return value;
}

export function useThemeColors() {
  return useTheme().colors;
}
