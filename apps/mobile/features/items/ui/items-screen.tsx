import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DateTimeField } from "@/components/ui/date-time-field";
import { Text } from "@/components/ui/text";
import { useDock, useCommand } from "@/lib/use-dock";
import { saveWorkspace } from "@/features/workspace/api/workspace";
import { syncStatus } from "@/lib/sync";
import { compileFilter, compileSearch, taskComparator } from "@dock/core/tasks";
import { appBrand, type Item } from "@dock/contracts";
import { useMutation } from "@tanstack/react-query";
import dayjs from "dayjs";
import * as Crypto from "expo-crypto";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Image,
  ScrollView,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ItemRow } from "./item-row";
import { useSetTaskDone } from "../mutations/mutations";

export function ItemsScreen({ kind }: { kind: Item["kind"] }) {
  const { t, i18n } = useTranslation();
  const query = useDock(),
    toggle = useSetTaskDone(),
    command = useCommand();
  const [filter, setFilter] = useState("today"),
    [search, setSearch] = useState(""),
    [space, setSpace] = useState(""),
    [tag, setTag] = useState("");
  const [now, setNow] = useState(() => dayjs());
  const [calendar, setCalendar] = useState(() =>
    dayjs().endOf("day").toISOString(),
  );
  const [selecting, setSelecting] = useState(false),
    [selected, setSelected] = useState<Record<string, number>>({}),
    [templateName, setTemplateName] = useState("");
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const update = (active: boolean) => {
      clearInterval(timer);
      if (active) {
        setNow(dayjs());
        timer = setInterval(() => setNow(dayjs()), 60_000);
      }
    };
    update(AppState.currentState === "active");
    const listener = AppState.addEventListener("change", (state) =>
      update(state === "active"),
    );
    return () => {
      clearInterval(timer);
      listener.remove();
    };
  }, []);
  const action = useMutation({
    mutationFn: async (run: () => unknown) => run(),
  });
  useEffect(() => setNow(dayjs()), [t]);
  const isNote = kind === "note",
    snapshot = query.data;
  let items = snapshot?.items.filter((item) => item.kind === kind) ?? [],
    filterError = "";
  const status = snapshot ? syncStatus() : null;
  if (snapshot) {
    try {
      const matchSearch = compileSearch(search, snapshot.workspace);
      const savedFilter = filter.startsWith("filter:")
        ? compileFilter(
            snapshot.workspace.filters.find(
              (value) => value.id === filter.slice(7),
            )?.query ?? "",
            snapshot.workspace,
          )
        : null;
      items = items
        .filter((item) => {
          if (!matchSearch(item)) return false;
          if (isNote)
            return (
              (!space || item.space === space) &&
              (!tag || item.tags.includes(tag))
            );
          if (savedFilter) return savedFilter(item);
          if (item.done !== (filter === "done")) return false;
          if (filter === "inbox" && item.task.projectId) return false;
          if (filter === "starred" && item.task.priority === 4) return false;
          if (
            filter === "today" &&
            ![item.scheduledAt, item.task.deadline].some(
              (value) => value && !dayjs(value).isAfter(now.endOf("day")),
            )
          )
            return false;
          if (
            filter === "schedule" &&
            ![item.scheduledAt, item.task.deadline].some(
              (value) => value && dayjs(value).isSame(calendar, "day"),
            )
          )
            return false;
          return true;
        })
        .sort(
          isNote
            ? (a, b) => b.updatedAt.localeCompare(a.updatedAt)
            : taskComparator(now.format("YYYY-MM-DD")),
        );
    } catch (error) {
      filterError =
        error instanceof Error ? error.message : t("production.saveFailed");
      items = [];
    }
  }
  const add = () =>
    router.push({
      pathname: "/capture",
      params: { kind, today: !isNote && filter === "today" ? "1" : undefined },
    });
  const title = isNote
    ? t("nav.notes")
    : ["today", "inbox", "all", "done"].includes(filter)
      ? t(`items.${filter}`)
      : filter === "starred"
        ? t("production.priority")
        : filter === "schedule"
          ? t("production.upcoming")
          : (snapshot?.workspace.filters.find(
              (value) => value.id === filter.slice(7),
            )?.name ?? t("nav.tasks"));
  const empty = search.trim()
    ? "noResults"
    : isNote
      ? "emptyNotes"
      : filter === "today"
        ? "emptyToday"
        : filter === "done"
          ? "emptyDone"
          : "emptyTasks";
  const bulk = (
    action: "complete" | "delete" | "update",
    patch?: {
      task?: {
        priority?: 1 | 2 | 3 | 4;
        projectId?: string | null;
        sectionId?: null;
      };
      scheduledAt?: string | null;
    },
  ) =>
    command.mutate(
      {
        type: "item.bulk",
        ids: Object.keys(selected),
        expectedRevisions: selected,
        action,
        patch,
      },
      {
        onSuccess: () => {
          setSelected({});
          setSelecting(false);
        },
      },
    );
  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      <View className="gap-4 px-5 pb-4 pt-5">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <Image source={require("../../../assets/icon.png")} style={{ width: 32, height: 32, borderRadius: 8 }} accessibilityIgnoresInvertColors />
            <Text className="text-xl font-extrabold tracking-tight">{i18n.language === "ar" ? appBrand.arabicName : appBrand.name}</Text>
          </View>
          <Button
            variant="ghost"
            icon="sync-outline"
            label={t("production.sync")}
            onPress={() => router.push("/sync")}
          />
        </View>
        <View className="gap-2">
          <Text variant="muted">{now.format("dddd, D MMMM")}</Text>
          <Text className="text-4xl font-semibold tracking-tight">{title}</Text>
          <Text variant="muted">
            {status?.connected
              ? t(`syncState.${status.phase}`)
              : t("items.local")}
          </Text>
        </View>
        {!!status?.conflicts && (
          <Button
            variant="outline"
            icon="git-compare-outline"
            label={t("production.conflictsCount", { count: status.conflicts })}
            onPress={() => router.push("/conflicts")}
          />
        )}
        <Input
          accessibilityLabel={t("common.search")}
          placeholder={t("common.search")}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
        />
        {!isNote && (
          <Select
            label={t("nav.tasks")}
            value={filter}
            options={[
              ...["today", "inbox", "all", "done"].map((value) => ({
                value,
                label: t(`items.${value}`),
              })),
              { value: "starred", label: t("production.priority") },
              { value: "schedule", label: t("production.upcoming") },
              ...(
                snapshot?.workspace.filters.filter((value) => value.favorite) ??
                []
              ).map((value) => ({
                value: `filter:${value.id}`,
                label: value.name,
              })),
            ]}
            onChange={(value) => {
              setFilter(value);
              setSelecting(false);
              setSelected({});
            }}
          />
        )}
        {isNote && (
          <>
            <Select
              label={t("production.space")}
              value={space}
              options={[
                { value: "", label: t("items.all") },
                ...["Inbox", "Work", "Personal"].map((value) => ({
                  value,
                  label: value,
                })),
              ]}
              onChange={setSpace}
            />
            <Select
              label={t("production.tags")}
              value={tag}
              options={[
                { value: "", label: t("items.all") },
                ...[
                  ...new Set(
                    (snapshot?.items ?? [])
                      .filter((item) => item.kind === "note")
                      .flatMap((item) => item.tags),
                  ),
                ].map((value) => ({ value, label: value })),
              ]}
              onChange={setTag}
            />
          </>
        )}
        {filter === "schedule" && !isNote && (
          <>
            <ScrollView
              horizontal
              contentContainerStyle={{ gap: 8 }}
              showsHorizontalScrollIndicator={false}
            >
              {Array.from({ length: 7 }, (_, index) =>
                dayjs(calendar).startOf("week").add(index, "day"),
              ).map((date) => (
                <Button
                  key={date.toISOString()}
                  variant={
                    date.isSame(calendar, "day") ? "secondary" : "outline"
                  }
                  label={date.format("ddd D")}
                  onPress={() => setCalendar(date.endOf("day").toISOString())}
                />
              ))}
            </ScrollView>
            <DateTimeField
              label={t("production.calendar")}
              value={calendar}
              onChange={(value) => value && setCalendar(value)}
            />
            <Select
              label={t("items.unscheduled")}
              value=""
              options={[
                { value: "", label: t("items.unscheduled") },
                ...(snapshot?.items ?? [])
                  .filter(
                    (item) =>
                      item.kind === "task" && !item.done && !item.scheduledAt,
                  )
                  .map((item) => ({ value: item.id, label: item.title })),
              ]}
              onChange={(id) => {
                const item = snapshot?.items.find((value) => value.id === id);
                if (item)
                  command.mutate({
                    type: "item.save",
                    item: {
                      ...item,
                      expectedRevision: item.revision,
                      scheduledAt: calendar,
                    },
                  });
              }}
            />
          </>
        )}
        {!isNote && (
          <Button
            variant="ghost"
            label={t(selecting ? "common.cancel" : "production.bulk")}
            onPress={() => {
              setSelecting(!selecting);
              setSelected({});
            }}
          />
        )}
      </View>
      {(toggle.isError || command.isError || action.isError || filterError) && (
        <Text accessibilityRole="alert" className="px-5 pb-3 text-destructive">
          {filterError ||
            toggle.error?.message ||
            command.error?.message ||
            action.error?.message}
        </Text>
      )}
      {query.isPending ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : query.isError ? (
        <View className="flex-1 justify-center gap-4 px-5">
          <Text accessibilityRole="alert">{t("errors.load")}</Text>
          <Button
            label={t("common.retry")}
            onPress={() => void query.refetch()}
          />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingBottom: 20,
            flexGrow: 1,
          }}
          ItemSeparatorComponent={() => <View className="h-2" />}
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center gap-3 px-5 py-10">
              <Icon
                name={isNote ? "document-text-outline" : "sunny-outline"}
                size={32}
                className="text-primary"
              />
              <Text variant="heading" className="text-center">
                {t(`items.${empty}`)}
              </Text>
              <Text variant="muted" className="text-center leading-6">
                {t(`items.${empty}Body`)}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <ItemRow
              item={item}
              disabled={toggle.isPending}
              onToggle={() =>
                toggle.mutate({
                  id: item.id,
                  revision: item.revision,
                  done: !item.done,
                })
              }
              selected={selecting ? !!selected[item.id] : undefined}
              onSelect={
                selecting
                  ? () =>
                      setSelected((current) => {
                        const next = { ...current };
                        if (next[item.id]) delete next[item.id];
                        else next[item.id] = item.revision;
                        return next;
                      })
                  : undefined
              }
            />
          )}
        />
      )}
      {snapshot?.undo && (
        <Button
          variant="ghost"
          label={`${t("production.undo")} (${snapshot.undo.count})`}
          onPress={() =>
            command.mutate({ type: "item.undo", token: snapshot.undo!.token })
          }
        />
      )}
      {selecting && Object.keys(selected).length > 0 ? (
        <ScrollView
          className="max-h-64 border-t border-border bg-background"
          contentContainerStyle={{ padding: 16, gap: 8 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text variant="label">
            {t("production.selected")}: {Object.keys(selected).length}
          </Text>
          <View className="flex-row gap-2">
            <Button
              className="flex-1"
              label={t("production.done")}
              onPress={() => bulk("complete")}
            />
            <Button
              className="flex-1"
              variant="outline"
              label={t("production.delete")}
              onPress={() => bulk("delete")}
            />
          </View>
          <Select
            label={t("production.priority")}
            value=""
            options={[
              { value: "", label: t("production.priority") },
              ...[1, 2, 3, 4].map((value) => ({
                value: String(value),
                label: `P${value}`,
              })),
            ]}
            onChange={(value) =>
              value &&
              bulk("update", {
                task: { priority: Number(value) as 1 | 2 | 3 | 4 },
              })
            }
          />
          <Select
            label={t("production.project")}
            value=""
            options={[
              { value: "", label: t("production.project") },
              { value: "inbox", label: t("items.inbox") },
              ...(snapshot?.workspace.projects ?? []).map((value) => ({
                value: value.id,
                label: value.name,
              })),
            ]}
            onChange={(value) =>
              value &&
              bulk("update", {
                task: {
                  projectId: value === "inbox" ? null : value,
                  sectionId: null,
                },
              })
            }
          />
          <DateTimeField
            label={t("capture.schedule")}
            value={null}
            onChange={(scheduledAt) => bulk("update", { scheduledAt })}
          />
          <Input
            accessibilityLabel={t("production.template")}
            placeholder={t("production.template")}
            value={templateName}
            onChangeText={setTemplateName}
          />
          <Button
            variant="outline"
            label={t("production.saveTemplate")}
            disabled={!templateName.trim()}
            onPress={() =>
              action.mutate(() => {
                const workspace = snapshot!.workspace;
                saveWorkspace({
                  ...workspace,
                  templates: [
                    ...workspace.templates,
                    {
                      id: Crypto.randomUUID(),
                      name: templateName,
                      tasks: snapshot!.items
                        .filter((item) => selected[item.id])
                        .map((item) => ({
                          title: item.title,
                          body: item.body,
                          task: item.task,
                          tags: item.tags,
                        })),
                    },
                  ],
                });
                setSelecting(false);
                setSelected({});
                setTemplateName("");
              })
            }
          />
        </ScrollView>
      ) : (
        <View className="border-t border-border bg-background px-5 py-3">
          <Button
            icon="add"
            label={t(isNote ? "items.addNote" : "items.addTask")}
            onPress={add}
            disabled={query.isPending || query.isError}
          />
        </View>
      )}
    </SafeAreaView>
  );
}
