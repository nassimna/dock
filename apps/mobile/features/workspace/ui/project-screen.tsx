import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Text } from "@/components/ui/text";
import { ItemRow } from "@/features/items/ui/item-row";
import { useDock, useCommand } from "@/lib/use-dock";
import { syncFeature, syncFeatures, syncStatus } from "@/lib/sync";
import { type Project } from "@dock/contracts";
import { useMutation } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, FlatList, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { removeProject, saveProject } from "../api/workspace";

function ProjectPage({ initial }: { initial?: Project }) {
  const { t } = useTranslation();
  const snapshot = useDock().data!;
  const command = useCommand();
  const [expected, setExpected] = useState(initial);
  const [draft, setDraft] = useState<Project>(
    () =>
      initial ?? {
        id: Crypto.randomUUID(),
        name: "",
        parentId: null,
        color: "#8b70ef",
        favorite: false,
        sections: [],
      },
  );
  const [editing, setEditing] = useState(!initial),
    [board, setBoard] = useState(false),
    [email, setEmail] = useState("");
  const action = useMutation({
    mutationFn: async (run: () => unknown) => run(),
  });
  const project =
    snapshot.workspace.projects.find((value) => value.id === draft.id) ?? draft;
  const tasks = snapshot.items
    .filter(
      (item) =>
        item.kind === "task" &&
        item.task.projectId === project.id &&
        !item.task.parentId &&
        !item.done,
    )
    .sort((a, b) => a.task.order - b.task.order);
  const columns = [
    { id: "", name: t("production.noSection") },
    ...project.sections,
  ];
  const shared = syncFeatures().projects.find(
    (value) => value.id === project.id,
  );
  const owner = !shared || shared.ownerEmail === syncStatus().email;
  const save = () =>
    action.mutate(() => {
      const result = saveProject(draft, expected);
      const saved = result.workspace.projects.find(
        (value) => value.id === draft.id,
      )!;
      setExpected(saved);
      setDraft(saved);
      setEditing(false);
    });
  const move = (id: string, sectionId: string) => {
    const target = tasks.filter(
      (item) => (item.task.sectionId ?? "") === sectionId && item.id !== id,
    );
    const item = tasks.find((value) => value.id === id)!;
    const ordered = [...target, item];
    command.mutate({
      type: "item.reorder",
      projectId: project.id,
      sectionId: sectionId || null,
      ids: ordered.map((value) => value.id),
      expectedRevisions: Object.fromEntries(
        ordered.map((value) => [value.id, value.revision]),
      ),
    });
  };
  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-row items-center justify-between gap-2 border-b border-border px-3 py-2">
        <Button
          variant="ghost"
          label={t("common.cancel")}
          onPress={() => router.back()}
        />
        <Text variant="heading" numberOfLines={1} className="flex-1">
          {project.name || t("production.project")}
        </Text>
        {!editing && owner && (
          <Button
            variant="outline"
            label={t("common.edit", { title: "" })}
            onPress={() => {
              setDraft(project);
              setExpected(project);
              setEditing(true);
            }}
          />
        )}
      </View>
      {editing ? (
        <KeyboardAwareScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 20, gap: 16 }}
        >
          <Input
            accessibilityLabel={t("production.name")}
            placeholder={t("production.name")}
            value={draft.name}
            onChangeText={(name) => setDraft({ ...draft, name })}
            maxLength={100}
          />
          <Select
            label={t("production.parentProject")}
            value={draft.parentId ?? ""}
            options={[
              { value: "", label: t("production.none") },
              ...snapshot.workspace.projects
                .filter((value) => value.id !== draft.id)
                .map((value) => ({ value: value.id, label: value.name })),
            ]}
            onChange={(value) =>
              setDraft({ ...draft, parentId: value || null })
            }
          />
          <Input
            accessibilityLabel={t("production.color")}
            placeholder={t("production.color")}
            value={draft.color}
            onChangeText={(color) => setDraft({ ...draft, color })}
            autoCapitalize="none"
            maxLength={7}
          />
          <Button
            variant="outline"
            label={`${t("production.favorite")}: ${t(draft.favorite ? "production.on" : "production.off")}`}
            onPress={() => setDraft({ ...draft, favorite: !draft.favorite })}
          />
          <Text variant="heading">{t("production.sections")}</Text>
          {draft.sections.map((section, index) => (
            <View
              key={section.id}
              className="gap-2 rounded-md border border-border p-3"
            >
              <Input
                accessibilityLabel={t("production.section")}
                value={section.name}
                onChangeText={(name) =>
                  setDraft({
                    ...draft,
                    sections: draft.sections.map((value) =>
                      value.id === section.id ? { ...value, name } : value,
                    ),
                  })
                }
                maxLength={100}
              />
              <View className="flex-row gap-2">
                <Button
                  className="flex-1"
                  variant="outline"
                  label={t("production.reorder")}
                  disabled={index === 0}
                  onPress={() => {
                    const sections = [...draft.sections];
                    [sections[index - 1], sections[index]] = [
                      sections[index]!,
                      sections[index - 1]!,
                    ];
                    setDraft({ ...draft, sections });
                  }}
                />
                <Button
                  variant="ghost"
                  label={t("production.delete")}
                  onPress={() =>
                    setDraft({
                      ...draft,
                      sections: draft.sections.filter(
                        (value) => value.id !== section.id,
                      ),
                    })
                  }
                />
              </View>
            </View>
          ))}
          <Button
            variant="outline"
            label={t("production.createSection")}
            disabled={draft.sections.length >= 100}
            onPress={() =>
              setDraft({
                ...draft,
                sections: [
                  ...draft.sections,
                  { id: Crypto.randomUUID(), name: t("production.section") },
                ],
              })
            }
          />
          <Button
            loading={action.isPending}
            label={t("common.save")}
            disabled={!draft.name.trim()}
            onPress={save}
          />
          {initial && !shared && (
            <Button
              variant="ghost"
              label={t("production.delete")}
              onPress={() =>
                Alert.alert(
                  t("production.delete"),
                  t("production.projectDelete"),
                  [
                    { text: t("common.cancel"), style: "cancel" },
                    {
                      text: t("production.confirm"),
                      style: "destructive",
                      onPress: () =>
                        action.mutate(() => {
                          removeProject(project.id);
                          router.back();
                        }),
                    },
                  ],
                )
              }
            />
          )}
        </KeyboardAwareScrollView>
      ) : (
        <>
          <View className="flex-row gap-2 px-5 py-3">
            <Button
              className="flex-1"
              variant="outline"
              label={t(board ? "production.list" : "production.board")}
              onPress={() => setBoard(!board)}
            />
            <Button
              className="flex-1"
              label={t("items.addTask")}
              onPress={() =>
                router.push({
                  pathname: "/capture",
                  params: { kind: "task", projectId: project.id },
                })
              }
            />
          </View>
          {board ? (
            <FlatList
              horizontal
              data={columns.filter(
                (column) =>
                  !project.hiddenColumns?.includes(column.id || "none"),
              )}
              keyExtractor={(column) => column.id}
              contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
              renderItem={({ item: column }) => (
                <View className="w-80 gap-3 rounded-md bg-secondary p-3">
                  <Text variant="heading">{column.name}</Text>
                  <Button
                    variant="ghost"
                    label={t("production.hide")}
                    onPress={() =>
                      action.mutate(() =>
                        saveProject(
                          {
                            ...project,
                            hiddenColumns: [
                              ...(project.hiddenColumns ?? []),
                              column.id || "none",
                            ],
                          },
                          project,
                        ),
                      )
                    }
                  />
                  <FlatList
                    data={tasks.filter(
                      (item) => (item.task.sectionId ?? "") === column.id,
                    )}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={{ gap: 12, paddingBottom: 16 }}
                    renderItem={({ item }) => (
                      <View className="gap-2">
                        <ItemRow
                          item={item}
                          onToggle={() =>
                            command.mutate({
                              type: "item.complete",
                              id: item.id,
                            })
                          }
                        />
                        <Select
                          label={t("production.section")}
                          value={item.task.sectionId ?? ""}
                          options={columns.map((value) => ({
                            value: value.id,
                            label: value.name,
                          }))}
                          onChange={(value) => move(item.id, value)}
                        />
                        <Button
                          variant="ghost"
                          label={t("production.reorder")}
                          onPress={() => {
                            const ordered = tasks.filter(
                              (value) =>
                                value.task.sectionId === item.task.sectionId,
                            );
                            const at = ordered.findIndex(
                              (value) => value.id === item.id,
                            );
                            if (at < 1) return;
                            [ordered[at - 1], ordered[at]] = [
                              ordered[at]!,
                              ordered[at - 1]!,
                            ];
                            command.mutate({
                              type: "item.reorder",
                              projectId: project.id,
                              sectionId: item.task.sectionId,
                              ids: ordered.map((value) => value.id),
                              expectedRevisions: Object.fromEntries(
                                ordered.map((value) => [
                                  value.id,
                                  value.revision,
                                ]),
                              ),
                            });
                          }}
                        />
                      </View>
                    )}
                  />
                </View>
              )}
            />
          ) : (
            <FlatList
              data={tasks}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ padding: 20, gap: 12 }}
              ListEmptyComponent={
                <Text variant="muted">{t("production.empty")}</Text>
              }
              renderItem={({ item }) => (
                <ItemRow
                  item={item}
                  onToggle={() =>
                    command.mutate({ type: "item.complete", id: item.id })
                  }
                />
              )}
            />
          )}
          {!!project.hiddenColumns?.length && (
            <Button
              variant="ghost"
              label={t("production.showAll")}
              onPress={() =>
                action.mutate(() =>
                  saveProject({ ...project, hiddenColumns: [] }, project),
                )
              }
            />
          )}
          <View className="gap-2 border-t border-border px-5 py-3">
            {shared ? (
              <>
                <Text variant="label">
                  {t("production.members")}:{" "}
                  {shared.members.map((member) => member.email).join(", ")}
                </Text>
                {owner && (
                  <>
                    <Input
                      accessibilityLabel={t("production.email")}
                      placeholder={t("production.email")}
                      value={email}
                      onChangeText={setEmail}
                      autoCapitalize="none"
                      keyboardType="email-address"
                    />
                    <View className="flex-row gap-2">
                      <Button
                        className="flex-1"
                        variant="outline"
                        label={t("production.inviteMember")}
                        onPress={() =>
                          action.mutate(() =>
                            syncFeature({
                              type: "sync.project.invite",
                              projectId: project.id,
                              email,
                            }),
                          )
                        }
                      />
                      <Button
                        className="flex-1"
                        variant="outline"
                        label={t("production.removeMember")}
                        onPress={() =>
                          action.mutate(() =>
                            syncFeature({
                              type: "sync.project.remove",
                              projectId: project.id,
                              email,
                            }),
                          )
                        }
                      />
                    </View>
                    <Button
                      variant="outline"
                      label={t("production.updateSharedProject")}
                      onPress={() =>
                        action.mutate(() =>
                          syncFeature({ type: "sync.project.share", project }),
                        )
                      }
                    />
                  </>
                )}
              </>
            ) : (
              <Button
                variant="outline"
                label={t("production.shareProject")}
                disabled={!syncStatus().connected || !!project.parentId}
                onPress={() =>
                  action.mutate(() =>
                    syncFeature({ type: "sync.project.share", project }),
                  )
                }
              />
            )}
          </View>
        </>
      )}
      {(action.isError || command.isError) && (
        <Text accessibilityRole="alert" className="px-5 py-3 text-destructive">
          {action.error?.message ?? command.error?.message}
        </Text>
      )}
    </SafeAreaView>
  );
}

export function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useDock();
  const { t } = useTranslation();
  if (!query.data)
    return (
      <SafeAreaView className="flex-1 bg-background p-5">
        <Text>{t(query.isError ? "errors.load" : "common.loading")}</Text>
      </SafeAreaView>
    );
  const project = query.data.workspace.projects.find(
    (value) => value.id === id,
  );
  if (id !== "new" && !project)
    return (
      <SafeAreaView className="flex-1 bg-background p-5">
        <Text>{t("capture.missing")}</Text>
        <Button label={t("common.cancel")} onPress={() => router.back()} />
      </SafeAreaView>
    );
  return <ProjectPage key={id} initial={project} />;
}
