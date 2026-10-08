import { useEffect, useRef, useState } from "react";
import { CalendarDays, FileText, ListTodo, Plus, Star } from "lucide-react";
import type { Item, Snapshot } from "@dock/contracts";
import { Shortcut } from "./components";
import type { Act, Dispatch } from "./state";

export function Capture({
  snapshot,
  dispatch,
  act,
}: {
  snapshot: Snapshot;
  dispatch: Dispatch;
  act: Act;
}) {
  const [kind, setKind] = useState<Item["kind"]>("task");
  const [text, setText] = useState("");
  const [space, setSpace] = useState<Item["space"]>("Inbox");
  const [priority, setPriority] = useState(false);
  const [scheduled, setScheduled] = useState("");
  const [showSchedule, setShowSchedule] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => window.dock.onCapture(() => input.current?.focus()), []);
  useEffect(() => {
    input.current?.focus();
  }, []);
  async function save() {
    if (!text.trim() || busy) return;
    const [first, ...rest] = text.trim().split("\n");
    setBusy(true);
    try {
      await dispatch({
        type: "item.save",
        item: {
          kind,
          title: first!,
          body: rest.join("\n"),
          space,
          priority,
          scheduledAt:
            kind === "task" && scheduled
              ? new Date(scheduled).toISOString()
              : null,
          recurrence: "none",
          linkedNoteId: null,
        },
      });
      setText("");
      setPriority(false);
      setScheduled("");
      setShowSchedule(false);
      await dispatch({ type: "window", action: "hide" });
    } catch {
      /* The shared error banner keeps the draft available. */
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="capture"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="capture-modes">
        <button
          type="button"
          aria-pressed={kind === "task"}
          onClick={() => {
            setKind("task");
            input.current?.focus();
          }}
        >
          <ListTodo size={15} /> Task
        </button>
        <button
          type="button"
          aria-pressed={kind === "note"}
          onClick={() => {
            setKind("note");
            input.current?.focus();
          }}
        >
          <FileText size={15} /> Note
        </button>
      </div>
      <textarea
        ref={input}
        className="capture-text"
        aria-label="Capture text"
        placeholder={
          kind === "task" ? "What’s on your mind?" : "A thought worth keeping…"
        }
        value={text}
        maxLength={200000}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void save();
          }
        }}
      />
      <div className="capture-options">
        {kind === "task" && (
          <>
            <button
              type="button"
              className={priority ? "active" : ""}
              aria-pressed={priority}
              onClick={() => setPriority(!priority)}
            >
              <Star size={15} /> Important
            </button>
            <button
              type="button"
              className={showSchedule ? "active" : ""}
              aria-expanded={showSchedule}
              onClick={() => setShowSchedule(!showSchedule)}
            >
              <CalendarDays size={15} /> Schedule
            </button>
          </>
        )}
        <select
          aria-label="Capture space"
          value={space}
          onChange={(event) => setSpace(event.target.value as Item["space"])}
        >
          <option>Inbox</option>
          <option>Work</option>
          <option>Personal</option>
        </select>
      </div>
      {showSchedule && kind === "task" && (
        <label className="field schedule-field">
          Remind me at
          <input
            type="datetime-local"
            value={scheduled}
            onChange={(event) => setScheduled(event.target.value)}
          />
        </label>
      )}
      <div className="capture-footer">
        <span>
          <kbd>Enter</kbd> saves · <kbd>Shift + Enter</kbd> adds a line
          <br />
          <Shortcut value={snapshot.settings.shortcut} /> opens from anywhere
        </span>
        <button className="primary" disabled={!text.trim() || busy}>
          <Plus size={15} /> {busy ? "Saving…" : "Capture"}
        </button>
      </div>
      <button
        type="button"
        className="text-button capture-main"
        onClick={() => act({ type: "window", action: "main" })}
      >
        Open Dock
      </button>
    </form>
  );
}
