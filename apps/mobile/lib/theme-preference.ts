import { colorScheme } from "nativewind";
import { Appearance, Platform } from "react-native";
import { storage } from "./storage";

export type ThemePreference = "light" | "dark" | "system";

const THEME_KEY = "preferences.theme";

function isThemePreference(
  value: string | undefined,
): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function getStoredThemePreference(): ThemePreference {
  const value = storage.getString(THEME_KEY);
  return isThemePreference(value) ? value : "dark";
}

export function applyThemePreference(theme: ThemePreference) {
  colorScheme.set(
    theme === "system" && Platform.OS === "web"
      ? (Appearance.getColorScheme() ?? "light")
      : theme,
  );
  storage.set(THEME_KEY, theme);
}

export function initializeThemePreference() {
  const theme = getStoredThemePreference();
  applyThemePreference(theme);
}
