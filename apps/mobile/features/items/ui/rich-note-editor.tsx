import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Text } from "@/components/ui/text";
import { useTheme } from "@/lib/theme";
import type { Item } from "@dock/contracts";
import { dockEditorHtml } from "../../../.generated/dock-editor";
import {
  BridgeExtension,
  type EditorBridge,
  RichText,
  TenTapStartKit,
  LinkBridge,
  useBridgeState,
  useEditorBridge,
} from "@10play/tentap-editor";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Linking, Modal, ScrollView, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

export function RichNoteEditor({
  value,
  noteStyle,
  onDraft,
  onSave,
  onClose,
  onOpenNote,
}: {
  value: string;
  noteStyle: Item["noteStyle"];
  onDraft: (value: string) => void;
  onSave: (value: string) => void;
  onClose: () => void;
  onOpenNote: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const { colors, scheme } = useTheme();
  const [reading, setReading] = useState(false);
  const editorRef = useRef<EditorBridge | null>(null);
  const action = useMutation({
    mutationFn: async (run: () => Promise<unknown>) => run(),
  });
  const [formatting] = useState(
    () =>
      new BridgeExtension({
        forceName: "dockFormatting",
        extendEditorInstance: (send) => ({
          format: (action: string, value = "") =>
            send({ type: "dock-format", payload: { action, value } }),
        }),
        onEditorMessage: (message) => {
          if (
            message.type !== "dock-link" ||
            typeof message.payload?.url !== "string"
          )
            return false;
          const note = message.payload.url.match(
            /^dock-note:\/\/([0-9a-f-]{36})$/i,
          );
          if (note) onOpenNote(note[1]!);
          else if (/^(https?:|mailto:)/i.test(message.payload.url))
            action.mutate(() => Linking.openURL(message.payload.url));
          return true;
        },
      }),
  );
  const dirty = useRef(false);
  const [source, setSource] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const editor = useEditorBridge({
    initialContent: value,
    customSource: dockEditorHtml,
    bridgeExtensions: [
      ...TenTapStartKit.filter((bridge) => bridge.name !== LinkBridge.name),
      LinkBridge.configureExtension({
        protocols: ["dock-note"],
        openOnClick: false,
      }),
      formatting,
    ],
    autofocus: false,
    onChange: () => {
      dirty.current = true;
      const current = editorRef.current;
      if (current) action.mutate(async () => onDraft(await current.getHTML()));
    },
    theme: {
      webview: { backgroundColor: colors.background },
      webviewContainer: { backgroundColor: colors.background },
    },
  }) as EditorBridge & { format: (action: string, value?: string) => void };
  editorRef.current = editor;
  const state = useBridgeState(editor);
  const close = () =>
    action.mutate(async () => {
      if (source !== null) onDraft(source);
      else if (dirty.current) onDraft(await editor.getHTML());
      onClose();
    });
  const save = useMutation({
    mutationFn: async () => {
      const next =
        source !== null
          ? source
          : dirty.current
            ? await editor.getHTML()
            : value;
      if (next.length > 200000) throw new Error(t("errors.save"));
      onSave(next);
      onClose();
    },
  });
  useEffect(() => {
    if (state.isReady) {
      editor.injectJS(
        `document.documentElement.dataset.theme=${JSON.stringify(scheme)}`,
      );
      editor.setEditable(!reading);
      editor.injectCSS(
        `body{color:${colors.foreground};background:${colors.background};direction:${i18n.dir()};font-family:${noteStyle.font === "serif" ? "Georgia,serif" : noteStyle.font === "mono" ? "monospace" : "system-ui"};font-size:${noteStyle.size ?? 16}px}.tiptap{max-width:${noteStyle.fullWidth ? "none" : "720px"};margin:auto}a{color:${colors.primary}}`,
      );
    }
  }, [
    colors,
    editor,
    state.isReady,
    i18n.language,
    reading,
    noteStyle,
    scheme,
  ]);
  const format = (action: string, value?: string) => {
    dirty.current = true;
    editor.format("restoreSelection");
    editor.format(action, value);
  };
  const options = [
    "heading",
    "quote",
    "code",
    "divider",
    "table",
    "callout",
    "toggle",
    "contents",
    "duplicate",
    "moveUp",
    "moveDown",
    "textColor",
    "backgroundColor",
  ] as const;
  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <SafeAreaView className="flex-1 bg-background">
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <View className="flex-row items-center justify-between border-b border-border p-3">
            <Button
              variant="ghost"
              label={t("common.cancel")}
              onPress={close}
            />
            <Text variant="heading" className="flex-1" numberOfLines={1}>
              {t("production.richEditor")}
            </Text>
            <Button
              label={t("common.save")}
              loading={save.isPending}
              disabled={!state.isReady && source === null}
              onPress={() => save.mutate()}
            />
          </View>
          <View className="px-3 py-2">
            <Button
              variant="outline"
              label={t(reading ? "production.write" : "production.read")}
              onPress={() => setReading(!reading)}
            />
          </View>
          {!reading && (
            <>
              <ScrollView
                horizontal
                className="max-h-16 border-b border-border"
                contentContainerStyle={{ padding: 8, gap: 8 }}
                keyboardShouldPersistTaps="handled"
              >
                <Button
                  variant="outline"
                  label={t("production.bold")}
                  onPress={() => {
                    dirty.current = true;
                    editor.toggleBold();
                  }}
                />
                <Button
                  variant="outline"
                  label={t("production.italic")}
                  onPress={() => {
                    dirty.current = true;
                    editor.toggleItalic();
                  }}
                />
                <Button
                  variant="outline"
                  label={t("production.bulletList")}
                  onPress={() => {
                    dirty.current = true;
                    editor.toggleBulletList();
                  }}
                />
                <Button
                  variant="outline"
                  label={t("production.checklist")}
                  onPress={() => {
                    dirty.current = true;
                    editor.toggleTaskList();
                  }}
                />
                <Button
                  variant="outline"
                  label={t("production.link")}
                  onPress={() => setLinkOpen(!linkOpen)}
                />
                <Button
                  variant="outline"
                  label={t("production.undo")}
                  onPress={() => editor.undo()}
                />
                <Button
                  variant="outline"
                  label={t("production.redo")}
                  onPress={() => editor.redo()}
                />
                <Button
                  variant="outline"
                  label={t("production.source")}
                  onPress={() =>
                    action.mutate(async () => {
                      if (source === null)
                        setSource(
                          dirty.current ? await editor.getHTML() : value,
                        );
                      else {
                        format("source", source);
                        setSource(null);
                      }
                    })
                  }
                />
              </ScrollView>
              <View className="px-3 py-2">
                <Select
                  label={t("production.format")}
                  value=""
                  options={[
                    { value: "", label: t("production.format") },
                    ...options.map((action) => ({
                      value: action,
                      label: t(`production.${action}`),
                    })),
                  ]}
                  onChange={(action) => {
                    if (!action) return;
                    format(
                      action,
                      action === "heading"
                        ? "2"
                        : action === "toggle"
                          ? t("production.toggle")
                          : action === "textColor"
                            ? colors.primary
                            : action === "backgroundColor"
                              ? colors.card
                              : "",
                    );
                  }}
                />
              </View>
              {linkOpen && (
                <View className="flex-row gap-2 p-3">
                  <Input
                    className="flex-1"
                    accessibilityLabel={t("production.url")}
                    placeholder={t("production.url")}
                    value={link}
                    onChangeText={setLink}
                    autoCapitalize="none"
                  />
                  <Button
                    label={t("production.apply")}
                    disabled={
                      !/^(https?:\/\/|mailto:|dock-note:\/\/[0-9a-f-]{36}$)/i.test(
                        link,
                      )
                    }
                    onPress={() => {
                      dirty.current = true;
                      editor.format("restoreSelection");
                      editor.setLink(link);
                      setLinkOpen(false);
                    }}
                  />
                </View>
              )}
            </>
          )}
          {source !== null ? (
            <Input
              className="flex-1 rounded-none p-5"
              accessibilityLabel={t("production.source")}
              value={source}
              editable={!reading}
              onChangeText={(value) => {
                setSource(value);
                onDraft(value);
              }}
              multiline
              textAlignVertical="top"
              maxLength={200000}
            />
          ) : (
            <RichText
              editor={editor}
              style={{ flex: 1 }}
              webviewDebuggingEnabled={__DEV__}
              allowFileAccess={false}
              allowFileAccessFromFileURLs={false}
              mixedContentMode="never"
              onShouldStartLoadWithRequest={(request) => {
                const note = request.url.match(
                  /^dock-note:\/\/([0-9a-f-]{36})$/i,
                );
                if (note) {
                  onOpenNote(note[1]!);
                  return false;
                }
                if (/^(https?:|mailto:)/i.test(request.url)) {
                  action.mutate(() => Linking.openURL(request.url));
                  return false;
                }
                return request.url === "about:blank";
              }}
            />
          )}
          {(save.isError || action.isError) && (
            <Text accessibilityRole="alert" className="p-3 text-destructive">
              {save.error?.message ?? action.error?.message}
            </Text>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
