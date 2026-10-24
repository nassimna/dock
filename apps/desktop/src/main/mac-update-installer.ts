import { execFile, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { access, lstat, mkdtemp, readdir, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

const execute = promisify(execFile);

export function isAdHocMacBundle(bundle: string): boolean {
  const signature = spawnSync("/usr/bin/codesign", ["-dv", bundle], { encoding: "utf8" });
  return signature.stderr.includes("Signature=adhoc") || signature.stderr.includes("code object is not signed at all");
}

async function plist(bundle: string, key: string): Promise<string> {
  const { stdout } = await execute("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", join(bundle, "Contents/Info.plist")]);
  return stdout.trim();
}

export async function stageMacUpdate(installed: string, archive: string, version: string, sha512: string) {
  const hash = createHash("sha512");
  await pipeline(createReadStream(archive), hash);
  if (hash.digest("base64") !== sha512)
    throw Object.assign(new Error("The downloaded update checksum does not match."), { code: "ERR_DOCK_UPDATE_INVALID" });
  if (!(await lstat(installed)).isDirectory()) throw new Error("Dock must be installed in a regular application folder.");
  await access(dirname(installed), constants.W_OK);
  const stage = await mkdtemp(join(dirname(installed), ".dock-update-"));
  try {
    const { stdout } = await execute("/usr/bin/unzip", ["-Z", "-1", archive], { maxBuffer: 16 * 1024 * 1024 });
    const entries = stdout.trim().split("\n");
    const root = entries[0]?.split("/")[0];
    if (!root?.endsWith(".app") || entries.some(entry => !entry.startsWith(`${root}/`) || entry.split("/").includes("..")))
      throw new Error("The update archive contains unexpected paths.");
    await execute("/usr/bin/ditto", ["-x", "-k", archive, stage]);
    const replacement = join(stage, root);
    if ((await readdir(stage)).length !== 1 || (await lstat(replacement)).isSymbolicLink())
      throw new Error("The update must contain one application.");
    const [id, nextId, nextVersion, executable] = await Promise.all([
      plist(installed, "CFBundleIdentifier"), plist(replacement, "CFBundleIdentifier"),
      plist(replacement, "CFBundleShortVersionString"), plist(replacement, "CFBundleExecutable"),
    ]);
    if (id !== "dev.dock.desktop" || nextId !== id || nextVersion !== version || basename(executable) !== executable)
      throw new Error("The update application or version does not match Dock.");
    await access(join(replacement, "Contents/MacOS", executable), constants.X_OK);
    await execute("/usr/bin/codesign", ["--verify", "--deep", "--strict", replacement]);
    return { stage, replacement };
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

// Wait for the final quit commit and process exit before replacing the app. Paths are positional arguments.
export const MAC_INSTALL_SCRIPT = String.raw`
set -eu
update_stage=$1
update_installed=$2
update_replacement=$3
update_parent=$4
update_profile=$5
shift 5
update_backup="$update_stage/previous.app"
update_attempts=0
printf 'ready\n'
while [ ! -f "$update_stage/commit" ] || /bin/kill -0 "$update_parent" 2>/dev/null; do
  update_attempts=$((update_attempts + 1))
  if [ "$update_attempts" -ge 120 ]; then
    /bin/rm -rf "$update_stage"
    exit 1
  fi
  /bin/sleep 1
done
if ! /bin/mv "$update_installed" "$update_backup"; then
  /bin/rm -rf "$update_stage"
  exit 1
fi
if ! /bin/mv "$update_replacement" "$update_installed"; then
  /bin/mv "$update_backup" "$update_installed"
  /usr/bin/open -n -g --env "DOCK_DATA_DIR=$update_profile" "$update_installed" --args "$@"
  /bin/rm -rf "$update_stage"
  exit 1
fi
if ! /usr/bin/open -n -g --env "DOCK_DATA_DIR=$update_profile" "$update_installed" --args "$@"; then
  /bin/mv "$update_installed" "$update_replacement"
  /bin/mv "$update_backup" "$update_installed"
  /usr/bin/open -n -g --env "DOCK_DATA_DIR=$update_profile" "$update_installed" --args "$@"
  /bin/rm -rf "$update_stage"
  exit 1
fi
/bin/rm -rf "$update_stage"
`;

export async function startMacInstaller(stage: string, installed: string, replacement: string, profile: string, args: string[]) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn("/bin/sh", ["-c", MAC_INSTALL_SCRIPT, "dock-update", stage, installed, replacement, String(process.pid), profile, ...args], {
    detached: true, stdio: ["ignore", "pipe", "ignore"], env,
  });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", () => reject(new Error("The update helper exited before handoff.")));
    child.stdout.once("data", () => resolve());
  });
  child.stdout.destroy();
  child.unref();
  return child;
}
