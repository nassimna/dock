import { useCallback, useEffect, useState } from "react";
import type { Command, Snapshot } from "@dock/contracts";

export function errorMessage(cause: unknown): string {
  return cause instanceof Error
    ? cause.message.replace(
        /^Error invoking remote method '[^']+': Error: /,
        "",
      )
    : "The command failed.";
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
      setError(errorMessage(cause));
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
      void dispatch(command).catch(() => {});
    },
    [dispatch],
  );
  return { snapshot, dispatch, act, error, clearError: () => setError("") };
}

export type Dispatch = ReturnType<typeof useDock>["dispatch"];
export type Act = ReturnType<typeof useDock>["act"];
