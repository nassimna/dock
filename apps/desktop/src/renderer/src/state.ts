import { useCallback, useEffect, useState } from "react";
import type { Command, Snapshot } from "@dock/contracts";

export function errorMessage(cause: unknown): string {
  const message = cause instanceof Error
    ? cause.message.replace(
        /^Error invoking remote method '[^']+': Error: /,
        "",
      )
    : "The command failed.";
  return ({
    conflictChanged: "A version changed or this conflict was already resolved. Review the updated versions before choosing again.",
    conflictOriginalMissing: "The original is unavailable. Keep this copy as a separate item; no original will be changed.",
    conflictLinkedWork: "This copy has linked tasks or notes. Keep both, or move the linked work before choosing one version.",
  } as Record<string, string>)[message] ?? message;
}

export function useDock() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const dispatch = useCallback(async (command: Command) => {
    try {
      const result = await window.dock.dispatch(command);
      setSnapshot(result);
      setError("");
      return result;
    } catch (cause) {
      if (!["sync.login", "sync.signup", "sync.recover", "sync.disconnect", "sync.now", "sync.devices", "sync.device.revoke", "sync.recovery.create"].includes(command.type)) setError(errorMessage(cause));
      throw cause;
    }
  }, []);
  useEffect(() => {
    const unsubscribe = window.dock.onChanged(setSnapshot);
    void dispatch({ type: "snapshot" }).catch(() => {});
    return unsubscribe;
  }, [dispatch]);
  const act = useCallback(
    (command: Command) => {
      if (command.type === "window" && (command.action === "capture" ||
          command.action === "hide" && new URLSearchParams(location.search).get("window") === "capture")) {
        void window.dock.setCaptureVisible(command.action === "capture")
          .then(() => setError(""), cause => setError(errorMessage(cause)));
        return;
      }
      void dispatch(command).catch(() => {});
    },
    [dispatch],
  );
  return { snapshot, dispatch, act, error, clearError: () => setError("") };
}

export type Dispatch = ReturnType<typeof useDock>["dispatch"];
export type Act = ReturnType<typeof useDock>["act"];
