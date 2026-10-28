import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Text } from "@/components/ui/text";
import { ItemRow } from "@/features/items/ui/item-row";
import { useDock, useCommand } from "@/lib/use-dock";
import { compileFilter } from "@dock/core/tasks";
import type { Item, Workspace } from "@dock/contracts";
import { useMutation } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import dayjs from "dayjs";
import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, FlatList, SectionList, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { saveWorkspace } from "../api/workspace";

type WorkspaceEntry =
  | Workspace["filters"][number]
  | Workspace["templates"][number]
  | Item;

export function WorkspaceScreen() {
  const { t } = useTranslation();
  const query = useDock(),
    command = useCommand();
  const [view, setView] = useState("projects");
  const [name, setName] = useState(""),
    [text, setText] = useState(""),
    [chosen, setChosen] = useState("");
  const [projectId, setProjectId] = useState("");
  const action = useMutation({
    mutationFn: async (run: () => unknown) => run(),
  });
  const snapshot = query.data;
  if (!snapshot)
    return (
      <SafeAreaView className="flex-1 bg-background p-5">
        <Text>{t(query.isError ? "errors.load" : "common.loading")}</Text>
      </SafeAreaView>
    );
  const workspace = snapshot.workspace;
  let completed: Item[] = [];
  let completedToday = 0,
    completedWeek = 0,
    streak = 0;
  if (view === "progress") {
    const now = dayjs();
    const today = now.format("YYYY-MM-DD");
    const monday = now.startOf("day").subtract((now.day() + 6) % 7, "day");
    completed = snapshot.items
      .filter((item) => item.kind === "task" && item.done)
      .sort((a, b) =>
        (b.completedAt ?? b.updatedAt).localeCompare(
          a.completedAt ?? a.updatedAt,
        ),
      );
    const counts = new Map<string, number>();
    for (const item of completed) {
      const day = dayjs(item.completedAt ?? item.updatedAt).format(
        "YYYY-MM-DD",
      );
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }
    completedToday = counts.get(today) ?? 0;
    for (let offset = 0; offset < 7; offset++)
      completedWeek +=
        counts.get(monday.add(offset, "day").format("YYYY-MM-DD")) ?? 0;
    const paused = (day: string) =>
      workspace.goals.vacationPeriods.some(
        (period) => day >= period.start && (!period.end || day <= period.end),
      );
    let cursor =
      completedToday < workspace.goals.daily && !paused(today)
        ? now.subtract(1, "day")
        : now;
    const earliest =
      [
        ...counts.keys(),
        ...workspace.goals.vacationPeriods.map((period) => period.start),
      ].sort()[0] ?? today;
    while (cursor.format("YYYY-MM-DD") >= earliest) {
      const day = cursor.format("YYYY-MM-DD");
      if (!paused(day) && (counts.get(day) ?? 0) < workspace.goals.daily) break;
      if (!paused(day)) streak++;
      cursor = cursor.subtract(1, "day");
    }
  }
  let matches = snapshot.items;
  let filterError = "";
  try {
    matches = chosen
      ? snapshot.items.filter(
          compileFilter(
            workspace.filters.find((value) => value.id === chosen)?.query ?? "",
            workspace,
          ),
        )
      : [];
  } catch (error) {
    filterError =
      error instanceof Error ? error.message : t("production.saveFailed");
  }
  const save = () =>
    action.mutate(() => {
      if (view === "filters") {
        compileFilter(text, workspace);
        return saveWorkspace({
          ...workspace,
          filters: [
            ...workspace.filters,
            {
              id: Crypto.randomUUID(),
              name: name.trim(),
              query: text.trim(),
              favorite: true,
            },
          ],
        });
      }
      return saveWorkspace({
        ...workspace,
        templates: [
          ...workspace.templates,
          {
            id: Crypto.randomUUID(),
            name: name.trim(),
            tasks: text
              .split("\n")
              .map((value) => value.trim())
              .filter(Boolean)
              .map((title) => ({ title, body: "" })),
          },
        ],
      });
    });
  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      <View className="gap-4 px-5 pb-4 pt-5">
        <Text className="text-3xl font-semibold">
          {t("production.workspace")}
        </Text>
        <Select
          label={t("production.workspace")}
          value={view}
          options={[
            "projects",
            "filters",
            "templates",
            "progress",
            "trash",
          ].map((value) => ({ value, label: t(`production.${value}`) }))}
          onChange={(value) => {
            setView(value);
            setName("");
            setText("");
            setChosen("");
            action.reset();
          }}
        />
      </View>
      {view === "projects" ? (
        <FlatList
          data={workspace.projects}
          keyExtractor={(value) => value.id}
          contentContainerStyle={{ padding: 20, gap: 12 }}
          ListHeaderComponent={
            <Button
              icon="add"
              label={t("production.add")}
              onPress={() =>
                router.push({
                  pathname: "/project/[id]",
                  params: { id: "new" },
                })
              }
            />
          }
          ListEmptyComponent={
            <Text variant="muted">{t("production.empty")}</Text>
          }
          renderItem={({ item }) => (
            <Button
              variant="outline"
              label={`${item.favorite ? "★ " : ""}${item.name}`}
              onPress={() =>
                router.push({
                  pathname: "/project/[id]",
                  params: { id: item.id },
                })
              }
            />
          )}
        />
      ) : view === "trash" ? (
        <FlatList
          data={snapshot.deletedItems}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 20, gap: 12 }}
          ListEmptyComponent={
            <Text variant="muted">{t("production.empty")}</Text>
          }
          renderItem={({ item }) => (
            <View className="gap-3 rounded-md border border-border p-4">
              <Text>{item.title}</Text>
              <Button
                variant="outline"
                label={t("production.restore")}
                onPress={() =>
                  command.mutate({ type: "item.restore", id: item.id })
                }
              />
              <Button
                variant="ghost"
                label={t("production.purge")}
                onPress={() =>
                  Alert.alert(
                    t("production.purge"),
                    t("production.confirmDelete"),
                    [
                      { text: t("common.cancel"), style: "cancel" },
                      {
                        text: t("production.confirm"),
                        style: "destructive",
                        onPress: () =>
                          command.mutate({ type: "item.purge", id: item.id }),
                      },
                    ],
                  )
                }
              />
            </View>
          )}
        />
      ) : view === "progress" ? (
        <FlatList
          data={completed}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 20, gap: 20 }}
          ListHeaderComponent={
            <View className="gap-5">
              <View className="gap-2 rounded-md border border-border p-5">
                <Text variant="muted">{t("production.completedToday")}</Text>
                <Text className="text-4xl font-semibold">
                  {completedToday} / {workspace.goals.daily}
                </Text>
              </View>
              <View className="gap-2 rounded-md border border-border p-5">
                <Text variant="muted">{t("production.completedWeek")}</Text>
                <Text className="text-4xl font-semibold">
                  {completedWeek} / {workspace.goals.weekly}
                </Text>
              </View>
              <View className="gap-2 rounded-md border border-border p-5">
                <Text variant="muted">{t("production.streak")}</Text>
                <Text className="text-4xl font-semibold">{streak}</Text>
                {workspace.goals.vacation && (
                  <Text variant="muted">{`${t("production.vacation")}: ${t("production.on")}`}</Text>
                )}
              </View>
              <Text variant="label">{t("production.dailyGoal")}</Text>
              <Input
                accessibilityLabel={t("production.dailyGoal")}
                defaultValue={String(workspace.goals.daily)}
                keyboardType="number-pad"
                onEndEditing={(event) =>
                  action.mutate(() =>
                    saveWorkspace({
                      ...workspace,
                      goals: {
                        ...workspace.goals,
                        daily: Number(event.nativeEvent.text),
                      },
                    }),
                  )
                }
              />
              <Text variant="label">{t("production.weeklyGoal")}</Text>
              <Input
                accessibilityLabel={t("production.weeklyGoal")}
                defaultValue={String(workspace.goals.weekly)}
                keyboardType="number-pad"
                onEndEditing={(event) =>
                  action.mutate(() =>
                    saveWorkspace({
                      ...workspace,
                      goals: {
                        ...workspace.goals,
                        weekly: Number(event.nativeEvent.text),
                      },
                    }),
                  )
                }
              />
              <Button
                variant="outline"
                label={`${t("production.vacation")}: ${t(workspace.goals.vacation ? "production.on" : "production.off")}`}
                onPress={() =>
                  action.mutate(() =>
                    saveWorkspace({
                      ...workspace,
                      goals: {
                        ...workspace.goals,
                        vacation: !workspace.goals.vacation,
                        vacationPeriods: workspace.goals.vacation
                          ? workspace.goals.vacationPeriods.map((period) =>
                              period.end
                                ? period
                                : {
                                    ...period,
                                    end: dayjs().format("YYYY-MM-DD"),
                                  },
                            )
                          : [
                              ...workspace.goals.vacationPeriods,
                              {
                                start: dayjs().format("YYYY-MM-DD"),
                                end: null,
                              },
                            ],
                      },
                    }),
                  )
                }
              />
            </View>
          }
          renderItem={({ item }) => <Text variant="muted">✓ {item.title}</Text>}
        />
      ) : (
        <SectionList<WorkspaceEntry>
          sections={[
            {
              key: "saved",
              data:
                view === "filters" ? workspace.filters : workspace.templates,
            },
            { key: "matches", data: filterError ? [] : matches },
          ]}
          keyExtractor={(item) => item.id}
          stickySectionHeadersEnabled={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 20, gap: 16 }}
          ListHeaderComponent={
            <View className="gap-4">
              <Input
                accessibilityLabel={t("production.name")}
                placeholder={t("production.name")}
                value={name}
                onChangeText={setName}
                maxLength={100}
              />
              <Input
                accessibilityLabel={t(
                  view === "filters"
                    ? "production.query"
                    : "production.templates",
                )}
                placeholder={
                  view === "filters" ? "today | p1" : t("production.template")
                }
                value={text}
                onChangeText={setText}
                multiline
                className="min-h-24"
              />
              <Button
                label={t("common.save")}
                disabled={!name.trim() || !text.trim()}
                loading={action.isPending}
                onPress={save}
              />
              {view === "templates" && (
                <Select
                  label={t("production.project")}
                  value={projectId}
                  options={[
                    { value: "", label: t("items.inbox") },
                    ...workspace.projects.map((value) => ({
                      value: value.id,
                      label: value.name,
                    })),
                  ]}
                  onChange={setProjectId}
                />
              )}
            </View>
          }
          renderSectionHeader={({ section }) =>
            section.key === "matches" && filterError ? (
              <Text accessibilityRole="alert" className="text-destructive">
                {filterError}
              </Text>
            ) : null
          }
          renderItem={({ item }) =>
            "kind" in item ? (
              <ItemRow
                item={item}
                onToggle={() =>
                  command.mutate({ type: "item.toggle", id: item.id })
                }
              />
            ) : (
              <View className="gap-3 rounded-md border border-border p-4">
                <Text variant="heading">{item.name}</Text>
                {view === "filters" ? (
                  <>
                    <Button
                      variant="outline"
                      label={t("production.apply")}
                      onPress={() => setChosen(item.id)}
                    />
                    <Button
                      variant="ghost"
                      label={t("production.favorite")}
                      onPress={() =>
                        action.mutate(() =>
                          saveWorkspace({
                            ...workspace,
                            filters: workspace.filters.map((filter) =>
                              filter.id === item.id
                                ? { ...filter, favorite: !filter.favorite }
                                : filter,
                            ),
                          }),
                        )
                      }
                    />
                  </>
                ) : (
                  <Button
                    variant="outline"
                    label={t("production.apply")}
                    onPress={() =>
                      command.mutate({
                        type: "template.apply",
                        id: item.id,
                        projectId: projectId || null,
                      })
                    }
                  />
                )}
                <Button
                  variant="ghost"
                  label={t("production.delete")}
                  onPress={() =>
                    action.mutate(() =>
                      view === "filters"
                        ? saveWorkspace({
                            ...workspace,
                            filters: workspace.filters.filter(
                              (filter) => filter.id !== item.id,
                            ),
                          })
                        : saveWorkspace({
                            ...workspace,
                            templates: workspace.templates.filter(
                              (template) => template.id !== item.id,
                            ),
                          }),
                    )
                  }
                />
              </View>
            )
          }
        />
      )}
      {(action.isError || command.isError) && (
        <Text accessibilityRole="alert" className="px-5 py-3 text-destructive">
          {action.error?.message ?? command.error?.message}
        </Text>
      )}
    </SafeAreaView>
  );
}
