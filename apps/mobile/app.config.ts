import type { ExpoConfig } from "expo/config";

const variants = {
  development: { name: "Rivnote (dev)", applicationId: "net.devexa.dock.dev" },
  production: { name: "Rivnote", applicationId: "net.devexa.dock" },
} as const;
const variant = process.env.APP_VARIANT ?? "development";
if (!Object.hasOwn(variants, variant)) {
  throw new Error(
    `Invalid APP_VARIANT "${variant}". Use development or production.`,
  );
}
const selected = variants[variant as keyof typeof variants];

const config: ExpoConfig = {
  name: selected.name,
  slug: "dock-mobile",
  version: "0.2.3",
  scheme: "dockmobile",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  icon: "./assets/icon.png",
  primaryColor: "#5639e6",
  splash: {
    image: "./assets/adaptive-icon.png",
    backgroundColor: "#5639e6",
    resizeMode: "contain",
  },
  web: { favicon: "./assets/icon.png" },
  ios: { supportsTablet: true, bundleIdentifier: selected.applicationId },
  android: {
    package: selected.applicationId,
    versionCode: 7,
    edgeToEdgeEnabled: true,
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#5639e6",
      monochromeImage: "./assets/adaptive-icon.png",
    },
    blockedPermissions: [
      "android.permission.RECORD_AUDIO",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.SYSTEM_ALERT_WINDOW",
    ],
    permissions: ["android.permission.SCHEDULE_EXACT_ALARM"],
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    ["expo-notifications", { icon: "./assets/notification-icon.png", color: "#5639e6" }],
    ["./plugins/with-release-signing", { enabled: variant === "production" }],
    ...(variant === "development" ? ["expo-dev-client"] : []),
  ],
  experiments: { typedRoutes: true },
};

export default config;
