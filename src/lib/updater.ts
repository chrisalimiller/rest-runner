import { isTauri } from "./http";
import { friendlyUpdateError, updatesAvailable, type UpdateInfo } from "./updates";

/** The only place that talks to the Tauri updater. Every call here starts from a click; nothing runs at startup. */

export const canUpdate = (): boolean => updatesAvailable(isTauri(), import.meta.env.DEV);

export async function installedVersion(): Promise<string> {
  if (!isTauri()) return "";
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return await getVersion();
  } catch {
    return "";
  }
}

type PluginUpdate = NonNullable<Awaited<ReturnType<(typeof import("@tauri-apps/plugin-updater"))["check"]>>>;

export interface FoundUpdate {
  info: UpdateInfo;
  /** Downloads and installs, reporting bytes as they arrive, then restarts the app. */
  install: (onProgress: (received: number, total?: number) => void, onInstalling: () => void) => Promise<void>;
  /** Frees the update when the person does not install it. */
  close: () => Promise<void>;
}

/** One request for the latest release. Resolves to null when this is already the newest version. */
export async function checkForUpdate(): Promise<FoundUpdate | null> {
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update: PluginUpdate | null = await check();
    if (!update) return null;
    return {
      info: { version: update.version, currentVersion: update.currentVersion, date: update.date, notes: update.body },
      install: async (onProgress, onInstalling) => {
        try {
          let received = 0;
          let total: number | undefined;
          await update.downloadAndInstall((event) => {
            if (event.event === "Started") {
              total = event.data.contentLength;
              onProgress(0, total);
            } else if (event.event === "Progress") {
              received += event.data.chunkLength;
              onProgress(received, total);
            } else {
              onInstalling();
            }
          });
          const { relaunch } = await import("@tauri-apps/plugin-process");
          await relaunch();
        } catch (e) {
          throw new Error(friendlyUpdateError(e));
        }
      },
      close: () => update.close().catch(() => undefined),
    };
  } catch (e) {
    throw new Error(friendlyUpdateError(e));
  }
}
