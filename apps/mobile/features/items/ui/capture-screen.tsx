import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DateTimeField } from "@/components/ui/date-time-field";
import { Text } from "@/components/ui/text";
import { Sheet } from "@/components/ui/sheet";
import { useTheme } from "@/lib/theme";
import {
  BottomSheetModal,
  BottomSheetModalProvider,
} from "@gorhom/bottom-sheet";
import { MenuView } from "@react-native-menu/menu";
import { useDock, useCommand } from "@/lib/use-dock";
import { enableReminders } from "@/lib/reminders";
import { addAttachment, openAttachment } from "@/lib/files";
import {
  taskPropertiesSchema,
  spaceSchema,
  noteStyleSchema,
  type Item,
  type TaskProperties,
} from "@dock/contracts";
import { parseTaskText } from "@dock/core/tasks";
import dayjs from "dayjs";
import * as Crypto from "expo-crypto";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { storage } from "@/lib/storage";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Pressable,
  View,
} from "react-native";
import { useMutation } from "@tanstack/react-query";
import {
  KeyboardAvoidingView,
  KeyboardAwareScrollView,
} from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSaveItem } from "../mutations/mutations";
import { saveItem } from "../api/items";
import { RichNoteEditor } from "./rich-note-editor";

function CaptureForm({
  item: initialItem,
  kind,
  today,
  projectId,
  parentId,
}: {
  item?: Item;
  kind: Item["kind"];
  today: boolean;
  projectId?: string;
  parentId?: string;
}) {
  const { t, i18n } = useTranslation();
  const { colors, scheme } = useTheme();
  const snapshot = useDock().data!;
  const save = useSaveItem(),
    command = useCommand();
  const nativeAction = useMutation({
    mutationFn: async (run: () => Promise<unknown>) => run(),
  });
  const [item] = useState(initialItem);
  const draftKey = `note.draft.${item?.id ?? "new"}`;
  const [recovered] = useState(() => {
    const raw = kind === "note" ? storage.getString(draftKey) : undefined;
    if (!raw) return null;
    try {
      return z
        .object({
          title: z.string().max(500),
          body: z.string().max(200000),
          space: spaceSchema.optional(),
          tags: z.string().max(2000).optional(),
          noteStyle: noteStyleSchema.optional(),
          revision: z.number().int().positive().optional(),
        })
        .parse(JSON.parse(raw));
    } catch {
      return null;
    }
  });
  const [baseRevision, setBaseRevision] = useState(
    recovered?.revision ?? item?.revision,
  );
  const [title, setTitle] = useState(recovered?.title ?? item?.title ?? "");
  const [body, setBody] = useState(recovered?.body ?? item?.body ?? "");
  const [savedContent, setSavedContent] = useState(
    JSON.stringify([
      item?.title ?? "",
      item?.body ?? "",
      item?.space ?? "Inbox",
      item?.tags.join(", ") ?? "",
      item?.noteStyle ?? {},
    ]),
  );
  const [draftSaved, setDraftSaved] = useState(false);
  const [autosaveError, setAutosaveError] = useState("");
  const [task, setTask] = useState(() =>
    taskPropertiesSchema.parse(
      item?.task ?? {
        projectId: projectId ?? null,
        parentId: parentId ?? null,
      },
    ),
  );
  const [scheduledAt, setScheduledAt] = useState(
    item?.scheduledAt ?? (today ? dayjs().endOf("day").toISOString() : null),
  );
  const [recurrence, setRecurrence] = useState<Item["recurrence"]>(
    item?.recurrence ?? "none",
  );
  const [space, setSpace] = useState<Item["space"]>(
    recovered?.space ?? item?.space ?? "Inbox",
  );
  const [tags, setTags] = useState(
    recovered?.tags ?? item?.tags.join(", ") ?? "",
  );
  const [linkedNoteId, setLinkedNoteId] = useState(item?.linkedNoteId ?? "");
  const [noteStyle, setNoteStyle] = useState(
    recovered?.noteStyle ??
      item?.noteStyle ?? {
        font: snapshot.settings.noteFont,
        size: snapshot.settings.noteSize,
      },
  );
  const [comment, setComment] = useState("");
  const [richOpen, setRichOpen] = useState(false);
  const properties = useRef<BottomSheetModal>(null);
  const isNote = kind === "note";
  const patch = (value: Partial<TaskProperties>) =>
    setTask((current) => ({ ...current, ...value }));
  const recognize = () => {
    if (item || isNote) return;
    try {
      const parsed = parseTaskText(title, snapshot.workspace);
      if (!parsed.recognized.length) return;
      setTitle(parsed.title);
      patch(parsed.task);
      if (parsed.scheduledAt) setScheduledAt(parsed.scheduledAt);
      if (parsed.recurrence !== "none") setRecurrence(parsed.recurrence);
      if (parsed.tags.length)
        setTags(
          [
            ...new Set([
              ...tags
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean),
              ...parsed.tags,
            ]),
          ].join(", "),
        );
    } catch {
      /* Invalid syntax remains visible so it can be edited before saving. */
    }
  };
  const notes = snapshot.items.filter((value) => value.kind === "note");
  const draft = {
    ...item,
    kind,
    title,
    body,
    space,
    tags: tags
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    noteStyle,
    priority: isNote ? (item?.priority ?? false) : task.priority < 4,
    scheduledAt: isNote ? null : scheduledAt,
    recurrence: isNote ? ("none" as const) : recurrence,
    linkedNoteId: isNote ? null : linkedNoteId || null,
    task,
    expectedRevision: baseRevision,
  };

  const content = JSON.stringify([title, body, space, tags, noteStyle]);
  useEffect(() => {
    if (!isNote || content === savedContent) return;
    try {
      storage.set(
        draftKey,
        JSON.stringify({
          title,
          body,
          space,
          tags,
          noteStyle,
          revision: baseRevision,
        }),
      );
      setDraftSaved(true);
    } catch (error) {
      setAutosaveError(
        error instanceof Error ? error.message : t("errors.save"),
      );
      return;
    }
    const timer = setTimeout(() => {
      if (!item || !title.trim()) return;
      try {
        const saved = saveItem(draft);
        setBaseRevision(saved.revision);
        setSavedContent(content);
        setAutosaveError("");
        storage.remove(draftKey);
      } catch (error) {
        setAutosaveError(
          error instanceof Error ? error.message : t("errors.save"),
        );
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [content, savedContent, baseRevision]);
  const canSave =
    !!title.trim() && (isNote || recurrence === "none" || !!scheduledAt);
  const busy = save.isPending || command.isPending || nativeAction.isPending;
  const submit = () =>
    save.mutate(draft, {
      onSuccess: () => {
        if (isNote) storage.remove(draftKey);
        router.back();
      },
      onError: (error) => {
        if (!isNote)
          Alert.alert(
            t("capture.saveFailed"),
            error.message === "staleItem"
              ? t("errors.staleItem")
              : error instanceof z.ZodError
                ? t("capture.invalidFields")
                : t("errors.save"),
          );
      },
    });
  return (
    <SafeAreaView
      className="flex-1 bg-background"
      edges={isNote ? undefined : ["left", "right", "bottom"]}
    >
      <Stack.Screen
        options={
          isNote
            ? { headerShown: false }
            : {
                headerShown: true,
                title: t(item ? "capture.editTask" : "capture.newTask"),
                headerStyle: { backgroundColor: colors.background },
                headerTintColor: colors.foreground,
                headerShadowVisible: false,
                gestureEnabled: true,
                headerRight: () => (
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    {item && (
                      <MenuView
                        themeVariant={scheme}
                        onOpenMenu={() => Keyboard.dismiss()}
                        isAnchoredToRight={i18n.dir() !== "rtl"}
                        style={{
                          minWidth: 44,
                          minHeight: 44,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                        actions={[
                          ...(!item.done
                            ? [
                                {
                                  id: "snooze",
                                  title: t("production.snooze"),
                                  attributes: { disabled: busy },
                                },
                              ]
                            : []),
                          {
                            id: "attach",
                            title: t("production.addAttachment"),
                            attributes: { disabled: busy },
                          },
                          {
                            id: "delete",
                            title: t("production.delete"),
                            attributes: { destructive: true, disabled: busy },
                          },
                        ]}
                        onPressAction={({ nativeEvent }) => {
                          if (nativeEvent.event === "delete")
                            command.mutate(
                              { type: "item.delete", id: item.id },
                              { onSuccess: () => router.back() },
                            );
                          if (nativeEvent.event === "snooze")
                            command.mutate(
                              { type: "item.snooze", id: item.id, minutes: 10 },
                              { onSuccess: () => router.back() },
                            );
                          if (nativeEvent.event === "attach")
                            nativeAction.mutate(async () => {
                              const saved = saveItem(draft);
                              await addAttachment(saved);
                              router.back();
                            });
                        }}
                      >
                        <View
                          accessible
                          accessibilityRole="button"
                          accessibilityLabel={t("capture.actions")}
                          accessibilityState={{ disabled: busy }}
                          style={{
                            minWidth: 44,
                            minHeight: 44,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Icon
                            name="ellipsis-horizontal"
                            color={colors.foreground}
                            size={24}
                          />
                        </View>
                      </MenuView>
                    )}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t(
                        item ? "common.save" : "capture.addTask",
                      )}
                      accessibilityState={{
                        disabled: !canSave || busy,
                        busy: save.isPending,
                      }}
                      disabled={!canSave || busy}
                      onPress={submit}
                      style={{
                        minHeight: 44,
                        paddingHorizontal: 12,
                        justifyContent: "center",
                        opacity: !canSave || busy ? 0.4 : 1,
                      }}
                    >
                      {save.isPending ? (
                        <ActivityIndicator color={colors.primary} />
                      ) : (
                        <Text
                          style={{ color: colors.primary, fontWeight: "600" }}
                        >
                          {t("common.save")}
                        </Text>
                      )}
                    </Pressable>
                  </View>
                ),
              }
        }
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        {isNote && (
          <View className="flex-row items-center justify-between border-b border-border px-3 py-2">
            <Button
              variant="ghost"
              label={t("common.cancel")}
              onPress={() => router.back()}
              disabled={save.isPending}
            />
            <Text variant="heading">
              {t(item ? "capture.editNote" : "capture.newNote")}
            </Text>
            <View className="w-10" />
          </View>
        )}
        <KeyboardAwareScrollView
          bottomOffset={24}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            padding: isNote ? 20 : 16,
            gap: isNote ? 20 : 12,
          }}
        >
          {!isNote && (
            <Icon
              name="document-text-outline"
              size={30}
              className="text-foreground"
            />
          )}
          <View className="gap-2">
            {isNote && <Text variant="label">{t("capture.title")}</Text>}
            <Input
              autoFocus={!item}
              accessibilityLabel={t("capture.title")}
              value={title}
              onChangeText={setTitle}
              onBlur={recognize}
              placeholder={t(
                isNote ? "capture.notePlaceholder" : "capture.taskPlaceholder",
              )}
              maxLength={500}
              multiline
              className={
                isNote
                  ? "text-xl"
                  : "border-0 bg-transparent px-0 py-0 text-3xl font-semibold leading-10"
              }
            />
          </View>
          {isNote && (
            <View className="gap-2">
              <Text variant="label">{t("capture.noteBody")}</Text>
              <Text variant="muted" numberOfLines={5}>
                {body.replace(/<[^>]*>/g, " ").slice(0, 500) ||
                  t("capture.noteBodyPlaceholder")}
              </Text>
              <Button
                variant="outline"
                label={t("production.richEditor")}
                onPress={() => setRichOpen(true)}
              />
            </View>
          )}
          {isNote && (
            <Input
              accessibilityLabel={t("production.tags")}
              placeholder={t("production.tags")}
              value={tags}
              onChangeText={setTags}
            />
          )}
          {isNote ? (
            <>
              <Select
                label={t("production.space")}
                value={space}
                options={["Inbox", "Work", "Personal"].map((value) => ({
                  value,
                  label: t(`production.${value}`),
                }))}
                onChange={(value) => setSpace(value as Item["space"])}
              />
              <Select
                label={t("production.font")}
                value={noteStyle.font ?? "system"}
                options={["system", "serif", "mono"].map((value) => ({
                  value,
                  label: t(`production.${value}`),
                }))}
                onChange={(value) =>
                  setNoteStyle({
                    ...noteStyle,
                    font: value as "system" | "serif" | "mono",
                  })
                }
              />
              <Button
                variant="outline"
                label={`${t("production.fullWidth")}: ${t(noteStyle.fullWidth ? "production.on" : "production.off")}`}
                onPress={() =>
                  setNoteStyle({
                    ...noteStyle,
                    fullWidth: !noteStyle.fullWidth,
                  })
                }
              />
              <Select
                label={t("production.fontSize")}
                value={String(noteStyle.size ?? 16)}
                options={[14, 16, 18].map((value) => ({
                  value: String(value),
                  label: String(value),
                }))}
                onChange={(value) =>
                  setNoteStyle({
                    ...noteStyle,
                    size: Number(value) as 14 | 16 | 18,
                  })
                }
              />
            </>
          ) : (
            <>
              <View>
                <Select
                  presentation="property"
                  icon="folder-outline"
                  label={t("production.project")}
                  value={task.projectId ?? ""}
                  options={[
                    { value: "", label: t("items.noProject") },
                    ...snapshot.workspace.projects.map((value) => ({
                      value: value.id,
                      label: value.name,
                    })),
                  ]}
                  onChange={(value) =>
                    patch({
                      projectId: value || null,
                      sectionId: null,
                      parentId: null,
                    })
                  }
                />
                <Select
                  presentation="property"
                  icon="flag-outline"
                  label={t("production.priority")}
                  value={String(task.priority)}
                  options={[1, 2, 3, 4].map((value) => ({
                    value: String(value),
                    label: `P${value}`,
                  }))}
                  onChange={(value) =>
                    patch({ priority: Number(value) as 1 | 2 | 3 | 4 })
                  }
                />
                <DateTimeField
                  presentation="property"
                  label={t("capture.schedule")}
                  value={scheduledAt}
                  onChange={setScheduledAt}
                />
                <View className="min-h-12 flex-row items-center gap-2">
                  <View className="w-24 flex-row items-center gap-2">
                    <Icon
                      name="pricetag-outline"
                      size={15}
                      className="text-muted-foreground"
                    />
                    <Text variant="muted" className="shrink text-xs">
                      {t("capture.labels")}
                    </Text>
                  </View>
                  <Input
                    className="flex-1 border-0 bg-transparent px-0 text-sm"
                    accessibilityLabel={t("production.tags")}
                    placeholder={t("production.none")}
                    value={tags}
                    onChangeText={setTags}
                  />
                </View>
              </View>
              <View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("capture.moreProperties")}
                  onPress={() => {
                    Keyboard.dismiss();
                    properties.current?.present();
                  }}
                  className="min-h-12 flex-row items-center gap-2"
                >
                  <Icon
                    name="options-outline"
                    size={15}
                    className="text-muted-foreground"
                  />
                  <Text variant="muted" className="text-xs">
                    {t("capture.moreProperties")}
                  </Text>
                </Pressable>
                <Sheet
                  sheetRef={properties}
                  title={t("capture.moreProperties")}
                >
                  <View className="gap-3 pb-3">
                    <DateTimeField
                      label={t("production.deadline")}
                      value={task.deadline}
                      onChange={(value) => patch({ deadline: value })}
                    />
                    <Select
                      presentation="property"
                      icon="list-outline"
                      label={t("production.section")}
                      value={task.sectionId ?? ""}
                      options={[
                        { value: "", label: t("production.noSection") },
                        ...(
                          snapshot.workspace.projects.find(
                            (value) => value.id === task.projectId,
                          )?.sections ?? []
                        ).map((value) => ({
                          value: value.id,
                          label: value.name,
                        })),
                      ]}
                      onChange={(value) => patch({ sectionId: value || null })}
                    />
                    <Select
                      presentation="property"
                      icon="return-up-back-outline"
                      label={t("production.parent")}
                      value={task.parentId ?? ""}
                      options={[
                        { value: "", label: t("production.none") },
                        ...snapshot.items
                          .filter(
                            (value) =>
                              value.kind === "task" &&
                              value.id !== item?.id &&
                              value.task.projectId === task.projectId,
                          )
                          .map((value) => ({
                            value: value.id,
                            label: value.title,
                          })),
                      ]}
                      onChange={(value) => patch({ parentId: value || null })}
                    />
                    <View className="gap-2">
                      <Text variant="label">{t("production.duration")}</Text>
                      <Input
                        inSheet
                        accessibilityLabel={t("production.duration")}
                        placeholder={t("production.duration")}
                        value={String(task.durationMinutes)}
                        onChangeText={(value) =>
                          patch({ durationMinutes: Number(value) })
                        }
                        keyboardType="number-pad"
                      />
                    </View>
                    <Select
                      presentation="property"
                      icon="repeat-outline"
                      label={t("production.repeat")}
                      value={recurrence}
                      options={[
                        "none",
                        "daily",
                        "weekly",
                        "monthly",
                        "weekdays",
                        "custom",
                      ].map((value) => ({
                        value,
                        label: t(`recurrence.${value}`),
                      }))}
                      onChange={(value) =>
                        setRecurrence(value as Item["recurrence"])
                      }
                    />
                    {recurrence === "custom" && (
                      <>
                        <View className="gap-2">
                          <Text variant="label">
                            {t("production.interval")}
                          </Text>
                          <Input
                            inSheet
                            accessibilityLabel={t("production.interval")}
                            placeholder={t("production.interval")}
                            value={String(task.repeat.interval)}
                            onChangeText={(value) =>
                              patch({
                                repeat: {
                                  ...task.repeat,
                                  interval: Number(value),
                                },
                              })
                            }
                            keyboardType="number-pad"
                          />
                        </View>
                        <Select
                          label={t("production.repeat")}
                          value={task.repeat.unit}
                          options={["day", "week", "month"].map((value) => ({
                            value,
                            label: t(`recurrence.${value}`),
                          }))}
                          onChange={(value) =>
                            patch({
                              repeat: {
                                ...task.repeat,
                                unit: value as "day" | "week" | "month",
                              },
                            })
                          }
                        />
                        <Button
                          variant="outline"
                          label={`${t("production.afterCompletion")}: ${t(task.repeat.afterCompletion ? "production.on" : "production.off")}`}
                          onPress={() =>
                            patch({
                              repeat: {
                                ...task.repeat,
                                afterCompletion: !task.repeat.afterCompletion,
                              },
                            })
                          }
                        />
                      </>
                    )}
                    <Select
                      presentation="property"
                      icon="document-text-outline"
                      label={t("production.linkedNote")}
                      value={linkedNoteId}
                      options={[
                        { value: "", label: t("production.none") },
                        ...notes.map((value) => ({
                          value: value.id,
                          label: value.title,
                        })),
                      ]}
                      onChange={setLinkedNoteId}
                    />
                    <View className="gap-2">
                      <Text variant="label">{t("production.assignee")}</Text>
                      <Input
                        inSheet
                        accessibilityLabel={t("production.assignee")}
                        placeholder={t("production.assignee")}
                        value={task.assignee}
                        onChangeText={(value) => patch({ assignee: value })}
                        keyboardType="email-address"
                        autoCapitalize="none"
                      />
                    </View>
                    <View className="gap-3">
                      <Text variant="heading">{t("production.reminders")}</Text>
                      {task.reminders.map((value, index) => (
                        <DateTimeField
                          key={index}
                          label={t("production.notifyAt")}
                          value={value}
                          onChange={(next) =>
                            patch({
                              reminders: next
                                ? task.reminders.map((old, at) =>
                                    at === index ? next : old,
                                  )
                                : task.reminders.filter(
                                    (_, at) => at !== index,
                                  ),
                            })
                          }
                        />
                      ))}
                      <Button
                        variant="outline"
                        label={t("production.addReminder")}
                        loading={nativeAction.isPending}
                        onPress={() =>
                          nativeAction.mutate(async () => {
                            await enableReminders();
                            patch({
                              reminders: [
                                ...task.reminders,
                                dayjs().add(1, "hour").second(0).toISOString(),
                              ],
                            });
                          })
                        }
                        disabled={task.reminders.length >= 20}
                      />
                      {nativeAction.error?.message === "notificationDenied" && (
                        <>
                          <Text
                            accessibilityRole="alert"
                            className="text-destructive"
                          >
                            {t("production.notificationDenied")}
                          </Text>
                          <Button
                            variant="outline"
                            label={t("production.notificationSettings")}
                            onPress={() => router.push("/data")}
                          />
                        </>
                      )}
                    </View>
                  </View>
                </Sheet>
              </View>
              <View className="gap-2 border-t border-border pt-4">
                <Text variant="label">{t("capture.details")}</Text>
                <Input
                  accessibilityLabel={t("capture.details")}
                  value={body}
                  onChangeText={setBody}
                  placeholder={t("capture.detailsPlaceholder")}
                  multiline
                  textAlignVertical="top"
                  maxLength={200000}
                  className="min-h-24 border-0 bg-transparent px-0 text-sm leading-6"
                />
              </View>
              {item && (
                <View className="gap-3 border-t border-border pt-4">
                  <View className="flex-row items-center gap-2">
                    <Icon
                      name="list-outline"
                      size={16}
                      className="text-muted-foreground"
                    />
                    <Text variant="label">{t("production.subtasks")}</Text>
                  </View>
                  {snapshot.items
                    .filter((value) => value.task.parentId === item.id)
                    .map((value) => (
                      <View
                        key={value.id}
                        className="flex-row items-start gap-2"
                      >
                        <Pressable
                          accessibilityRole="checkbox"
                          accessibilityLabel={t(
                            value.done ? "items.reopen" : "items.complete",
                            { title: value.title },
                          )}
                          accessibilityState={{
                            checked: value.done,
                            disabled: command.isPending,
                          }}
                          disabled={command.isPending}
                          onPress={() =>
                            command.mutate({
                              type: "item.toggle",
                              id: value.id,
                            })
                          }
                          className="min-h-12 w-11 items-center justify-center"
                        >
                          <Icon
                            name={
                              value.done ? "checkbox-outline" : "square-outline"
                            }
                            size={20}
                            className="text-muted-foreground"
                          />
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={t("common.edit", {
                            title: value.title,
                          })}
                          onPress={() =>
                            router.push({
                              pathname: "/capture",
                              params: { id: value.id },
                            })
                          }
                          className="min-h-12 flex-1 justify-center py-2"
                        >
                          <Text
                            className={
                              value.done
                                ? "text-sm text-muted-foreground line-through"
                                : "text-sm"
                            }
                          >
                            {value.title}
                          </Text>
                        </Pressable>
                      </View>
                    ))}
                  <Button
                    variant="ghost"
                    icon="add"
                    className="self-start"
                    label={t("production.addSubtask")}
                    onPress={() =>
                      router.push({
                        pathname: "/capture",
                        params: {
                          parentId: item.id,
                          projectId: task.projectId ?? "",
                        },
                      })
                    }
                  />
                </View>
              )}
              <View className="gap-3 border-t border-border pt-4">
                <View className="flex-row items-center gap-2">
                  <Icon
                    name="chatbubble-outline"
                    size={16}
                    className="text-muted-foreground"
                  />
                  <Text variant="label">
                    {t("production.comments")} ({task.comments.length})
                  </Text>
                </View>
                {task.comments.map((value) => (
                  <View
                    key={value.id}
                    className="gap-2 border-s-2 border-border ps-3 py-1"
                  >
                    <Text>{value.body}</Text>
                    {value.attachments.map((file) => (
                      <Button
                        key={file.id}
                        variant="outline"
                        label={file.name}
                        onPress={() =>
                          nativeAction.mutate(() => openAttachment(file.path))
                        }
                      />
                    ))}
                  </View>
                ))}
                <Input
                  accessibilityLabel={t("production.comment")}
                  placeholder={t("production.comment")}
                  value={comment}
                  onChangeText={setComment}
                  multiline
                  maxLength={20000}
                />
                <Button
                  variant="ghost"
                  label={t("production.addComment")}
                  disabled={!comment.trim()}
                  onPress={() => {
                    patch({
                      comments: [
                        ...task.comments,
                        {
                          id: Crypto.randomUUID(),
                          body: comment.trim(),
                          createdAt: dayjs().toISOString(),
                          attachments: [],
                        },
                      ],
                    });
                    setComment("");
                  }}
                />
              </View>
            </>
          )}
          {!!autosaveError && (
            <Text accessibilityRole="alert" className="text-destructive">
              {autosaveError === "staleItem"
                ? t("errors.staleItem")
                : autosaveError}
            </Text>
          )}
          {isNote && draftSaved && content !== savedContent && (
            <Text variant="muted">{t("production.autoSave")}</Text>
          )}
          {isNote && recovered && (
            <Button
              variant="outline"
              label={t("production.discardDraft")}
              onPress={() => {
                storage.remove(draftKey);
                router.back();
              }}
            />
          )}
          {(save.isError ||
            command.isError ||
            (nativeAction.isError &&
              nativeAction.error.message !== "notificationDenied")) && (
            <Text accessibilityRole="alert" className="text-destructive">
              {nativeAction.error?.message === "unavailableAttachment"
                ? t("production.unavailableAttachment")
                : [save.error, command.error, nativeAction.error].some(
                      (error) => error?.message === "staleItem",
                    )
                  ? t("errors.staleItem")
                  : (save.error?.message ??
                    command.error?.message ??
                    nativeAction.error?.message)}
            </Text>
          )}
          {isNote && item && (
            <Button
              variant="ghost"
              label={t("production.delete")}
              icon="trash-outline"
              onPress={() =>
                command.mutate(
                  { type: "item.delete", id: item.id },
                  { onSuccess: () => router.back() },
                )
              }
            />
          )}
        </KeyboardAwareScrollView>
        {richOpen && (
          <RichNoteEditor
            value={body}
            noteStyle={noteStyle}
            onDraft={setBody}
            onSave={setBody}
            onClose={() => setRichOpen(false)}
            onOpenNote={(id) => {
              setRichOpen(false);
              router.push({ pathname: "/capture", params: { id } });
            }}
          />
        )}
        {isNote && (
          <View className="flex-row items-center gap-3 border-t border-border px-5 py-3">
            <Button
              className="flex-1"
              icon="checkmark"
              label={t(
                item
                  ? "common.save"
                  : isNote
                    ? "capture.addNote"
                    : "capture.addTask",
              )}
              disabled={!canSave}
              loading={save.isPending}
              onPress={submit}
            />
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function CaptureScreen() {
  const params = useLocalSearchParams<{
    id?: string;
    kind?: string;
    today?: string;
    projectId?: string;
    parentId?: string;
  }>();
  const query = useDock();
  const { t } = useTranslation();
  const item = query.data?.items.find((value) => value.id === params.id);
  if (query.isPending)
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </SafeAreaView>
    );
  if (query.isError || (params.id && !item))
    return (
      <SafeAreaView className="flex-1 justify-center gap-4 bg-background p-5">
        <Text accessibilityRole="alert">
          {t(query.isError ? "errors.load" : "capture.missing")}
        </Text>
        <Button
          variant="outline"
          label={t("common.cancel")}
          onPress={() => router.back()}
        />
      </SafeAreaView>
    );
  return (
    <BottomSheetModalProvider>
      <CaptureForm
        key={params.id ?? `${params.kind}-${params.parentId ?? ""}`}
        item={item}
        kind={item?.kind ?? (params.kind === "note" ? "note" : "task")}
        today={params.today === "1"}
        projectId={params.projectId || undefined}
        parentId={params.parentId || undefined}
      />
    </BottomSheetModalProvider>
  );
}
