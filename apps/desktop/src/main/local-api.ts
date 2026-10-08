import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { parseCommand, type Command, type Snapshot } from "@dock/contracts";

export async function startLocalApi(
  directory: string,
  dispatch: (command: Command) => Promise<Snapshot>,
): Promise<() => void> {
  const token = randomBytes(32).toString("hex");
  const descriptor = join(directory, "local-api.json");
  const server = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (
      request.headers.origin ||
      request.headers.authorization !== `Bearer ${token}`
    ) {
      response
        .writeHead(401)
        .end(JSON.stringify({ error: "Unauthorized local command." }));
      return;
    }
    if (request.method !== "POST" || request.url !== "/commands") {
      response
        .writeHead(404)
        .end(JSON.stringify({ error: "Unknown endpoint." }));
      return;
    }
    try {
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 1_000_000) throw new Error("The command is too large.");
        chunks.push(chunk);
      }
      const command = parseCommand(
        JSON.parse(Buffer.concat(chunks).toString()),
      );
      if (
        command.type === "window" &&
        !["main", "capture", "mini"].includes(command.action)
      ) {
        throw new Error("This window action requires the desktop UI.");
      }
      response.end(JSON.stringify(await dispatch(command)));
    } catch (error) {
      response
        .writeHead(400)
        .end(
          JSON.stringify({
            error:
              error instanceof Error ? error.message : "The command failed.",
          }),
        );
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("The local command API could not start.");
  try {
    writeFileSync(descriptor, JSON.stringify({ port: address.port, token }), {
      mode: 0o600,
    });
  } catch (error) {
    server.close();
    throw error;
  }
  return () => {
    server.closeAllConnections();
    server.close();
    unlinkSync(descriptor);
  };
}
