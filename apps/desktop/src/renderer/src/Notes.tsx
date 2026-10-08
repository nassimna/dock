import { useEffect, useRef, useState } from "react";
import { FileText, Plus, Trash2 } from "lucide-react";
import type { Item, Snapshot } from "@dock/contracts";
import { Empty, TaskRow } from "./components";
import { errorMessage, type Act, type Dispatch } from "./state";

type Draft = {
  title: string;
  body: string;
  space: Item["space"];
  status: "saved" | "saving" | "error";
  error: string;
};

export function Notes({
  snapshot,
  query,
  dispatch,
  act,
  onTask,
  onDelete,
}: {
  snapshot: Snapshot;
  query: string;
  dispatch: Dispatch;
  act: Act;
  onTask: (item: Item) => void;
  onDelete: (item: Item) => void;
}) {
  const notes = snapshot.items.filter((item) => item.kind === "note");
  const visible = notes.filter((note) =>
    `${note.title} ${note.body}`.toLowerCase().includes(query.toLowerCase()),
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const draftRef = useRef<Record<string, Draft>>({});
  const queues = useRef(new Map<string, Promise<unknown>>());
  const pending = useRef(new Map<string, number>());
  const revisions = useRef(new Map<string, number>());
  const note = visible.find((note) => note.id === selected) ?? visible[0];

  function put(id: string, draft: Draft) {
    draftRef.current = { ...draftRef.current, [id]: draft };
    setDrafts(draftRef.current);
  }

  useEffect(() => {
    let changed = false;
    const next = { ...draftRef.current };
    for (const item of notes) {
      const draft = next[item.id];
      if (
        !pending.current.get(item.id) &&
        draft?.status !== "error" &&
        revisions.current.get(item.id) !== item.revision
      ) {
        revisions.current.set(item.id, item.revision);
        next[item.id] = {
          title: item.title,
          body: item.body,
          space: item.space,
          status: "saved",
          error: "",
        };
        changed = true;
      }
    }
    if (changed) {
      draftRef.current = next;
      setDrafts(next);
    }
  }, [snapshot.items]);

  function save(item: Item, draft: Draft) {
    if (!draft.title.trim()) {
      put(item.id, {
        ...draft,
        status: "error",
        error: "Give the note a title to save it.",
      });
      return;
    }
    pending.current.set(item.id, (pending.current.get(item.id) ?? 0) + 1);
    put(item.id, { ...draft, status: "saving", error: "" });
    const queue = (queues.current.get(item.id) ?? Promise.resolve()).then(
      async () => {
        try {
          const result = await dispatch({
            type: "item.save",
            item: {
              id: item.id,
              expectedRevision: revisions.current.get(item.id) ?? item.revision,
              kind: "note",
              title: draft.title,
              body: draft.body,
              space: draft.space,
              priority: item.priority,
              scheduledAt: null,
              recurrence: "none",
              linkedNoteId: null,
            },
          });
          const saved = result.items.find((note) => note.id === item.id)!;
          revisions.current.set(item.id, saved.revision);
          if (
            pending.current.get(item.id) === 1 &&
            draftRef.current[item.id]?.status === "saving"
          )
            put(item.id, {
              ...draftRef.current[item.id]!,
              status: "saved",
              error: "",
            });
        } catch (error) {
          put(item.id, {
            ...draftRef.current[item.id]!,
            status: "error",
            error: errorMessage(error),
          });
        } finally {
          pending.current.set(item.id, (pending.current.get(item.id) ?? 1) - 1);
        }
      },
    );
    queues.current.set(item.id, queue);
  }

  async function create() {
    const existing = new Set(notes.map((note) => note.id));
    try {
      const result = await dispatch({
        type: "item.save",
        item: {
          kind: "note",
          title: "Untitled note",
          body: "",
          space: "Inbox",
          priority: false,
          scheduledAt: null,
          recurrence: "none",
          linkedNoteId: null,
        },
      });
      setSelected(
        result.items.find(
          (item) => item.kind === "note" && !existing.has(item.id),
        )!.id,
      );
    } catch {
      /* The shared banner reports the failure. */
    }
  }

  const draft = note
    ? (drafts[note.id] ?? {
        title: note.title,
        body: note.body,
        space: note.space,
        status: "saved" as const,
        error: "",
      })
    : null;
  function edit(update: Partial<Draft>) {
    if (note && draft) save(note, { ...draft, ...update });
  }

  return (
    <>
      <div className="notes-heading">
        <p className="muted">A place for the details you’ll need later.</p>
        <button className="secondary" onClick={() => void create()}>
          <Plus size={15} /> New note
        </button>
      </div>
      {!visible.length ? (
        <Empty title={query ? "No matching notes" : "Keep a thought here"}>
          {query
            ? "Try another search."
            : "Create a note or capture one from anywhere."}
        </Empty>
      ) : (
        <div className="notes-layout">
          <div className="note-list">
            {visible.map((item) => (
              <button
                key={item.id}
                className={`note-choice ${item.id === note?.id ? "active" : ""}`}
                onClick={() => setSelected(item.id)}
              >
                <FileText size={14} />
                <span>
                  {drafts[item.id]?.title || item.title}
                  <small>{drafts[item.id]?.space ?? item.space}</small>
                </span>
              </button>
            ))}
          </div>
          {note && draft && (
            <div className="note-editor">
              <input
                className="note-title"
                aria-label="Note title"
                value={draft.title}
                maxLength={500}
                onChange={(event) => edit({ title: event.target.value })}
              />
              <div className="editor-toolbar">
                <select
                  aria-label="Note space"
                  value={draft.space}
                  onChange={(event) =>
                    edit({ space: event.target.value as Item["space"] })
                  }
                >
                  <option>Inbox</option>
                  <option>Work</option>
                  <option>Personal</option>
                </select>
                <span role="status">
                  {draft.status === "saving"
                    ? "Saving…"
                    : draft.status === "error"
                      ? "Not saved"
                      : "Saved locally"}
                </span>
              </div>
              <textarea
                className="note-body"
                aria-label="Note body"
                value={draft.body}
                placeholder="Start writing…"
                maxLength={200000}
                onChange={(event) => edit({ body: event.target.value })}
              />
              {draft.status === "error" && (
                <div className="note-error" role="alert">
                  <p>{draft.error}</p>
                  <div>
                    <button
                      className="secondary"
                      onClick={() => save(note, draft)}
                    >
                      Retry save
                    </button>
                    <button
                      className="secondary"
                      onClick={() => {
                        revisions.current.set(note.id, note.revision);
                        put(note.id, {
                          title: note.title,
                          body: note.body,
                          space: note.space,
                          status: "saved",
                          error: "",
                        });
                      }}
                    >
                      Use saved version
                    </button>
                  </div>
                  <small>Your draft stays here until you replace it.</small>
                </div>
              )}
              <div className="editor-footer">
                <span>
                  {draft.body.trim().split(/\s+/).filter(Boolean).length} words
                </span>
                <button
                  className="text-button danger"
                  onClick={() => onDelete(note)}
                >
                  <Trash2 size={14} /> Delete note
                </button>
              </div>
              <div className="linked-tasks">
                <div className="group-label">Linked tasks</div>
                {snapshot.items
                  .filter(
                    (item) =>
                      item.kind === "task" && item.linkedNoteId === note.id,
                  )
                  .map((item) => (
                    <TaskRow
                      key={item.id}
                      item={item}
                      snapshot={snapshot}
                      act={act}
                      onOpen={onTask}
                    />
                  ))}
                <p className="muted">
                  Link a task to this note from the task editor.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
