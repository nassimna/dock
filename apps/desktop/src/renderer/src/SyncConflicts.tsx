import { useState } from "react";
import { GitCompareArrows } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { conflictMergeSchema, type Item, type Snapshot } from "@dock/contracts";
import { errorMessage, type Dispatch } from "./state";
import { ConflictMergeEditor, type MergeDraft } from "./ConflictMergeEditor";

type Conflict = Snapshot["syncConflicts"][number];
type Choice = "original" | "copy" | "both" | "merge";
const choices = { original: "Keep current version", copy: "Use saved copy", both: "Keep both", merge: "Save merged version" };

export function SyncConflicts({ snapshot, dispatch, onClose, onOpenItem, beforeResolve }: {
  snapshot: Snapshot; dispatch: Dispatch; onClose: () => void;
  onOpenItem: (item: Item) => void; beforeResolve: () => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ conflict: Conflict; choice: Choice; merged?: MergeDraft["result"] } | null>(null);
  const [draft, setDraft] = useState<MergeDraft | null>(null);
  const [discard, setDiscard] = useState<"close" | "merge" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const selected = snapshot.syncConflicts.find(conflict => conflict.copy.id === selectedId);
  const draftDirty = !!draft && (draft.result.title !== draft.conflict.original?.title || draft.result.body !== draft.conflict.original?.body || draft.result.metadata !== "current");
  const versionsChanged = !!draft && (!selected || selected.copy.revision !== draft.conflict.copy.revision || selected.original?.revision !== draft.conflict.original?.revision);
  function leaveMerge(destination: "close" | "merge") {
    if (draftDirty) setDiscard(destination);
    else if (destination === "close") onClose();
    else setDraft(null);
  }
  function confirmMerge() {
    if (!draft) return;
    const parsed = conflictMergeSchema.safeParse(draft.result);
    if (!parsed.success) { setError(parsed.error.issues[0]!.message); return; }
    setConfirmation({ conflict: draft.conflict, choice: "merge", merged: parsed.data });
  }
  const date = (value: string | null) => value ? new Date(value).toLocaleString() : "None";
  async function resolve() {
    if (!confirmation) return;
    const { conflict, choice, merged } = confirmation;
    setBusy(true); setError("");
    try {
      await beforeResolve();
      await dispatch({ type: "sync.resolve", copyId: conflict.copy.id, choice, merged,
        expectedRevision: conflict.copy.revision, expectedOriginalRevision: conflict.original?.revision ?? null });
      setSelectedId(null);
      setDraft(null);
      setStatus("Conflict resolved. Your choice is saved and will sync when connected.");
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); setConfirmation(null); }
  }
  function version(item: Item, side: "current" | "saved", deleted = false) {
    return <section className="sync-conflict-version" aria-label={side === "current" ? "Current version" : "Saved conflicting copy"}>
      <strong>{side === "current" ? "Current version" : "Saved conflicting copy"}</strong>
      {deleted && <p className="note-error">Deleted on another device. Using the saved copy restores the original.</p>}
      <h3 dir="auto">{item.title}</h3>
      <small className="muted">Updated {date(item.updatedAt)}</small>
      <div className="sync-version-body" dir="auto">{item.body.replace(/<\/(p|div|li|h[1-6])>|<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, " ").trim() || "No text content."}</div>
      {!!item.tags.length && <p>{item.tags.map(tag => `#${tag}`).join(" ")}</p>}
      {item.kind === "task" && <dl className="sync-version-fields">
        <dt>Priority</dt><dd>P{item.task.priority}</dd>
        <dt>Status</dt><dd>{item.done ? "Completed" : "Not completed"}</dd>
        <dt>Scheduled</dt><dd>{date(item.scheduledAt)}</dd>
        <dt>Deadline</dt><dd>{date(item.task.deadline)}</dd>
        <dt>Project</dt><dd>{snapshot.workspace.projects.find(project => project.id === item.task.projectId)?.name ?? "No project"}</dd>
        <dt>Repeat</dt><dd>{item.recurrence}</dd>
        <dt>Reminders</dt><dd>{item.task.reminders.map(date).join(", ") || "None"}</dd>
        <dt>Assignee</dt><dd>{item.task.assignee || "None"}</dd>
      </dl>}
      {!deleted && <Button type="button" variant="outline" onClick={() => onOpenItem(item)}>Open {side === "current" ? "current version" : "saved copy"}</Button>}
    </section>;
  }
  return <>
    <Dialog open onOpenChange={open => { if (!open && !busy) leaveMerge("close"); }}>
      <DialogContent className={`sync-conflicts-dialog${draft ? " sync-manual-merge" : ""}`}>
        <DialogHeader>
          <DialogTitle><GitCompareArrows size={20} /> {draft ? "Merge manually" : selected ? "Compare versions" : "Sync conflicts"}</DialogTitle>
          <DialogDescription>{draft ? "Current and saved versions stay read-only. Edit the merged result, then save it. Both originals will remain recoverable in Recently deleted." : selected ? "The same item changed before both devices synced. Compare the versions, choose one, or merge their text manually." : "Review competing edits and choose which versions to keep. Decisions sync when Rivnote is connected."}</DialogDescription>
        </DialogHeader>
        <div className="sync-conflicts-content">
          {status && <p role="status">{status}</p>}
          {error && <p className="note-error" role="alert">{error}</p>}
          {draft ? <>
            {versionsChanged && <div className="sync-merge-changed" role="status">
              <p>{selected ? "A version changed. Your merge draft is preserved. Review the updated sources before saving." : "This conflict was resolved elsewhere. Your draft is still available to copy before closing."}</p>
              <Button type="button" variant="outline" disabled={!selected} onClick={() => { if (selected) { setDraft({ ...draft, conflict: selected }); setError(""); } }}>Review updated versions</Button>
            </div>}
            <ConflictMergeEditor draft={draft} snapshot={snapshot} onChange={result => setDraft({ ...draft, result })} onBlockedLink={() => setError("Save or cancel this merge before opening another note.")} />
          </> : selected ? <>
            <div className="sync-conflict-compare">
              {selected.original ? version(selected.original, "current", selected.originalDeleted) : <p className="sync-conflict-version">The original is unavailable or was not recorded by an older app. Keep this copy as a separate item; no original will be changed.</p>}
              {version(selected.copy, "saved")}
            </div>
            <p className="muted">Discarded versions move to Recently deleted. Using the saved copy updates the original item and keeps its links.</p>
          </> : <div className="sync-conflict-list">
            {snapshot.syncConflicts.length === 0 && <p>No conflicts to resolve.</p>}
            {snapshot.syncConflicts.map(conflict => <div className="sync-conflict-row" key={conflict.copy.id}>
              <div><h3 dir="auto">{conflict.original?.title ?? conflict.copy.title}</h3><p className="muted">{conflict.original ? "Two versions need review." : "Older conflict copy. Its original was not recorded."}</p></div>
              <Button type="button" variant="outline" onClick={() => { setSelectedId(conflict.copy.id); setStatus(""); setError(""); }} aria-label={`Review ${conflict.original?.title ?? conflict.copy.title}`}>Compare versions</Button>
            </div>)}
          </div>}
        </div>
        <DialogFooter className="sync-conflict-actions">
          {draft ? <>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => leaveMerge("merge")}>Cancel merge</Button>
            <Button type="button" disabled={busy || versionsChanged} onClick={confirmMerge}>Save merged version</Button>
          </> : selected ? <>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => { setSelectedId(null); setError(""); }}>Back to conflicts</Button>
            <Button type="button" variant="outline" disabled={busy || !selected.original} onClick={() => { if (selected.original) { setDraft({ conflict: selected, result: { title: selected.original.title, body: selected.original.body, metadata: "current" } }); setError(""); } }}>Merge manually</Button>
            {(["original", "copy", "both"] as const).map(choice => <Button key={choice} type="button" variant={choice === "both" ? "default" : "outline"}
              disabled={busy || choice !== "both" && !selected.original}
              onClick={() => setConfirmation({ conflict: selected, choice })}>{choice === "original" && selected.originalDeleted ? "Keep deletion" : choices[choice]}</Button>)}
          </> : <Button type="button" variant="outline" onClick={onClose}>Done</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={confirmation !== null} onOpenChange={open => { if (!open && !busy) setConfirmation(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{confirmation?.choice === "original" && confirmation.conflict.originalDeleted ? "Keep deletion" : confirmation ? choices[confirmation.choice] : "Confirm choice"}</DialogTitle>
          <DialogDescription>{confirmation?.choice === "merge" ? "Save your merged title and text on the original item. Both source versions will be kept in Recently deleted." : confirmation?.choice === "both" ? "Both versions will remain as separate items and this conflict will be marked resolved." : "The discarded version will move to Recently deleted. Using the saved copy preserves the original item's identity and links."}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</Button>
          <Button type="button" disabled={busy} onClick={() => void resolve()}>{busy ? "Saving…" : "Confirm choice"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={discard !== null} onOpenChange={open => { if (!open) setDiscard(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Discard merged draft?</DialogTitle><DialogDescription>Your edits have not been saved. Both source versions will remain unchanged.</DialogDescription></DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setDiscard(null)}>Keep editing</Button>
          <Button type="button" variant="destructive" onClick={() => { const destination = discard; setDiscard(null); setDraft(null); setError(""); if (destination === "close") onClose(); }}>Discard draft</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
