import {
  localDate,
  type Item,
  type TaskProperties,
  type Workspace,
} from "@dock/contracts";

/** `ignore` lists recognized phrases (lowercase) that should stay in the title as plain text. */
export function parseTaskText(
  text: string,
  workspace: Workspace,
  now = new Date(),
  ignore: string[] = [],
) {
  let title = text.trim();
  let scheduledAt: string | undefined;
  let recurrence: Item["recurrence"] = "none";
  const task: Partial<TaskProperties> = {};
  const tags: string[] = [];
  const recognized: string[] = [];
  function take(pattern: RegExp, apply: (match: RegExpMatchArray) => void) {
    const match = title.match(pattern);
    if (!match || ignore.includes(match[0].trim().toLowerCase())) return;
    apply(match);
    recognized.push(match[0].trim());
    title =
      title.slice(0, match.index) +
      " " +
      title.slice(match.index! + match[0].length);
  }
  if (title.includes("#")) {
    for (const project of [...workspace.projects].sort(
      (a, b) => b.name.length - a.name.length,
    )) {
      const escaped = project.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (!task.projectId)
        take(
          new RegExp(`(?:^|\\s)#(?:"${escaped}"|${escaped})(?=\\s|$)`, "i"),
          () => {
            task.projectId = project.id;
          },
        );
    }
  }
  take(/(?:^|\s)p([1-4])(?=\s|$)/i, (match) => {
    task.priority = Number(match[1]) as TaskProperties["priority"];
  });
  title = title.replace(
    /(?:^|\s)@([\p{L}\p{N}_-]{1,40})(?=\s|$)/gu,
    (match, label: string) => {
      if (ignore.includes(match.trim().toLowerCase())) return match;
      tags.push(label);
      recognized.push(match.trim());
      return " ";
    },
  );
  take(/(?:^|\s)for\s+(\d+)\s*(m|min|minutes|h|hours)(?=\s|$)/i, (match) => {
    const duration = Number(match[1]) * (/^h/i.test(match[2]!) ? 60 : 1);
    if (duration < 1 || duration > 1440)
      throw new Error("Duration must be between 1 minute and 24 hours.");
    task.durationMinutes = duration;
  });
  take(
    /(?:^|\s)every\s+(?:(\d+)\s+)?(weekday|day|week|month)s?(\s+after completion)?(?=\s|$)/i,
    (match) => {
      const unit = match[2]!.toLowerCase();
      const interval = Number(match[1] ?? 1);
      if (interval < 1 || interval > 365)
        throw new Error("Repeat interval must be between 1 and 365.");
      if (unit === "weekday" && (interval !== 1 || match[3]))
        throw new Error(
          "Use every weekday, or choose a custom day interval after completion.",
        );
      recurrence = unit === "weekday" ? "weekdays" : "custom";
      task.repeat = {
        interval,
        unit: unit === "weekday" ? "day" : (unit as "day" | "week" | "month"),
        afterCompletion: !!match[3],
      };
    },
  );
  let date: Date | undefined;
  take(
    /(?:^|\s)(today|tomorrow|next\s+(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)|\d{4}-\d{2}-\d{2})(?=\s|$)/i,
    (match) => {
      const value = match[1]!.toLowerCase();
      date = new Date(now);
      date.setHours(23, 59, 0, 0);
      if (value === "tomorrow") date.setDate(date.getDate() + 1);
      else if (value.startsWith("next ")) {
        const day = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(
          value.slice(5, 8),
        );
        date.setDate(date.getDate() + ((day - date.getDay() + 7) % 7 || 7));
      } else if (value !== "today") {
        date = new Date(`${value}T23:59:00`);
        if (Number.isNaN(date.getTime()) || localDate(date) !== value)
          throw new Error("Use a valid date in YYYY-MM-DD format.");
      }
    },
  );
  take(
    /(?:^|\s)(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?=\s|$)|(?:^|\s)(?:at\s+)?(\d{1,2}):(\d{2})(?=\s|$)/i,
    (match) => {
      let hour = Number(match[1] ?? match[4]);
      const minute = Number(match[2] ?? match[5] ?? 0);
      if (minute > 59 || (match[3] ? hour < 1 || hour > 12 : hour > 23))
        throw new Error("Use a valid time, such as 9am or 14:30.");
      if (match[3])
        hour = (hour % 12) + (match[3].toLowerCase() === "pm" ? 12 : 0);
      date ??= new Date(now);
      date.setHours(hour, minute, 0, 0);
    },
  );
  if (date) scheduledAt = date.toISOString();
  if (recurrence !== "none" && !scheduledAt) {
    date = new Date(now);
    date.setHours(23, 59, 0, 0);
    scheduledAt = date.toISOString();
  }
  return {
    title: title.replace(/\s+/g, " ").trim(),
    scheduledAt,
    task,
    tags,
    recurrence,
    recognized,
  };
}

export function compileFilter(
  query: string,
  workspace: Workspace,
  now = new Date(),
): (item: Item) => boolean {
  const tokens =
    query.match(/\(|\)|&|\||!|#["](?:[^"\\]|\\.)*"|"[^"]*"|[^\s()&|!]+/g) ?? [];
  if (!tokens.length) return (item) => !item.done;
  let index = 0;
  const today = localDate(now);
  function atom(): (item: Item) => boolean {
    const token = tokens[index++];
    if (!token) throw new Error("Add a rule after the operator.");
    if (token === "!") {
      const predicate = atom();
      return (item) => !predicate(item);
    }
    if (token === "(") {
      const predicate = or();
      if (tokens[index++] !== ")") throw new Error("Close the parenthesis.");
      return predicate;
    }
    if ([")", "&", "|"].includes(token))
      throw new Error(`Unexpected “${token}”.`);
    const rule = token.toLowerCase();
    const day = (item: Item) =>
      item.scheduledAt ? localDate(new Date(item.scheduledAt)) : "";
    if (rule === "today") return (item) => day(item) === today;
    if (rule === "overdue")
      return (item) => !!day(item) && day(item) < today && !item.done;
    if (rule === "done") return (item) => item.done;
    if (rule === "no-date") return (item) => !item.scheduledAt;
    if (/^p[1-4]$/.test(rule))
      return (item) => item.task.priority === Number(rule[1]);
    if (rule.startsWith("#")) {
      const name = token.slice(1).replace(/^"|"$/g, "").toLowerCase();
      const project = workspace.projects.find(
        (project) => project.name.toLowerCase() === name,
      );
      if (!project && name !== "inbox")
        throw new Error(`Unknown project: ${name}.`);
      return (item) => item.task.projectId === (project?.id ?? null);
    }
    if (rule.startsWith("@"))
      return (item) =>
        item.tags.some((tag) => tag.toLowerCase() === rule.slice(1));
    if (rule.startsWith("assigned:"))
      return (item) => item.task.assignee.toLowerCase() === rule.slice(9);
    if (rule.startsWith("due:")) {
      const value = rule.slice(4);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        Number.isNaN(new Date(`${value}T12:00:00`).getTime()) ||
        localDate(new Date(`${value}T12:00:00`)) !== value
      )
        throw new Error("Use due:YYYY-MM-DD.");
      return (item) => day(item) === value;
    }
    const value = rule.replace(/^"|"$/g, "");
    return (item) => `${item.title} ${item.body}`.toLowerCase().includes(value);
  }
  function and(): (item: Item) => boolean {
    let left = atom();
    while (tokens[index] === "&") {
      index++;
      const right = atom();
      const prior = left;
      left = (item) => prior(item) && right(item);
    }
    return left;
  }
  function or(): (item: Item) => boolean {
    let left = and();
    while (tokens[index] === "|") {
      index++;
      const right = and();
      const prior = left;
      left = (item) => prior(item) || right(item);
    }
    return left;
  }
  const result = or();
  if (index !== tokens.length)
    throw new Error("Join rules with & (and) or | (or).");
  const includesDone = tokens.some((token) => token.toLowerCase() === "done");
  return (item) => (!item.done || includesDone) && result(item);
}

export function taskComparator(
  today = localDate(),
): (a: Item, b: Item) => number {
  const dates = new Map<string, number>();
  const due = (item: Item) => {
    if (!item.scheduledAt) return 1;
    let value = dates.get(item.scheduledAt);
    if (value === undefined) {
      value = localDate(new Date(item.scheduledAt)) <= today ? 0 : 1;
      dates.set(item.scheduledAt, value);
    }
    return value;
  };
  return (a, b) =>
    due(a) - due(b) ||
    a.task.priority - b.task.priority ||
    (a.scheduledAt ?? "z").localeCompare(b.scheduledAt ?? "z") ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.id.localeCompare(b.id);
}

export function recurrenceLabel(item: Item): string {
  const { interval, unit, afterCompletion } = item.task.repeat;
  const label =
    item.recurrence === "custom"
      ? `Every ${interval === 1 ? unit : `${interval} ${unit}s`}`
      : (
          {
            none: "",
            daily: "Every day",
            weekly: "Every week",
            monthly: "Every month",
            weekdays: "Every weekday",
          } as const
        )[item.recurrence];
  return afterCompletion && item.recurrence === "custom"
    ? `${label} after completion`
    : label;
}

export function compileSearch(
  query: string,
  workspace: Workspace,
): (item: Item) => boolean {
  const value = query.trim().toLowerCase();
  const projects = new Map(
    workspace.projects.map((project) => [project.id, project.name]),
  );
  return (item) =>
    [
      item.title,
      item.body,
      projects.get(item.task.projectId ?? "") ?? "",
      ...item.tags.map((tag) => `@${tag}`),
      ...item.task.comments.map((comment) => comment.body),
    ]
      .join(" ")
      .toLowerCase()
      .includes(value);
}
