import { lazy, Suspense } from "react";
import type { Command, Item, Snapshot } from "@dock/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NoteEditor = lazy(() =>
  import("./NoteEditor").then((module) => ({ default: module.NoteEditor })),
);
export type MergeDraft = {
  conflict: Snapshot["syncConflicts"][number];
  result: NonNullable<Extract<Command, { type: "sync.resolve" }>["merged"]>;
};

export function ConflictMergeEditor({
  draft,
  snapshot,
  onChange,
  onBlockedLink,
}: {
  draft: MergeDraft;
  snapshot: Snapshot;
  onChange: (result: MergeDraft["result"]) => void;
  onBlockedLink: () => void;
}) {
  const notes = snapshot.items.filter((item) => item.kind === "note");
  const { original, copy } = draft.conflict;
  function source(item: Item, side: "current" | "saved") {
    return (
      <section
        className="sync-merge-pane"
        aria-label={side === "current" ? "Current source" : "Saved source"}
      >
        <h3>
          {side === "current" ? "Current version" : "Saved conflicting copy"}
        </h3>
        <strong dir="auto">{item.title}</strong>
        <small className="muted">
          Read-only · {new Date(item.updatedAt).toLocaleString()}
        </small>
        <div className="sync-merge-source-actions">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onChange({ ...draft.result, body: item.body })}
          >
            Use {side} text
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() =>
              onChange({
                ...draft.result,
                body: [draft.result.body, item.body]
                  .filter(Boolean)
                  .join("\n\n"),
              })
            }
          >
            Append {side} text
          </Button>
        </div>
        {item.kind === "note" ? (
          <Suspense fallback={<p role="status">Opening note…</p>}>
            <NoteEditor
              value={item.body}
              readOnly
              label={`${side === "current" ? "Current" : "Saved"} note text`}
              onChange={() => {}}
              notes={notes}
              onOpenNote={onBlockedLink}
            >
              {null}
            </NoteEditor>
          </Suspense>
        ) : (
          <Textarea
            readOnly
            aria-label={`${side === "current" ? "Current" : "Saved"} task text`}
            value={item.body}
          />
        )}
        <details>
          <summary>Other details</summary>
          <dl className="sync-version-fields">
            {item.kind === "task" && (
              <>
                <dt>Priority</dt>
                <dd>P{item.task.priority}</dd>
                <dt>Status</dt>
                <dd>{item.done ? "Completed" : "Not completed"}</dd>
                <dt>Scheduled</dt>
                <dd>
                  {item.scheduledAt
                    ? new Date(item.scheduledAt).toLocaleString()
                    : "None"}
                </dd>
                <dt>Reminders</dt>
                <dd>
                  {item.task.reminders
                    .map((date) => new Date(date).toLocaleString())
                    .join(", ") || "None"}
                </dd>
                <dt>Assignee</dt>
                <dd>{item.task.assignee || "None"}</dd>
              </>
            )}
            <dt>Tags</dt>
            <dd>{item.tags.join(", ") || "None"}</dd>
          </dl>
        </details>
      </section>
    );
  }
  return (
    <div className="sync-merge-columns">
      {original && source(original, "current")}
      {source(copy, "saved")}
      <section
        className="sync-merge-pane sync-merge-result"
        aria-label="Merged result"
      >
        <h3>Merged result</h3>
        <Label className="field">
          Merged title
          <Input
            value={draft.result.title}
            maxLength={500}
            onChange={(event) =>
              onChange({ ...draft.result, title: event.target.value })
            }
          />
        </Label>
        <p className="muted">
          Edit the result below. You can use text from either side, append both,
          or write your own.
        </p>
        {copy.kind === "note" ? (
          <Suspense fallback={<p role="status">Opening editor…</p>}>
            <NoteEditor
              value={draft.result.body}
              label="Merged note body"
              onChange={(body) => onChange({ ...draft.result, body })}
              notes={notes}
              onOpenNote={onBlockedLink}
            >
              {null}
            </NoteEditor>
          </Suspense>
        ) : (
          <Label className="field">
            Merged task text
            <Textarea
              value={draft.result.body}
              maxLength={200000}
              onChange={(event) =>
                onChange({ ...draft.result, body: event.target.value })
              }
            />
          </Label>
        )}
        <Label htmlFor="merge-metadata">Other details from</Label>
        <Select
          value={draft.result.metadata}
          onValueChange={(metadata) =>
            onChange({
              ...draft.result,
              metadata: metadata as "current" | "saved",
            })
          }
        >
          <SelectTrigger id="merge-metadata">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="current">Current version</SelectItem>
            <SelectItem value="saved">Saved copy</SelectItem>
          </SelectContent>
        </Select>
        <small className="muted">
          Title and text are merged here. All other details, including tags,
          formatting preferences and task reminders, come from the selected
          version.
        </small>
      </section>
    </div>
  );
}
