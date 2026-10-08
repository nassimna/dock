import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { dateTimeInput, type Item, type Snapshot } from "@dock/contracts";
import { errorMessage, type Dispatch } from "./state";

export function TaskEditor({
  item,
  snapshot,
  dispatch,
  onClose,
  onDelete,
}: {
  item: Item | null;
  snapshot: Snapshot;
  dispatch: Dispatch;
  onClose: () => void;
  onDelete: (item: Item) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const scheduled = String(form.get("scheduled"));
    setBusy(true);
    try {
      await dispatch({
        type: "item.save",
        item: {
          ...(item ? { id: item.id, expectedRevision: item.revision } : {}),
          kind: "task",
          title: String(form.get("title")),
          body: String(form.get("body")),
          space: String(form.get("space")) as Item["space"],
          priority: form.get("priority") === "on",
          scheduledAt: scheduled ? new Date(scheduled).toISOString() : null,
          recurrence: String(form.get("recurrence")) as Item["recurrence"],
          linkedNoteId: String(form.get("note")) || null,
        },
      });
      onClose();
    } catch (error) {
      setBusy(false);
      setFailure(errorMessage(error));
    }
  }
  return (
    <dialog ref={dialog} className="editor-dialog" onCancel={onClose}>
      <form onSubmit={save}>
        <div className="dialog-heading">
          <h2>{item ? "Edit task" : "New task"}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close task editor"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="dialog-body">
          <label className="field wide">
            Title
            <input
              name="title"
              defaultValue={item?.title ?? ""}
              placeholder="What needs doing?"
              required
              maxLength={500}
              autoFocus
            />
          </label>
          <label className="field wide">
            Notes
            <textarea
              name="body"
              defaultValue={item?.body ?? ""}
              placeholder="A little context, if you need it"
              maxLength={200000}
              rows={3}
            />
          </label>
          <div className="fields">
            <div className="field">
              <label htmlFor="task-space">Space</label>
              <select
                id="task-space"
                name="space"
                defaultValue={item?.space ?? "Inbox"}
              >
                <option>Inbox</option>
                <option>Work</option>
                <option>Personal</option>
              </select>
            </div>
            <label className="field">
              Schedule
              <input
                type="datetime-local"
                name="scheduled"
                defaultValue={dateTimeInput(item?.scheduledAt ?? null)}
              />
            </label>
            <div className="field">
              <label htmlFor="task-recurrence">Repeat</label>
              <select
                id="task-recurrence"
                name="recurrence"
                defaultValue={item?.recurrence ?? "none"}
              >
                <option value="none">Never</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="task-note">Linked note</label>
              <select
                id="task-note"
                name="note"
                defaultValue={item?.linkedNoteId ?? ""}
              >
                <option value="">None</option>
                {snapshot.items
                  .filter((note) => note.kind === "note")
                  .map((note) => (
                    <option key={note.id} value={note.id}>
                      {note.title}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              name="priority"
              defaultChecked={item?.priority}
            />{" "}
            Important
          </label>
          {item && !item.done && (
            <div className="snooze">
              <span>Remind me again in</span>
              {[10, 30, 60].map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  className="secondary"
                  onClick={() =>
                    void dispatch({ type: "item.snooze", id: item.id, minutes })
                      .then(onClose)
                      .catch((error) => setFailure(errorMessage(error)))
                  }
                >
                  {minutes} min
                </button>
              ))}
            </div>
          )}
          {failure && (
            <p className="note-error" role="alert">
              {failure}
            </p>
          )}
        </div>
        <div className="dialog-footer">
          {item ? (
            <button
              type="button"
              className="text-button danger"
              onClick={() => onDelete(item)}
            >
              Delete task
            </button>
          ) : (
            <span />
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save task"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
