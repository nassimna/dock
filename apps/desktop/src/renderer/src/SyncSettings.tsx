import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { Cloud } from "lucide-react";
import type { SyncStatus } from "@dock/contracts";
import { errorMessage, type Dispatch } from "./state";

export function SyncSettings({ sync, dispatch }: { sync: SyncStatus; dispatch: Dispatch }) {
  const [endpoint, setEndpoint] = useState(sync.endpoint);
  const [email, setEmail] = useState(sync.email);
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [signup, setSignup] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function signIn() {
    setBusy(true);
    setError("");
    try {
      await dispatch(signup
        ? { type: "sync.signup", endpoint, email, password, inviteCode }
        : { type: "sync.login", endpoint, email, password });
      setPassword("");
      setInviteCode("");
      setSigningIn(false);
      setSignup(false);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally { setBusy(false); }
  }
  async function disconnect() {
    setBusy(true);
    try { await dispatch({ type: "sync.disconnect" }); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  return (
    <section>
      <h2><Cloud size="1.0625rem" /> Sync across devices</h2>
      <p>
        Sign in on each device to sync tasks and notes. Everything saves locally
        first, even offline. Window preferences stay on this device.
      </p>
      {sync.connected && (
        <div className="sync-account">
          <strong>{sync.email}</strong>
          <span className="muted">{sync.endpoint}</span>
          <p role="status">
            {sync.phase === "syncing" ? "Syncing…" : sync.phase === "synced" ? "Synced" :
              sync.phase === "offline" ? "Offline · Changes saved locally" :
              sync.phase === "error" ? "Sync needs attention" : "Changes waiting to sync"}
            {sync.pending > 0 && ` · ${sync.pending} pending`}
          </p>
          {sync.lastSyncedAt && <small className="muted">Last sync: {new Date(sync.lastSyncedAt).toLocaleString()}</small>}
          <div className="sync-actions">
            <Button variant="outline" type="button"  disabled={busy || sync.phase === "syncing"} onClick={() => void dispatch({ type: "sync.now" }).catch(() => {})}>Sync now</Button>
            <Button variant="outline" type="button"  disabled={busy} onClick={() => setSigningIn(!signingIn)}>Sign in again</Button>
            <Button variant="outline" type="button"  disabled={busy} onClick={() => void disconnect()}>{busy ? "Working…" : "Disconnect"}</Button>
          </div>
          <small className="muted">Disconnect keeps your local data. An offline disconnect cannot revoke the server session until it expires.</small>
        </div>
      )}
      {(!sync.connected || signingIn) && (
        <form className="sync-form" onSubmit={event => { event.preventDefault(); void signIn(); }}>
          <Label className="field">Sync server
            <Input type="url" value={endpoint} placeholder="https://dock-sync.your-account.workers.dev" onChange={event => setEndpoint(event.target.value)} disabled={busy || Boolean(sync.endpoint)} autoComplete="url" />
          </Label>
          <Label className="field">Email
            <Input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="username" disabled={busy} />
          </Label>
          <Label className="field">Password
            <Input type="password" value={password} minLength={12} maxLength={128} onChange={event => setPassword(event.target.value)} autoComplete={signup ? "new-password" : "current-password"} disabled={busy} />
          </Label>
          {signup && <Label className="field">Invite code
            <Input type="password" value={inviteCode} onChange={event => setInviteCode(event.target.value)} autoComplete="off" disabled={busy} />
          </Label>}
          <div className="sync-actions">
            <Button variant="default" type="submit"  disabled={busy || !endpoint || !email || password.length < 12 || (signup && !inviteCode)}>{busy ? "Connecting…" : signup ? "Create account & sync" : "Sign in & sync"}</Button>
            <Button variant="ghost" type="button"  disabled={busy} onClick={() => { setSignup(!signup); setError(""); }}>{signup ? "Already have an account? Sign in" : "Create an account"}</Button>
          </div>
          <small className="muted">Connecting uploads this workspace’s tasks and notes to your account. Registration needs an invite from the server owner. Password reset requires the server owner; no verification emails are sent.</small>
        </form>
      )}
      {(error || sync.error) && <p className="note-error" role="alert">{error || sync.error}</p>}
      {sync.conflicts > 0 && <p className="sync-conflicts" role="status">Conflicting edits were kept as {sync.conflicts} separate {sync.conflicts === 1 ? "copy" : "copies"}. Review “conflict copy” items in Notes or All tasks; delete them when resolved.</p>}
    </section>
  );
}
