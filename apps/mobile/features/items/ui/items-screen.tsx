import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DateTimeField } from "@/components/ui/date-time-field";
import { Text } from "@/components/ui/text";
import { useDock, useCommand } from "@/lib/use-dock";
import { saveWorkspace } from "@/features/workspace/api/workspace";
import { cn } from "@/lib/utils";
import { syncStatus } from "@/lib/sync";
import { compileFilter, compileSearch, taskComparator } from "@dock/core/tasks";
import type { Item } from "@dock/contracts";
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
  ScrollView,
  Pressable,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ItemRow } from "./item-row";
import { useSetTaskDone } from "../mutations/mutations";

export function ItemsScreen({ kind }: { kind: Item["kind"] }) {
  const { t } = useTranslation();
  const query = useDock(),
    toggle = useSetTaskDone(),
    command = useCommand();
  const [filter, setFilter] = useState("inbox"),
    [search, setSearch] = useState(""),
    [space, setSpace] = useState(""),
    [tag, setTag] = useState("");
  const [showFilters, setShowFilters] = useState(false);
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
          if (filter === "unassigned" && item.task.projectId) return false;
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
      : filter === "unassigned"
        ? t("items.noProject")
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
      <View className="gap-3 px-4 pb-3 pt-2">
        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-1 gap-1">
            <Text className="text-2xl font-bold tracking-tight">{title}</Text>
            <Text variant="muted" className="text-xs">
              {!isNote && filter === "inbox"
                ? t("items.inboxSubtitle")
                : now.format("dddd, D MMMM")}
            </Text>
          </View>
          <Button
            variant="ghost"
            icon={
              status?.phase === "error"
                ? "cloud-offline-outline"
                : "cloud-outline"
            }
            iconOnly
            label={`${t("production.sync")}: ${status?.connected ? t(`syncState.${status.phase}`) : t("items.local")}`}
            onPress={() => router.push("/sync")}
          />
          {!isNote && (
            <Button
              variant={selecting ? "secondary" : "ghost"}
              icon={selecting ? "close-outline" : "checkbox-outline"}
              iconOnly
              label={t(selecting ? "common.cancel" : "production.bulk")}
              onPress={() => {
                setSelecting(!selecting);
                setSelected({});
              }}
            />
          )}
        </View>
        {!!status?.conflicts && (
          <Button
            variant="outline"
            icon="git-compare-outline"
            label={t("production.conflictsCount", { count: status.conflicts })}
            onPress={() => router.push("/conflicts")}
          />
        )}
        <View className="flex-row items-center gap-2">
          <View className="flex-1 flex-row items-center rounded-md bg-secondary px-3">
            <Icon
              name="search-outline"
              size={18}
              className="text-muted-foreground"
            />
            <Input
              className="flex-1 border-0 bg-transparent py-2 text-sm"
              accessibilityLabel={t("common.search")}
              placeholder={t("common.search")}
              value={search}
              onChangeText={setSearch}
              autoCorrect={false}
            />
          </View>
          <Button
            variant={showFilters ? "secondary" : "ghost"}
            icon="options-outline"
            iconOnly
            label={t("items.filters")}
            accessibilityState={{ expanded: showFilters }}
            onPress={() => setShowFilters(!showFilters)}
          />
        </View>
        {!isNote && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 6 }}
          >
            {(
              [
                ["inbox", "file-tray-outline"],
                ["today", "today-outline"],
                ["starred", "flag-outline"],
                ["done", "checkmark-circle-outline"],
              ] satisfies [string, IconName][]
            ).map(([value, icon]) => (
              <Pressable
                key={value}
                accessibilityRole="tab"
                accessibilityLabel={t(
                  value === "starred"
                    ? "production.priority"
                    : `items.${value}`,
                )}
                accessibilityState={{ selected: filter === value }}
                onPress={() => {
                  setFilter(value);
                  setSelecting(false);
                  setSelected({});
                }}
                className={cn(
                  "min-h-11 flex-row items-center gap-2 rounded-md px-3",
                  filter === value ? "bg-primary" : "bg-secondary",
                )}
              >
                <Icon
                  name={icon}
                  size={16}
                  className={
                    filter === value
                      ? "text-primary-foreground"
                      : "text-muted-foreground"
                  }
                />
                <Text
                  className={cn(
                    "text-sm font-medium",
                    filter === value
                      ? "text-primary-foreground"
                      : "text-foreground",
                  )}
                >
                  {t(
                    value === "starred"
                      ? "production.priority"
                      : `items.${value}`,
                  )}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
        {!isNote && showFilters && (
          <Select
            label={t("nav.tasks")}
            value={filter}
            options={[
              ...["today", "inbox", "all", "done"].map((value) => ({
                value,
                label: t(`items.${value}`),
              })),
              { value: "unassigned", label: t("items.noProject") },
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
        {isNote && showFilters && (
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
            paddingHorizontal: 16,
            paddingBottom: 20,
            flexGrow: 1,
          }}
          ItemSeparatorComponent={() => <View className="h-px bg-border" />}
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
              projectName={
                snapshot?.workspace.projects.find(
                  (project) => project.id === item.task.projectId,
                )?.name
              }
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
              { value: "inbox", label: t("items.noProject") },
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
        <View className="border-t border-border bg-background px-4 py-2">
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
