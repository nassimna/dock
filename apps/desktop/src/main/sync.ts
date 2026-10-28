import { hostname } from "node:os";
import { DockSync as CoreDockSync } from "@dock/core/sync";
import type { DockDatabase } from "./database.ts";

export type { SyncAuthCommand } from "@dock/core/sync";

export class DockSync extends CoreDockSync {
  constructor(database: DockDatabase, changed: () => void) {
    super(database, changed, hostname());
  }
}
