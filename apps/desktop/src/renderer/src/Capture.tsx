import { Button } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useEffect, useRef, useState } from "react";
import { CalendarDays, FileText, ListTodo, Plus, SlidersHorizontal, Star } from "lucide-react";
import type { Item } from "@dock/contracts";
import type { Act, Dispatch } from "./state";

export function Capture({
  dispatch,
  act,
}: {
  dispatch: Dispatch;
  act: Act;
}) {
  const [kind, setKind] = useState<Item["kind"]>("task");
  const [text, setText] = useState("");
  const [space, setSpace] = useState<Item["space"]>("Inbox");
  const [priority, setPriority] = useState(false);
  const [scheduled, setScheduled] = useState("");
  const [showSchedule, setShowSchedule] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => window.dock.onBeforeUpdate(async () => {
    if (text.trim()) throw new Error("Save or clear your quick capture draft before restarting Dock.");
  }), [text]);
  useEffect(() => window.dock.onCapture(() => input.current?.focus()), []);
  useEffect(() => {
    input.current?.focus();
    const shell = input.current!.closest(".app-shell")!;
    const resize = new ResizeObserver(() => {
      const height = Math.min(600, Math.max(180, Math.ceil(shell.getBoundingClientRect().height)));
      void window.dock.dispatch({ type: "capture.resize", height }).catch(console.error);
    });
    resize.observe(shell);
    return () => resize.disconnect();
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
      setShowOptions(false);
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
        <Button size="xs" variant="ghost"
          type="button"
          aria-pressed={kind === "task"}
          onClick={() => {
            setKind("task");
            input.current?.focus();
          }}
        >
          <ListTodo size="0.9375rem" /> Task
        </Button>
        <Button size="xs" variant="ghost"
          type="button"
          aria-pressed={kind === "note"}
          onClick={() => {
            setKind("note");
            input.current?.focus();
          }}
        >
          <FileText size="0.9375rem" /> Note
        </Button>
      </div>
      <Textarea
        ref={input}
        className="capture-text"
        rows={3}
        aria-label="Capture text"
        placeholder={
          kind === "task" ? "Add a task…" : "Write a note…"
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
      {showOptions && (
        <div id="capture-details" className="capture-details">
          <div className="capture-options">
            {kind === "task" && (
              <>
                <Button size="xs" variant="ghost"
                  type="button"
                  className={priority ? "active" : ""}
                  aria-pressed={priority}
                  onClick={() => setPriority(!priority)}
                >
                  <Star size="0.9375rem" /> Important
                </Button>
                <Button size="xs" variant="ghost"
                  type="button"
                  className={showSchedule ? "active" : ""}
                  aria-expanded={showSchedule}
                  onClick={() => setShowSchedule(!showSchedule)}
                >
                  <CalendarDays size="0.9375rem" /> Schedule
                </Button>
              </>
            )}
            <Select value={space} onValueChange={value => setSpace(value as Item["space"])}>
              <SelectTrigger aria-label="Capture space" size="xs"><SelectValue /></SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="Inbox">Inbox</SelectItem>
                <SelectItem value="Work">Work</SelectItem>
                <SelectItem value="Personal">Personal</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {showSchedule && kind === "task" && (
            <Label className="field schedule-field">
              Remind me at
              <DateTimePicker label="Capture schedule" value={scheduled} onChange={setScheduled} />
            </Label>
          )}
          <Button size="xs" variant="ghost" type="button" className="capture-main"
            onClick={() => act({ type: "window", action: "main" })}>Open Dock</Button>
        </div>
      )}
      <div className="capture-footer">
        <Button size="sm" variant="ghost" type="button" className={showOptions || priority || scheduled || space !== "Inbox" ? "active" : ""}
          aria-expanded={showOptions} aria-controls="capture-details" onClick={() => setShowOptions(!showOptions)}>
          <SlidersHorizontal size="0.875rem" /> Options{space !== "Inbox" && <span>· {space}</span>}
        </Button>
        <Button size="sm" variant="default" disabled={!text.trim() || busy}>
          <Plus size="0.9375rem" /> {busy ? "Saving…" : "Capture"}
        </Button>
      </div>
    </form>
  );
}
