import { Download, LoaderCircle, RefreshCw } from "lucide-react";
import type { UpdateState } from "@dock/contracts";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Act } from "./state";

const messages: Record<UpdateState["status"], string> = {
  unavailable: "Updates are unavailable in this build.",
  idle: "Check for the latest version of Dock.",
  checking: "Checking for updates…",
  current: "You’re up to date.",
  available: "A new version of Dock is available.",
  downloading: "Downloading your update…",
  ready: "Your update is ready to install.",
  installing: "Preparing to restart…",
  error: "The update needs attention.",
};

export function UpdateDetails({ update, version, act }: { update: UpdateState; version: string; act: Act }) {
  const busy = ["checking", "downloading", "installing"].includes(update.status);
  const action = update.status === "error" ? update.retry : update.status === "ready" ? "install" :
    update.status === "available" ? "download" : "check";
  const label = update.status === "error" ? action === "download" ? "Retry download" : action === "install" ? "Retry restart" : "Check again" :
    action === "install" ? "Restart to update" : action === "download" ? "Download update" : "Check for updates";
  return <div className="update-details">
    {update.version && <strong>Dock {update.version}</strong>}
    <p role="status">{update.message || messages[update.status]}</p>
    {update.status === "downloading" && <div className="update-download">
      <div className="update-progress" role="progressbar" aria-label="Update download" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={Math.round(update.progress)}>
        <span style={{ width: `${update.progress}%` }} />
      </div><span>{Math.round(update.progress)}%</span>
    </div>}
    <small>Current version {version}</small>
    {update.status !== "unavailable" && <Button type="button" variant={action === "check" ? "outline" : "default"} size="sm"
      disabled={busy} onClick={() => act({ type: "update", action })}>
      {busy ? <LoaderCircle size="0.875rem" className="update-spin" /> : action === "download" ? <Download size="0.875rem" /> : action === "install" ? <RefreshCw size="0.875rem" /> : null}
      {busy ? update.status === "checking" ? "Checking…" : update.status === "downloading" ? "Downloading…" : "Preparing…" : label}
    </Button>}
    {update.status === "error" && update.retry !== "check" && <Button type="button" variant="ghost" size="sm"
      onClick={() => act({ type: "update", action: "check" })}>Check again</Button>}
  </div>;
}

export function UpdateNotice({ update, version, act }: { update: UpdateState; version: string; act: Act }) {
  if (!update.version || !["available", "downloading", "ready", "installing", "error"].includes(update.status)) return null;
  const label = update.status === "ready" ? "Restart to update" : update.status === "downloading" ? "Downloading update" :
    update.status === "installing" ? "Preparing update" : update.status === "error" ? "Update needs attention" : "Update available";
  return <Popover>
    <Tooltip>
      <TooltipTrigger asChild><PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="icon-button update-indicator" aria-label={label} data-update-status={update.status}>
          {update.status === "ready" || update.status === "installing" ? <RefreshCw size="1rem" className={update.status === "installing" ? "update-spin" : ""} /> :
            update.status === "downloading" ? <LoaderCircle size="1rem" className="update-spin" /> : <Download size="1rem" />}
          <span className="update-dot" aria-hidden="true" />
        </Button>
      </PopoverTrigger></TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
    <PopoverContent align="end" className="update-popover" aria-label="Dock updates">
      <UpdateDetails update={update} version={version} act={act} />
    </PopoverContent>
  </Popover>;
}
