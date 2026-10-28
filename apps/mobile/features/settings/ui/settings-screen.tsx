import Constants from "expo-constants";
import { router } from "expo-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useDock, useCommand } from "@/lib/use-dock";
import type { Settings } from "@dock/contracts";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { setLanguage } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const settings = useDock().data?.settings;
  const command = useCommand();
  const update = (patch: Partial<Settings>) => {
    if (settings)
      command.mutate({
        type: "settings.save",
        settings: { ...settings, ...patch },
      });
  };
  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, gap: 28 }}>
        <View className="gap-2 pt-4">
          <Text variant="muted">Dock</Text>
          <Text className="text-3xl font-semibold">{t("settings.title")}</Text>
        </View>
        <Button
          icon="notifications-outline"
          variant="outline"
          label={t("production.notifications")}
          onPress={() => router.push("/data")}
        />
        <Button
          icon="folder-open-outline"
          variant="outline"
          label={t("production.backups")}
          onPress={() => router.push("/data")}
        />
        <Button
          icon="sync-outline"
          variant="outline"
          label={t("production.sync")}
          onPress={() => router.push("/sync")}
        />
        <Button
          icon="git-compare-outline"
          variant="outline"
          label={t("production.resolveConflicts")}
          onPress={() => router.push("/conflicts")}
        />
        <View className="gap-3">
          <Text variant="heading">{t("settings.appearance")}</Text>
          <View className="flex-row gap-2">
            {(["light", "dark", "system"] as const).map((preference) => (
              <Button
                key={preference}
                className="flex-1"
                label={t(`settings.${preference}`)}
                icon={
                  preference === "light"
                    ? "sunny-outline"
                    : preference === "dark"
                      ? "moon-outline"
                      : "phone-portrait-outline"
                }
                variant={
                  theme.preference === preference ? "secondary" : "outline"
                }
                accessibilityState={{
                  selected: theme.preference === preference,
                }}
                onPress={() => theme.setPreference(preference)}
              />
            ))}
          </View>
        </View>
        {settings && (
          <View className="gap-3">
            <Select
              label={t("production.palette")}
              value={settings.colorPreset}
              options={["Graphite", "Forest", "Violet"].map((value) => ({
                value,
                label: t(`production.${value}`),
              }))}
              onChange={(value) =>
                update({
                  colorPreset: value as Settings["colorPreset"],
                  themeColors: { dark: {}, light: {} },
                })
              }
            />
            <Select
              label={t("production.corners")}
              value={settings.rounding}
              options={["square", "subtle", "balanced", "rounded"].map(
                (value) => ({ value, label: t(`production.${value}`) }),
              )}
              onChange={(value) =>
                update({ rounding: value as Settings["rounding"] })
              }
            />
            <Select
              label={t("production.density")}
              value={settings.density}
              options={["compact", "comfortable"].map((value) => ({
                value,
                label: t(`production.${value}`),
              }))}
              onChange={(value) =>
                update({ density: value as Settings["density"] })
              }
            />
            <Select
              label={t("production.font")}
              value={settings.noteFont}
              options={["system", "serif", "mono"].map((value) => ({
                value,
                label: t(`production.${value}`),
              }))}
              onChange={(value) =>
                update({ noteFont: value as Settings["noteFont"] })
              }
            />
            <Select
              label={t("production.fontSize")}
              value={String(settings.noteSize)}
              options={[14, 16, 18].map((value) => ({
                value: String(value),
                label: String(value),
              }))}
              onChange={(value) =>
                update({ noteSize: Number(value) as Settings["noteSize"] })
              }
            />
            <Text variant="heading">{t("production.customColors")}</Text>
            {(
              [
                "background",
                "card",
                "foreground",
                "mutedForeground",
                "border",
                "primary",
              ] as const
            ).map((key) => (
              <View
                key={`${theme.scheme}-${key}-${theme.colors[key]}`}
                className="gap-2"
              >
                <Text variant="label">{t(`production.${key}`)}</Text>
                <Input
                  accessibilityLabel={t(`production.${key}`)}
                  defaultValue={theme.colors[key]}
                  autoCapitalize="none"
                  maxLength={7}
                  onEndEditing={(event) =>
                    update({
                      themeColors: {
                        ...settings.themeColors,
                        [theme.scheme]: {
                          ...settings.themeColors[theme.scheme],
                          [key]: event.nativeEvent.text,
                        },
                      },
                    })
                  }
                />
              </View>
            ))}
            {command.isError && (
              <Text accessibilityRole="alert" className="text-destructive">
                {t("production.hexColor")}
              </Text>
            )}
          </View>
        )}
        <View className="gap-3">
          <Text variant="heading">{t("settings.language")}</Text>
          {(["en", "ar"] as const).map((language) => (
            <Button
              key={language}
              label={t(
                language === "en" ? "settings.english" : "settings.arabic",
              )}
              icon={
                i18n.language === language
                  ? "checkmark-circle-outline"
                  : "globe-outline"
              }
              variant="outline"
              accessibilityState={{ selected: i18n.language === language }}
              onPress={() => void setLanguage(language)}
            />
          ))}
        </View>
        <View className="gap-3 rounded-md border border-border bg-card p-5">
          <Icon
            name="phone-portrait-outline"
            className="text-primary"
            size={26}
          />
          <Text variant="heading">{t("settings.storage")}</Text>
          <Text variant="muted" className="leading-6">
            {t("settings.storageBody")}
          </Text>
        </View>
        <Text variant="muted">
          {t("settings.version", { version: Constants.expoConfig?.version })}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
