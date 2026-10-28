import type { DataCommand } from "@dock/contracts";
import { getDatabase, notifyChanged } from "./database";
import { localChanged } from "./sync";

export function execute(command: DataCommand) {
  const result = getDatabase().execute(command);
  localChanged();
  notifyChanged();
  return result;
}
