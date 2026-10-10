import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { useRef, useState } from "react";
import { dateTimeInput, type Item, type Snapshot } from "@dock/contracts";
import { errorMessage, type Dispatch } from "./state";

export function TaskEditor({
  item,
  defaults,
  snapshot,
  dispatch,
  onClose,
  onDelete,
}: {
  item: Item | null;
  defaults: Pick<Item, "space" | "scheduledAt" | "priority">;
  snapshot: Snapshot;
  dispatch: Dispatch;
  onClose: () => void;
  onDelete: (item: Item) => void;
}) {
  const title = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [scheduled, setScheduled] = useState(dateTimeInput(item ? item.scheduledAt : defaults.scheduledAt));
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
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
          linkedNoteId: form.get("note") === "none" ? null : String(form.get("note")),
        },
      });
      onClose();
    } catch (error) {
      setBusy(false);
      setFailure(errorMessage(error));
    }
  }
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="editor-dialog" aria-describedby={undefined}
        onOpenAutoFocus={event => { event.preventDefault(); title.current?.focus(); }}>
      <form onSubmit={save}>
        <div className="dialog-heading">
          <DialogTitle>{item ? "Edit task" : "New task"}</DialogTitle>

        </div>
        <div className="dialog-body">
          <Label className="field wide">
            Title
            <Input
              ref={title}
              name="title"
              defaultValue={item?.title ?? ""}
              placeholder="What needs doing?"
              required
              maxLength={500}
            />
          </Label>
          <Label className="field wide">
            Notes
            <Textarea
              name="body"
              defaultValue={item?.body ?? ""}
              placeholder="A little context, if you need it"
              maxLength={200000}
              rows={3}
            />
          </Label>
          <div className="fields">
            <div className="field">
              <Label htmlFor="task-space">Space</Label>
              <Select name="space" defaultValue={item?.space ?? defaults.space}>
                <SelectTrigger id="task-space"><SelectValue /></SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="Inbox">Inbox</SelectItem>
                  <SelectItem value="Work">Work</SelectItem>
                  <SelectItem value="Personal">Personal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Label className="field">
              Schedule
              <DateTimePicker label="Schedule" value={scheduled} onChange={setScheduled} />
            </Label>
            <div className="field">
              <Label htmlFor="task-recurrence">Repeat</Label>
              <Select name="recurrence" defaultValue={item?.recurrence ?? "none"}>
                <SelectTrigger id="task-recurrence"><SelectValue /></SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="none">Never</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="field">
              <Label htmlFor="task-note">Linked note</Label>
              <Select name="note" defaultValue={item?.linkedNoteId ?? "none"}>
                <SelectTrigger id="task-note"><SelectValue /></SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="none">None</SelectItem>
                  {snapshot.items.filter(note => note.kind === "note").map(note =>
                    <SelectItem key={note.id} value={note.id}>{note.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Label className="checkbox-label">
            <Checkbox
              name="priority"
              defaultChecked={item?.priority ?? defaults.priority}
            />{" "}
            Important
          </Label>
          {item && !item.done && (
            <div className="snooze">
              <span>Remind me again in</span>
              {[10, 30, 60].map((minutes) => (
                <Button variant="outline"
                  key={minutes}
                  type="button"

                  onClick={() =>
                    void dispatch({ type: "item.snooze", id: item.id, minutes })
                      .then(onClose)
                      .catch((error) => setFailure(errorMessage(error)))
                  }
                >
                  {minutes} min
                </Button>
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
            <Button variant="ghost"
              type="button"
              className="danger"
              onClick={() => onDelete(item)}
            >
              Delete task
            </Button>
          ) : (
            <span />
          )}
          <Button variant="default" disabled={busy}>
            {busy ? "Saving…" : "Save task"}
          </Button>
        </div>
      </form>
      </DialogContent>
    </Dialog>
  );
}
