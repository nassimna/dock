import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { DockDatabase as CoreDockDatabase } from "@dock/core/database";

export class DockDatabase extends CoreDockDatabase {
  constructor(filename: string) {
    super(new DatabaseSync(filename), {
      randomUUID,
      sha256: value => createHash("sha256").update(value).digest(),
    });
  }
}
