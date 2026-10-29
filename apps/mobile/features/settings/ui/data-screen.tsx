import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import {
  createBackup,
  importBackup,
  listBackups,
  restoreBackup,
} from "@/lib/files";
import {
  enableReminders,
  reconcileReminders,
  reminderState,
} from "@/lib/reminders";
import { useDock, useCommand } from "@/lib/use-dock";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getPermissionsAsync } from "expo-notifications";
import dayjs from "dayjs";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { Linking, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

export function DataScreen() {
  const { t } = useTranslation();
  const { section } = useLocalSearchParams<{ section?: string }>();
  const backupsOnly = section === "backups";
  const query = useDock(),
    command = useCommand();
  const client = useQueryClient();
  const data = useQuery({
    queryKey: ["data-tools"],
    queryFn: async () => ({
      backups: await listBackups(),
      reminders: reminderState(),
      permission: await getPermissionsAsync(),
    }),
    networkMode: "always",
  });
  const action = useMutation({
    mutationFn: async (run: () => Promise<unknown>) => run(),
    onSuccess: () => client.invalidateQueries(),
  });
  const settings = query.data?.settings;
  const showNotificationSettings =
    data.data?.permission.granted ||
    data.data?.permission.canAskAgain === false;
  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-row items-center justify-between border-b border-border p-3">
        <Button
          variant="ghost"
          label={t("account.back")}
          onPress={() => router.back()}
        />
        <Text variant="heading">{t(backupsOnly ? "production.backups" : "production.notifications")}</Text>
      </View>
      <KeyboardAwareScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, gap: 20 }}
      >
        {!backupsOnly && <><View className="gap-3">
          <Text variant="heading">{t("production.notifications")}</Text>
          <Text variant="muted">{t("production.remindersLocal")}</Text>
          <Text accessibilityLiveRegion="polite">
            {data.isPending
              ? t("common.loading")
              : t(
                  data.data?.permission.granted
                    ? "production.notificationsEnabled"
                    : "production.notificationsDisabled",
                )}
          </Text>
          <Button
            label={t(
              showNotificationSettings
                ? "production.notificationSettings"
                : "production.enableNotifications",
            )}
            loading={action.isPending}
            disabled={data.isPending}
            onPress={() =>
              action.mutate(
                showNotificationSettings
                  ? () => Linking.openSettings()
                  : enableReminders,
              )
            }
          />
          <Button
            variant="outline"
            label={t("common.retry")}
            onPress={() => action.mutate(() => reconcileReminders(true))}
          />
          <Button
            variant="ghost"
            label={t("production.alarmSettings")}
            onPress={() => action.mutate(() => Linking.openSettings())}
          />
          <Text variant="muted">{t("production.alarmSettingsBody")}</Text>
          {!!data.data?.reminders.error && (
            <Text accessibilityRole="alert" className="text-destructive">
              {data.data.reminders.error}
            </Text>
          )}
          {data.data?.reminders.plans.map((plan) => (
            <View
              key={plan.notificationId}
              className="gap-1 rounded-md border border-border p-3"
            >
              <Text>{plan.title}</Text>
              <Text variant="muted">
                {dayjs(plan.at).format("D MMM YYYY · HH:mm")}
              </Text>
            </View>
          ))}
        </View>
        {settings && (
          <View className="gap-3">
            <Button
              variant="outline"
              label={`${t("production.quietHours")}: ${t(settings.quietHours ? "production.on" : "production.off")}`}
              onPress={() =>
                command.mutate({
                  type: "settings.save",
                  settings: { ...settings, quietHours: !settings.quietHours },
                })
              }
            />
            <Text variant="label">{t("production.quietStart")}</Text>
            <Input
              accessibilityLabel={t("production.quietStart")}
              defaultValue={settings.quietStart}
              onEndEditing={(event) =>
                command.mutate({
                  type: "settings.save",
                  settings: { ...settings, quietStart: event.nativeEvent.text },
                })
              }
              maxLength={5}
              keyboardType="numbers-and-punctuation"
            />
            <Text variant="label">{t("production.quietEnd")}</Text>
            <Input
              accessibilityLabel={t("production.quietEnd")}
              defaultValue={settings.quietEnd}
              onEndEditing={(event) =>
                command.mutate({
                  type: "settings.save",
                  settings: { ...settings, quietEnd: event.nativeEvent.text },
                })
              }
              maxLength={5}
              keyboardType="numbers-and-punctuation"
            />
          </View>
        )}
        </>}
        {backupsOnly && <View className="gap-3">
          <Text variant="heading">{t("production.backups")}</Text>
          <Button
            label={t("production.export")}
            loading={action.isPending}
            onPress={() => action.mutate(() => createBackup(true))}
          />
          <Button
            variant="outline"
            label={t("production.import")}
            onPress={() => action.mutate(importBackup)}
          />
          {data.data?.backups.map((name) => (
            <View
              key={name}
              className="gap-2 rounded-md border border-border p-3"
            >
              <Text>{name}</Text>
              <Button
                variant="outline"
                label={t("production.restore")}
                onPress={() => action.mutate(() => restoreBackup(name))}
              />
            </View>
          ))}
        </View>}
        {(action.isError || command.isError || data.isError) && (
          <Text accessibilityRole="alert" className="text-destructive">
            {action.error?.message === "notificationDenied"
              ? t("production.notificationDenied")
              : (action.error?.message ??
                command.error?.message ??
                data.error?.message)}
          </Text>
        )}
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}
