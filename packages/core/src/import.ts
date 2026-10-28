import {
  itemSchema,
  localDate,
  type Item,
  type Workspace,
} from "@dock/contracts";
import { todoistRows } from "./csv.ts";

export function todoistBackup(
  content: string,
  name: string,
  workspace: Workspace,
  uuid: () => string,
) {
  const projectId = uuid();
  const sections: { id: string; name: string }[] = [];
  const items: Item[] = [];
  const parents: string[] = [];
  let sectionId: string | null = null;
  const now = new Date().toISOString();
  for (const row of todoistRows(content)) {
    const type = (row.TYPE ?? "task").toLowerCase();
    if (type === "section") {
      const section = { id: uuid(), name: row.CONTENT?.trim() || "Section" };
      sections.push(section);
      sectionId = section.id;
      parents.length = 0;
      continue;
    }
    if (type !== "task" || !row.CONTENT?.trim()) continue;
    const indent = Math.max(1, Number(row.INDENT || 1));
    if (!Number.isInteger(indent) || indent > parents.length + 1)
      throw new Error("The CSV contains an invalid subtask indentation.");
    const scheduledAt = importDate(row.DATE ?? "");
    const deadline = importDate(row.DEADLINE ?? "");
    const duration =
      Number(row.DURATION || 30) * (row.DURATION_UNIT === "hour" ? 60 : 1);
    const id = uuid();
    items.push(
      itemSchema.parse({
        id,
        kind: "task",
        title: row.CONTENT,
        body: row.DESCRIPTION ?? "",
        space: "Inbox",
        priority: Number(row.PRIORITY || 1) > 1,
        done: false,
        scheduledAt,
        recurrence: "none",
        linkedNoteId: null,
        task: {
          priority: 5 - Number(row.PRIORITY || 1),
          projectId,
          sectionId,
          parentId: indent > 1 ? parents[indent - 2] : null,
          deadline,
          durationMinutes: duration,
        },
        createdAt: now,
        updatedAt: now,
        revision: 1,
      }),
    );
    parents[indent - 1] = id;
    parents.length = indent;
  }
  if (!items.length)
    throw new Error(
      "No tasks were found. Choose a Todoist project CSV export.",
    );
  return {
    items,
    workspace: {
      ...workspace,
      projects: [
        ...workspace.projects,
        {
          id: projectId,
          name: name.slice(0, 80) || "Todoist import",
          parentId: null,
          color: "#9c80e8",
          favorite: false,
          sections,
        },
      ],
    },
  };
}

function importDate(value: string): string | null {
  if (!value.trim()) return null;
  if (!/^\d{4}-\d{2}-\d{2}(?:[ T].*)?$/.test(value.trim()))
    throw new Error(
      `The CSV date “${value}” is unsupported. Export dates as YYYY-MM-DD or ISO timestamps.`,
    );
  const date = new Date(
    value.trim().length === 10 ? `${value.trim()}T23:59:00` : value.trim(),
  );
  if (
    !Number.isFinite(date.getTime()) ||
    (value.trim().length === 10 && localDate(date) !== value.trim())
  )
    throw new Error(`The CSV date “${value}” is invalid.`);
  return date.toISOString();
}
