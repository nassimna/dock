import { parseTaskText } from "@dock/core/tasks";
import { itemInputSchema, type Item, type ItemInput } from "@dock/contracts";
import { getSnapshot } from "../../../lib/database.ts";
import { execute } from "../../../lib/actions.ts";

export function listItems(): Item[] {
  return getSnapshot().items;
}

export function saveItem(input: ItemInput): Item {
  let data = itemInputSchema.parse(input);
  if (!data.id && data.kind === "task") {
    const parsed = parseTaskText(data.title, getSnapshot().workspace);
    data = itemInputSchema.parse({
      ...data,
      title: parsed.title,
      task: { ...data.task, ...parsed.task },
      scheduledAt: parsed.scheduledAt ?? data.scheduledAt,
      recurrence:
        parsed.recurrence === "none" ? data.recurrence : parsed.recurrence,
      tags: [...(data.tags ?? []), ...parsed.tags],
    });
  }
  const current = listItems();
  if (
    data.id &&
    current.find((item) => item.id === data.id)?.revision !==
      data.expectedRevision
  )
    throw new Error("staleItem");
  const ids = new Set(current.map((item) => item.id));
  const result = execute({ type: "item.save", item: data });
  return result.items.find((item) =>
    data.id ? item.id === data.id : !ids.has(item.id),
  )!;
}

export function setTaskDone(input: {
  id: string;
  revision: number;
  done: boolean;
}): Item {
  const items = listItems();
  const existing = items.find((item) => item.id === input.id);
  if (!existing || existing.revision !== input.revision)
    throw new Error("staleItem");
  if (existing.kind !== "task") throw new Error("notTask");
  if (existing.done === input.done) return existing;
  return execute({
    type: input.done ? "item.complete" : "item.toggle",
    id: input.id,
  }).items.find((item) => item.id === input.id)!;
}
