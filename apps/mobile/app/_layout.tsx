import "../global.css";
import "@/lib/i18n";
import { queryClient } from "@/lib/query-client";
import * as Notifications from "expo-notifications";
import { getSnapshot, subscribeChanged } from "@/lib/database";
import { reconcileReminders } from "@/lib/reminders";
import { createBackup, listBackups } from "@/lib/files";
import dayjs from "dayjs";
import { initializeSync, setSyncActive } from "@/lib/sync";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { ThemeProvider, useTheme } from "@/lib/theme";
import { initializeThemePreference } from "@/lib/theme-preference";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppState, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

initializeThemePreference();

async function prepareApp() {
  await initializeSync();
  await reconcileReminders().catch(() => {});
  const backups = await listBackups();
  if (
    !backups.some((name) =>
      name.startsWith(`dock-${dayjs().format("YYYY-MM-DD")}`),
    )
  )
    await createBackup();
}

function AppShell() {
  const { scheme, colors, style } = useTheme();
  const { t, i18n } = useTranslation();
  const [startupError, setStartupError] = useState(false);
  useEffect(() => {
    const openReminder = (
      response: Notifications.NotificationResponse | null,
    ) => {
      const id = response?.notification.request.content.data.itemId;
      if (
        typeof id === "string" &&
        getSnapshot().items.some((item) => item.id === id)
      ) {
        router.push({ pathname: "/capture", params: { id } });
        Notifications.clearLastNotificationResponse();
      }
    };
    const responseListener =
      Notifications.addNotificationResponseReceivedListener(openReminder);
    void Notifications.getLastNotificationResponseAsync()
      .then(openReminder)
      .catch(() => {});
    const unsubscribe = subscribeChanged(() => {
      void queryClient.invalidateQueries();
      void reconcileReminders().catch(() => {});
    });
    const handle = AppState.addEventListener("change", (state) => {
      void setSyncActive(state === "active").catch(() => setStartupError(true));
    });
    void setSyncActive(AppState.currentState === "active")
      .then(prepareApp)

      .catch(() => setStartupError(true));
    return () => {
      responseListener.remove();
      unsubscribe();
      handle.remove();
      void setSyncActive(false);
    };
  }, []);
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.background);
  }, [colors.background]);
  return (
    <View
      className="flex-1 bg-background"
      style={[style, { direction: i18n.dir() }]}
    >
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      {startupError && (
        <View className="gap-2 bg-card p-4">
          <Text accessibilityRole="alert">{t("production.startupError")}</Text>
          <Button
            variant="outline"
            label={t("common.retry")}
            onPress={() => {
              void prepareApp()
                .then(() => setStartupError(false))
                .catch(() => setStartupError(true));
            }}
          />
        </View>
      )}
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(main)" />
        <Stack.Screen
          name="capture"
          options={{ presentation: "modal", gestureEnabled: false }}
        />
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <ThemeProvider>
              <AppShell />
            </ThemeProvider>
          </QueryClientProvider>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
