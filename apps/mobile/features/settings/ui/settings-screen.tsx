import Constants from "expo-constants";
import { router, useFocusEffect } from "expo-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useDock, useCommand } from "@/lib/use-dock";
import { appBrand, type Settings } from "@dock/contracts";
import { colorPresets } from "@dock/core/theme";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { setLanguage } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { useTranslation } from "react-i18next";
import { BackHandler, Pressable, ScrollView, View } from "react-native";
import { useCallback, useState } from "react";
import type { IconName } from "@/components/ui/icon";
import { syncStatus } from "@/lib/sync";
import { SafeAreaView } from "react-native-safe-area-context";

export function SettingsScreen() {
  const [section, setSection] = useState<"root" | "appearance" | "language" | "about">("root");
  const [customColors, setCustomColors] = useState(false);
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const settings = useDock().data?.settings;
  const command = useCommand();
  const sync = syncStatus();
  useFocusEffect(useCallback(() => {
    if (section === "root") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => { setSection("root"); return true; });
    return () => subscription.remove();
  }, [section]));
  const update = (patch: Partial<Settings>) => {
    if (settings)
      command.mutate({
        type: "settings.save",
        settings: { ...settings, ...patch },
      });
  };
  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      <ScrollView key={section} contentContainerStyle={{ padding: 20, gap: 24 }}>
        {section !== "root" && <Button variant="ghost" icon={i18n.dir() === "rtl" ? "arrow-forward-outline" : "arrow-back-outline"} label={t("account.back")} className="self-start" onPress={() => setSection("root")} />}
        <View className="gap-2 pt-2">
          <Text variant="muted">{i18n.language === "ar" ? appBrand.arabicName : appBrand.name}</Text>
          <Text className="text-3xl font-semibold">{t(section === "root" ? "preferences.title" : section === "about" ? "preferences.about" : `settings.${section}`)}</Text>
          {section === "root" && <Text variant="muted">{t("preferences.subtitle")}</Text>}
        </View>
        {section === "root" && <>
          <SettingsRow icon="person-circle-outline" title={sync.connected ? sync.email : t("account.title")} description={t(sync.connected ? "preferences.accountHint" : "account.syncHint")} onPress={() => router.push("/sync")} />
          <View className="rounded-md border border-border bg-card">
            <SettingsRow icon="color-palette-outline" title={t("settings.appearance")} description={t("preferences.appearanceHint")} onPress={() => setSection("appearance")} />
            <SettingsRow icon="globe-outline" title={t("settings.language")} description={t(i18n.language === "ar" ? "settings.arabic" : "settings.english")} onPress={() => setSection("language")} />
            <SettingsRow icon="notifications-outline" title={t("production.notifications")} description={t("preferences.notificationsHint")} onPress={() => router.push({ pathname: "/data", params: { section: "notifications" } })} />
            <SettingsRow icon="folder-open-outline" title={t("production.backups")} description={t("preferences.dataHint")} onPress={() => router.push({ pathname: "/data", params: { section: "backups" } })} />
          </View>
          <SettingsRow icon="information-circle-outline" title={t("preferences.about")} description={t("settings.version", { version: Constants.expoConfig?.version })} onPress={() => setSection("about")} />
        </>}
        {section === "appearance" && <>
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
              options={Object.keys(colorPresets).map((value) => ({
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
            <Button variant="outline" label={t("preferences.custom")} icon={customColors ? "chevron-up-outline" : "chevron-down-outline"} accessibilityState={{ expanded: customColors }} onPress={() => setCustomColors(!customColors)} />
            {customColors && (
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
                {t("preferences.saveError")}
              </Text>
            )}
          </View>
        )}
        </>}
        {section === "language" && <View className="gap-3">
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
        </View>}
        {section === "about" && <><View className="gap-3 rounded-md border border-border bg-card p-5">
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
        </Text></>}
      </ScrollView>
    </SafeAreaView>
  );
}

function SettingsRow({ icon, title, description, onPress }: { icon: IconName; title: string; description: string; onPress: () => void }) {
  const { i18n } = useTranslation();
  return <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${description}`} onPress={onPress} className="min-h-20 flex-row items-center gap-4 p-4 active:bg-accent">
    <Icon name={icon} size={24} className="text-primary" />
    <View className="flex-1 gap-1"><Text className="font-semibold">{title}</Text><Text variant="muted">{description}</Text></View>
    <Icon name={i18n.dir() === "rtl" ? "chevron-back-outline" : "chevron-forward-outline"} size={18} className="text-muted-foreground" />
  </Pressable>;
}
