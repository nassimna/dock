import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { Cloud } from "lucide-react";
import type { SyncFeatures } from "../../../../../packages/contracts/src/sync-features";
import { appBrand, type Command, type SyncStatus } from "@dock/contracts";
import { errorMessage, type Dispatch } from "./state";

export function SyncSettings({ sync, features, dispatch, onReviewConflicts }: { sync: SyncStatus; features: SyncFeatures; dispatch: Dispatch; onReviewConflicts: () => void }) {
  const [endpoint, setEndpoint] = useState(sync.endpoint || appBrand.syncEndpoint);
  const [email, setEmail] = useState(sync.email);
  const [password, setPassword] = useState("");
  const [signup, setSignup] = useState(!sync.endpoint);
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
        ? { type: "sync.signup", endpoint, email, password }
        : { type: "sync.login", endpoint, email, password });
      setPassword("");
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
        Your notes. Your next step. Sign in on mobile and desktop to keep your
        work with you. Everything saves locally first, even offline.
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
          <h3>{recovering ? "Recover your account" : signup ? "Create your Rivnote account" : "Welcome back to Rivnote"}</h3>
          <p className="muted">Use the same account on mobile and desktop. Your saved tasks and notes sync automatically when connected.</p>
          <Label className="field">Email
            <Input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="username" disabled={busy} />
          </Label>
          <Label className="field">Password
            <Input type="password" value={password} minLength={12} maxLength={128} onChange={event => setPassword(event.target.value)} autoComplete={signup || recovering ? "new-password" : "current-password"} disabled={busy} />
          </Label>
          {recovering && <Label className="field">Recovery code
            <Input value={recoveryCode} maxLength={64} onChange={event => setRecoveryCode(event.target.value.trim())} autoComplete="off" disabled={busy} />
          </Label>}
          <div className="sync-actions">
            <Button variant="default" type="submit"  disabled={busy || !endpoint || !email || password.length < 12 || (recovering && recoveryCode.length !== 64)}>{busy ? "Connecting…" : recovering ? "Reset password & sync" : signup ? "Create account & sync" : "Sign in & sync"}</Button>
            <Button variant="ghost" type="button"  disabled={busy} onClick={() => { setSignup(!signup); setRecovering(false); setError(""); }}>{signup ? "Already have an account? Sign in" : "Create an account"}</Button>
            <Button variant="ghost" type="button" disabled={busy} onClick={() => { setRecovering(!recovering); setSignup(false); setError(""); }}>{recovering ? "Back to sign in" : "Use a recovery code"}</Button>
          </div>
          <small className="muted">Use at least 12 characters for your password. Connecting syncs this workspace’s tasks, notes and projects to your account. Attached files and device preferences stay on their original device. Save your recovery code privately; recovery uses this code, without email reset links.</small>
          <details className="sync-advanced"><summary>Advanced: custom sync server</summary>
            <Label className="field">Sync server
              <Input type="url" value={endpoint} onChange={event => setEndpoint(event.target.value)} disabled={busy || Boolean(sync.endpoint)} autoComplete="url" />
            </Label>
          </details>
        </form>
      )}
      {features.recoveryCode && <div className="sync-recovery">
        <strong>Save this recovery code</strong>
        <p>Keep it outside Rivnote. Generating another code replaces this one. Rivnote does not email recovery links.</p>
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
