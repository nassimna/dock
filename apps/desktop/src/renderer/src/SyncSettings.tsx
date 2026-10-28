import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { Cloud } from "lucide-react";
import type { SyncFeatures } from "../../../../../packages/contracts/src/sync-features";
import type { Command, SyncStatus } from "@dock/contracts";
import { errorMessage, type Dispatch } from "./state";

export function SyncSettings({ sync, features, dispatch, onReviewConflicts }: { sync: SyncStatus; features: SyncFeatures; dispatch: Dispatch; onReviewConflicts: () => void }) {
  const [endpoint, setEndpoint] = useState(sync.endpoint);
  const [email, setEmail] = useState(sync.email);
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [signup, setSignup] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function signIn() {
    setBusy(true);
    setError("");
    try {
      await dispatch(recovering
        ? { type: "sync.recover", endpoint, email, password, recoveryCode }
        : signup
        ? { type: "sync.signup", endpoint, email, password, inviteCode }
        : { type: "sync.login", endpoint, email, password });
      setPassword("");
      setInviteCode("");
      setSigningIn(false);
      setSignup(false);
      setRecovering(false);
      setRecoveryCode("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally { setBusy(false); }
  }
  async function accountAction(command: Command) {
    setBusy(true); setError("");
    try { await dispatch(command); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
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
          <div className="sync-actions">
            <Button variant="outline" type="button" disabled={busy} onClick={() => void accountAction({ type: "sync.recovery.create" })}>Generate recovery code</Button>
            <Button variant="outline" type="button" disabled={busy} onClick={() => void accountAction({ type: "sync.devices" })}>Refresh signed-in devices</Button>
          </div>
          {features.devices.map(device => <div className="sync-device" key={device.id}>
            <span>{device.name}{device.current ? " · This device" : ""}<small className="muted"> · Expires {new Date(device.expiresAt).toLocaleDateString()}</small></span>
            {!device.current && <Button variant="outline" size="sm" type="button" disabled={busy} onClick={() => void accountAction({ type: "sync.device.revoke", id: device.id })}>Revoke</Button>}
          </div>)}
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
            <Input type="password" value={password} minLength={12} maxLength={128} onChange={event => setPassword(event.target.value)} autoComplete={signup || recovering ? "new-password" : "current-password"} disabled={busy} />
          </Label>
          {recovering && <Label className="field">Recovery code
            <Input value={recoveryCode} maxLength={64} onChange={event => setRecoveryCode(event.target.value.trim())} autoComplete="off" disabled={busy} />
          </Label>}
          {signup && !recovering && <Label className="field">Invite code
            <Input type="password" value={inviteCode} onChange={event => setInviteCode(event.target.value)} autoComplete="off" disabled={busy} />
          </Label>}
          <div className="sync-actions">
            <Button variant="default" type="submit"  disabled={busy || !endpoint || !email || password.length < 12 || (signup && !recovering && !inviteCode) || (recovering && recoveryCode.length !== 64)}>{busy ? "Connecting…" : recovering ? "Reset password & sync" : signup ? "Create account & sync" : "Sign in & sync"}</Button>
            <Button variant="ghost" type="button"  disabled={busy} onClick={() => { setSignup(!signup); setRecovering(false); setError(""); }}>{signup ? "Already have an account? Sign in" : "Create an account"}</Button>
            <Button variant="ghost" type="button" disabled={busy} onClick={() => { setRecovering(!recovering); setSignup(false); setError(""); }}>{recovering ? "Back to sign in" : "Use a recovery code"}</Button>
          </div>
          <small className="muted">Connecting uploads this workspace’s tasks and notes to your account. Registration needs an invite from the server owner. Keep your recovery code somewhere safe. Resetting your password with it signs out all other devices and generates a replacement code.</small>
        </form>
      )}
      {features.recoveryCode && <div className="sync-recovery">
        <strong>Save this recovery code</strong>
        <p>Keep it outside Dock. Generating another code replaces this one. Dock does not email recovery links.</p>
        <Input aria-label="Your recovery code" readOnly value={features.recoveryCode} onFocus={event => event.target.select()} />
      </div>}
      {(error || sync.error || features.error) && <p className="note-error" role="alert">{error || sync.error || features.error}</p>}
      <div className="sync-conflicts">
        {sync.conflicts > 0 && <p role="status">{sync.conflicts} conflicting {sync.conflicts === 1 ? "edit needs" : "edits need"} review. Both versions have been kept.</p>}
        <Button variant="outline" type="button" onClick={onReviewConflicts}>{sync.conflicts ? "Review conflicts" : "Sync conflicts"}</Button>
      </div>
    </section>
  );
}
