import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useRef, useState } from "react";
import { ArrowLeft, Cloud, Eye, EyeOff, ShieldCheck, Monitor } from "lucide-react";
import type { SyncFeatures } from "../../../../../packages/contracts/src/sync-features";
import { appBrand, commandSchema, type Command, type SyncStatus } from "@dock/contracts";
import { errorMessage, type Dispatch } from "./state";
import brandMark from "../../../resources/brand.svg";

export function SyncSettings({ sync, features, dispatch, onReviewConflicts, onClose }: {
  sync: SyncStatus; features: SyncFeatures; dispatch: Dispatch; onReviewConflicts: () => void; onClose: () => void;
}) {
  const [endpoint, setEndpoint] = useState(sync.endpoint || appBrand.syncEndpoint);
  const [email, setEmail] = useState(sync.email);
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup" | "recover">("login");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [page, setPage] = useState<"overview" | "security" | "devices">("overview");
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");
  const authenticating = !sync.connected || signingIn;
  function changeMode(next: typeof mode) {
    setMode(next); setError(""); setPassword(""); setReveal(false); setRecoveryCode("");
  }
  async function run(command: Command) {
    if (pending.current) return false;
    pending.current = true; setBusy(true); setError("");
    try { await dispatch(command); return true; }
    catch (cause) { setError(errorMessage(cause)); return false; }
    finally { pending.current = false; setBusy(false); }
  }
  async function signIn() {
    const parsed = commandSchema.safeParse({ type: mode === "recover" ? "sync.recover" : mode === "signup" ? "sync.signup" : "sync.login", endpoint, email, password, recoveryCode: recoveryCode.trim() });
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      setError(field === "email" ? "Enter a valid email address." : field === "password" ? "Use a password of 12–128 characters." : field === "recoveryCode" ? "Enter your 64-character recovery code." : "Enter a valid HTTPS sync server address.");
      return;
    }
    if (await run(parsed.data)) {
      setPassword(""); setReveal(false); setRecoveryCode(""); setSigningIn(false);
      setPage(mode === "signup" || mode === "recover" ? "security" : "overview"); setMode("login");
    }
  }
  const title = authenticating ? mode === "signup" ? "Create your account" : mode === "recover" ? "Reset your password" : "Welcome back" : page === "security" ? "Account recovery" : page === "devices" ? "Signed-in devices" : "Your account";
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="account-dialog" onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onPointerDownOutside={event => { if (busy) event.preventDefault(); }}>
      <div className="account-brand"><img src={brandMark} alt="" /><span>Rivnote</span></div>
      {(signingIn || !authenticating && page !== "overview") && <Button variant="ghost" className="account-back" disabled={busy} onClick={() => { setSigningIn(false); setPage("overview"); setError(""); setPassword(""); }}><ArrowLeft size={16} /> Back to account</Button>}
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>{authenticating ? mode === "recover" ? "Use the recovery code you saved when setting up your account. Rivnote does not send email reset links." : "Your notes and tasks, together on every device." : sync.email}</DialogDescription>
      {authenticating ? <form className="account-form" onSubmit={event => { event.preventDefault(); void signIn(); }}>
        <div className="field"><Label htmlFor="account-email">Email address</Label>
          <Input id="account-email" type="email" required autoFocus autoComplete="username" value={email} disabled={busy} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" />
        </div>
        <div className="field"><div className="account-field-heading"><Label htmlFor="account-password">{mode === "recover" ? "New password" : "Password"}</Label>
          {mode === "login" && <Button type="button" variant="link" disabled={busy} onClick={() => changeMode("recover")}>Forgot password?</Button>}</div>
          <div className="account-password"><Input id="account-password" type={reveal ? "text" : "password"} required maxLength={128} autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} disabled={busy} onChange={event => setPassword(event.target.value)} />
            <Button type="button" variant="ghost" size="icon" disabled={busy} aria-label={reveal ? "Hide password" : "Show password"} aria-pressed={reveal} onClick={() => setReveal(!reveal)}>{reveal ? <EyeOff size={18} /> : <Eye size={18} />}</Button></div>
          {mode !== "login" && <small className="muted">At least 12 characters. Use a unique password.</small>}
        </div>
        {mode === "recover" && <div className="field"><Label htmlFor="account-recovery">Recovery code</Label><Input id="account-recovery" required value={recoveryCode} disabled={busy} autoComplete="off" onChange={event => setRecoveryCode(event.target.value)} /></div>}
        {error && <p className="account-error" role="alert">{error}</p>}
        <Button type="submit" disabled={busy}>{busy ? "Connecting…" : mode === "signup" ? "Create account" : mode === "recover" ? "Reset password & sign in" : "Sign in"}</Button>
        <div className="account-switch"><span>{mode === "login" ? "New to Rivnote?" : "Already have an account?"}</span><Button type="button" variant="link" disabled={busy} onClick={() => changeMode(mode === "login" ? "signup" : "login")}>{mode === "login" ? "Create an account" : "Sign in"}</Button></div>
        <details className="account-advanced"><summary>Custom sync server</summary><Label className="field">Server address<Input type="url" value={endpoint} disabled={busy || Boolean(sync.endpoint)} onChange={event => setEndpoint(event.target.value)} /></Label></details>
        <p className="account-footnote">Your local notes stay safe. Tasks, notes and projects sync; attachments and preferences stay on this device.</p>
      </form> : <div className="account-panel">
        {page === "overview" && <>
          <div className="account-sync-card"><Cloud size={22} /><div><strong>{sync.phase === "synced" ? "Everything is up to date" : sync.phase === "syncing" ? "Syncing your work…" : sync.phase === "offline" ? "Offline · Saved on this device" : sync.phase === "error" ? "Sync needs attention" : "Ready to sync"}</strong>
            <small>{sync.pending ? `${sync.pending} changes waiting to sync` : "Tasks, notes and projects"}</small>{sync.lastSyncedAt && <small>Last synced {new Date(sync.lastSyncedAt).toLocaleString()}</small>}</div>
            <Button variant="outline" disabled={busy || sync.phase === "syncing"} onClick={() => void run({ type: "sync.now" })}>Sync now</Button></div>
          {!!sync.error && <p className="account-error" role="alert">{sync.error}</p>}
          {(sync.phase === "error" || sync.phase === "offline") && <Button variant="outline" disabled={busy} onClick={() => { setSigningIn(true); changeMode("login"); }}>Sign in again</Button>}
          {sync.conflicts > 0 && <Button variant="outline" onClick={onReviewConflicts}>Review conflicting edits ({sync.conflicts})</Button>}
          <Button className="account-menu-row" variant="outline" disabled={busy} onClick={() => setPage("security")}><ShieldCheck size={19} /> Account recovery <span>Keep access to your account</span></Button>
          <Button className="account-menu-row" variant="outline" disabled={busy} onClick={() => { setPage("devices"); void run({ type: "sync.devices" }); }}><Monitor size={19} /> Signed-in devices <span>Manage device access</span></Button>
          <div className="account-signout"><p>Your local work stays on this device when you sign out. Sign back in with the same account to resume syncing.</p>
            {confirmSignOut ? <><p>Sign out on this device?</p><div className="sync-actions"><Button variant="destructive" disabled={busy} onClick={() => void run({ type: "sync.disconnect" }).then(ok => { if (ok) { setConfirmSignOut(false); setPage("overview"); } })}>Sign out</Button><Button variant="ghost" disabled={busy} onClick={() => setConfirmSignOut(false)}>Stay signed in</Button></div></> : <Button variant="ghost" disabled={busy} onClick={() => setConfirmSignOut(true)}>Sign out</Button>}
          </div>
        </>}
        {page === "security" && <>
          <p>Save your recovery code somewhere private, outside Rivnote. It lets you reset your password if you forget it.</p>
          {features.recoveryCode && <div className="account-recovery"><strong>Save this code now</strong><Input aria-label="Your recovery code" readOnly value={features.recoveryCode} onFocus={event => event.target.select()} /><small>It is only shown during this session.</small></div>}
          <p className="muted">Generating a code replaces your previous code. Recovery resets your password and signs out other devices.</p>
          <Button variant="outline" disabled={busy} onClick={() => void run({ type: "sync.recovery.create" })}>{busy ? "Generating…" : "Generate new recovery code"}</Button>
        </>}
        {page === "devices" && <>
          <p>Remove access for a device you no longer use.</p>
          <Button variant="outline" disabled={busy} onClick={() => void run({ type: "sync.devices" })}>{busy ? "Loading…" : "Refresh devices"}</Button>
          {features.devices.map(device => <div className="sync-device" key={device.id}><div><strong>{device.name}</strong><small>{device.current ? "This device · " : ""}Expires {new Date(device.expiresAt).toLocaleDateString()}</small></div>{!device.current && <Button variant="outline" disabled={busy} onClick={() => void run({ type: "sync.device.revoke", id: device.id })}>Remove access</Button>}</div>)}
          {!busy && !error && !features.devices.length && <p className="muted">No signed-in devices to show.</p>}
        </>}
        {(error || features.error) && <p className="account-error" role="alert">{error || features.error}</p>}
      </div>}
    </DialogContent>
  </Dialog>;
}
