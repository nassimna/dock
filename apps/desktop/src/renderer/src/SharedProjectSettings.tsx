import { useState } from "react";
import { Users } from "lucide-react";
import type { Project, Snapshot } from "@dock/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { errorMessage, type Dispatch } from "./state";

export function SharedProjectSettings({ project, snapshot, dispatch }: { project: Project; snapshot: Snapshot; dispatch: Dispatch }) {
  const shared = snapshot.syncFeatures.projects.find(item => item.id === project.id);
  const owner = !shared || shared.ownerEmail === snapshot.sync.email;
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function share(invite = false) {
    setBusy(true); setError("");
    try {
      await dispatch({ type: "sync.project.share", project });
      if (invite) {
        await dispatch({ type: "sync.project.invite", projectId: project.id, email });
        setEmail("");
      }
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  return <Popover><PopoverTrigger asChild><Button variant="outline" size="xs"><Users size="0.8125rem" />{shared ? "Members" : "Share"}</Button></PopoverTrigger>
    <PopoverContent className="shared-project-settings" align="end">
      <strong>{shared ? "Shared project" : "Share this project"}</strong>
      {!snapshot.sync.connected ? <p>Connect your Dock Sync server in Preferences to share projects.</p> : <>
        <p>Members can view, edit, and assign this project's tasks. Invite an existing account on your Dock Sync server. File attachments stay on their original Mac.</p>
        {shared?.members.map(member => <div className="sync-device" key={member.email}>
          <span>{member.email} · {member.role}</span>
          {owner && member.role !== "owner" && <Button type="button" size="sm" variant="ghost" onClick={() => void dispatch({ type: "sync.project.remove", projectId: project.id, email: member.email }).catch(cause => setError(errorMessage(cause)))}>Remove</Button>}
        </div>)}
        {owner && <form onSubmit={event => { event.preventDefault(); void share(true); }}>
          <Label className="field">Member email<Input type="email" required value={email} onChange={event => setEmail(event.target.value)} /></Label>
          <div className="sync-actions"><Button size="sm" disabled={busy || !email}>Invite member</Button><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void share()}>{shared ? "Update shared project" : "Enable sharing"}</Button></div>
        </form>}
      </>}
      {error && <p role="alert" className="note-error">{error}</p>}
    </PopoverContent>
  </Popover>;
}
