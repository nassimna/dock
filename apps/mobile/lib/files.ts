import { backupSchema, type Item } from "@dock/contracts";
import { todoistBackup } from "@dock/core/import";
import * as FileSystem from "expo-file-system/legacy";
import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
import * as Crypto from "expo-crypto";
import dayjs from "dayjs";
import { getDatabase, notifyChanged } from "./database";
import { execute } from "./actions";
import { localChanged } from "./sync";

function directory(name: string) {
  if (!FileSystem.documentDirectory)
    throw new Error("Private device storage is unavailable.");
  return `${FileSystem.documentDirectory}${name}/`;
}

export async function createBackup(share = false) {
  const root = directory("backups");
  await FileSystem.makeDirectoryAsync(root, { intermediates: true });
  const filename = `dock-${dayjs().format("YYYY-MM-DDTHH-mm-ss-SSS")}.json`;
  const uri = root + filename;
  await FileSystem.writeAsStringAsync(
    uri + ".tmp",
    JSON.stringify(getDatabase().backup(), null, 2),
  );
  await FileSystem.moveAsync({ from: uri + ".tmp", to: uri });
  const backups = (await FileSystem.readDirectoryAsync(root))
    .filter((name) => /^dock-[\dT-]+\.json$/.test(name))
    .sort()
    .reverse();
  for (const old of backups.slice(30))
    await FileSystem.deleteAsync(root + old, { idempotent: true });
  if (share) await Sharing.shareAsync(uri, { mimeType: "application/json" });
  return filename;
}

export async function listBackups() {
  const root = directory("backups");
  const info = await FileSystem.getInfoAsync(root);
  return info.exists
    ? (await FileSystem.readDirectoryAsync(root))
        .filter((name) => /^dock-[\dT-]+\.json$/.test(name))
        .sort()
        .reverse()
    : [];
}

export async function restoreBackup(name: string) {
  if (!/^dock-[\dT-]+\.json$/.test(name))
    throw new Error("Choose a Rivnote backup.");
  const value = await FileSystem.readAsStringAsync(directory("backups") + name);
  const count = getDatabase().restoreBackup(
    backupSchema.parse(JSON.parse(value)),
  );
  localChanged();
  notifyChanged();
  return count;
}

export async function importBackup() {
  const selected = await DocumentPicker.getDocumentAsync({
    type: [
      "application/json",
      "text/csv",
      "text/comma-separated-values",
      "text/plain",
    ],
    copyToCacheDirectory: true,
  });
  if (selected.canceled) return;
  const file = selected.assets[0]!;
  const info = await FileSystem.getInfoAsync(file.uri);
  if (!info.exists || info.size > 25 * 1024 * 1024)
    throw new Error("Choose a file up to 25 MB.");
  const text = await FileSystem.readAsStringAsync(file.uri);
  if (file.name.toLowerCase().endsWith(".csv")) {
    getDatabase().restoreBackup(
      todoistBackup(
        text,
        file.name.replace(/\.csv$/i, ""),
        getDatabase().workspace(),
        Crypto.randomUUID,
      ),
    );
  } else getDatabase().restoreBackup(JSON.parse(text));
  localChanged();
  notifyChanged();
}

export async function addAttachment(item: Item) {
  const selected = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
  });
  if (selected.canceled) return;
  const file = selected.assets[0]!;
  const info = await FileSystem.getInfoAsync(file.uri);
  const extension = file.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0];
  if (
    !extension ||
    ![
      ".png",
      ".jpg",
      ".jpeg",
      ".gif",
      ".webp",
      ".pdf",
      ".txt",
      ".md",
      ".csv",
      ".json",
      ".docx",
      ".xlsx",
      ".pptx",
    ].includes(extension)
  )
    throw new Error("Choose an image or supported document.");
  if (!info.exists || info.size > 25 * 1024 * 1024)
    throw new Error("Attachments must be at most 25 MB.");
  const root = directory("attachments");
  await FileSystem.makeDirectoryAsync(root, { intermediates: true });
  const id = Crypto.randomUUID(),
    uri = root + id + extension;
  await FileSystem.copyAsync({ from: file.uri, to: uri });
  try {
    execute({
      type: "item.save",
      item: {
        ...item,
        expectedRevision: item.revision,
        task: {
          ...item.task,
          comments: [
            ...item.task.comments,
            {
              id: Crypto.randomUUID(),
              body: "",
              createdAt: dayjs().toISOString(),
              attachments: [
                { id, name: file.name, path: uri, size: info.size },
              ],
            },
          ],
        },
      },
    });
  } catch (error) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
    throw error;
  }
}

export async function openAttachment(path: string) {
  const root = directory("attachments");
  const name = path.slice(root.length);
  if (
    !path.startsWith(root) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpe?g|gif|webp|pdf|txt|md|csv|json|docx|xlsx|pptx)$/i.test(
      name,
    ) ||
    !(await FileSystem.getInfoAsync(path)).exists
  )
    throw new Error("unavailableAttachment");
  await Sharing.shareAsync(path);
}
