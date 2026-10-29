import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { getDatabase } from "@/lib/database";
import { useCommand, useDock } from "@/lib/use-dock";
import type { Item } from "@dock/contracts";
import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export function ConflictsScreen() {
  const { t } = useTranslation();
  const dock = useDock();
  const query = useQuery({
    queryKey: ["sync-conflicts"],
    queryFn: () => getDatabase().syncConflicts(),
    networkMode: "always",
  });
  const command = useCommand();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);
  const scroll = useRef<ScrollView>(null);
  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [selectedId]);
  const selected = query.data?.find((entry) => entry.copy.id === selectedId);
  const resolve = (choice: "original" | "copy" | "both") => {
    if (!selected) return;
    Alert.alert(
      t(
        {
          original: selected.originalDeleted
            ? "production.keepDeletion"
            : "production.keepCurrent",
          copy: "production.keepSaved",
          both: "production.keepBoth",
        }[choice],
      ),
      t(
        choice === "both"
          ? "production.keepBothHelp"
          : "production.keepOneHelp",
      ),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("production.confirmResolution"),
          onPress: () =>
            command.mutate(
              {
                type: "sync.resolve",
                copyId: selected.copy.id,
                choice,
                expectedRevision: selected.copy.revision,
                expectedOriginalRevision: selected.original?.revision ?? null,
              },
              {
                onSuccess: () => {
                  setSelectedId(null);
                  setResolved(true);
                },
              },
            ),
        },
      ],
    );
  };
  const version = (item: Item, side: "current" | "saved", deleted = false) => (
    <View className="gap-3 rounded-md border border-border bg-card p-4">
      <Text variant="label">
        {t(
          side === "current"
            ? "production.currentVersion"
            : "production.savedVersion",
        )}
      </Text>
      {deleted && (
        <Text className="text-destructive">
          {t("production.versionDeleted")}
        </Text>
      )}
      <Text variant="heading" selectable>
        {item.title}
      </Text>
      <Text variant="muted">
        {t("production.versionUpdated", {
          date: dayjs(item.updatedAt).format("D MMM YYYY · HH:mm"),
        })}
      </Text>
      <Text selectable numberOfLines={8}>
        {item.body.replace(/<[^>]*>/g, " ") || t("production.noVersionBody")}
      </Text>
      {item.kind === "task" && (
        <>
          <Text>
            {t("capture.priority")}: P{item.task.priority} ·{" "}
            {t(item.done ? "items.done" : "production.incomplete")}
          </Text>
          <Text>
            {t("capture.schedule")}:{" "}
            {item.scheduledAt
              ? dayjs(item.scheduledAt).format("D MMM YYYY · HH:mm")
              : t("items.unscheduled")}
          </Text>
          <Text>
            {t("production.project")}:{" "}
            {dock.data?.workspace.projects.find(
              (project) => project.id === item.task.projectId,
            )?.name ?? t("items.noProject")}
          </Text>
          <Text>
            {t("production.deadline")}:{" "}
            {item.task.deadline
              ? dayjs(item.task.deadline).format("D MMM YYYY · HH:mm")
              : t("items.unscheduled")}
          </Text>
          <Text>
            {t("production.reminders")}:{" "}
            {item.task.reminders
              .map((date) => dayjs(date).format("D MMM · HH:mm"))
              .join(", ") || t("production.none")}
          </Text>
        </>
      )}
      {!!item.tags.length && (
        <Text>{item.tags.map((tag) => `#${tag}`).join(" ")}</Text>
      )}
      {!deleted && (
        <Button
          variant="outline"
          label={t(
            side === "current"
              ? "production.openCurrentVersion"
              : "production.openSavedVersion",
          )}
          onPress={() =>
            router.push({ pathname: "/capture", params: { id: item.id } })
          }
        />
      )}
    </View>
  );
  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-row items-center justify-between border-b border-border p-3">
        <Button
          variant="ghost"
          label={
            selectedId ? t("production.conflictsBack") : t("common.cancel")
          }
          onPress={() => {
            if (selectedId) {
              setSelectedId(null);
              command.reset();
            } else router.back();
          }}
        />
        <Text variant="heading" className="flex-1 text-end">
          {t(
            selected
              ? "production.reviewConflict"
              : "production.resolveConflicts",
          )}
        </Text>
      </View>
      <ScrollView ref={scroll} contentContainerStyle={{ padding: 20, gap: 20 }}>
        {query.isPending && <Text>{t("common.loading")}</Text>}
        {query.isError && (
          <View className="gap-3">
            <Text accessibilityRole="alert">
              {t("production.conflictsLoadError")}
            </Text>
            <Button
              label={t("common.retry")}
              onPress={() => void query.refetch()}
            />
          </View>
        )}
        {resolved && (
          <Text accessibilityLiveRegion="polite">
            {t("production.conflictResolved")}
          </Text>
        )}
        {selected ? (
          <>
            <Text variant="muted">{t("production.conflictHelp")}</Text>
            {selected.original ? (
              version(selected.original, "current", selected.originalDeleted)
            ) : (
              <Text accessibilityRole="alert">
                {t("production.conflictOriginalMissing")}
              </Text>
            )}
            {version(selected.copy, "saved")}
            <Text variant="muted">{t("production.keepOneHelp")}</Text>
            <Button
              variant="outline"
              disabled={!selected.original || command.isPending}
              label={t(
                selected.originalDeleted
                  ? "production.keepDeletion"
                  : "production.keepCurrent",
              )}
              onPress={() => resolve("original")}
            />
            <Button
              variant="outline"
              disabled={!selected.original || command.isPending}
              label={t("production.keepSaved")}
              onPress={() => resolve("copy")}
            />
            <Button
              loading={command.isPending}
              label={t("production.keepBoth")}
              onPress={() => resolve("both")}
            />
          </>
        ) : (
          query.isSuccess && (
            <>
              <Text variant="muted">{t("production.conflictsIntro")}</Text>
              {query.data.length === 0 && (
                <Text>{t("production.noConflicts")}</Text>
              )}
              {query.data.map((entry) => (
                <View
                  key={entry.copy.id}
                  className="gap-2 rounded-md border border-border bg-card p-4"
                >
                  <Text variant="heading">
                    {entry.original?.title ?? entry.copy.title}
                  </Text>
                  <Text variant="muted">
                    {entry.original
                      ? t("production.twoVersions")
                      : t("production.legacyConflict")}
                  </Text>
                  <Button
                    variant="outline"
                    label={t("production.reviewConflictItem", {
                      title: entry.original?.title ?? entry.copy.title,
                    })}
                    onPress={() => {
                      setSelectedId(entry.copy.id);
                      setResolved(false);
                      command.reset();
                    }}
                  />
                </View>
              ))}
            </>
          )
        )}
        {command.isError && (
          <Text accessibilityRole="alert" className="text-destructive">
            {t(`production.${command.error.message}`, {
              defaultValue: t("production.conflictsResolveError"),
            })}
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
