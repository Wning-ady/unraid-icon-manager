import { access, rm } from "node:fs/promises";
import { join } from "node:path";
import type { AppConfig } from "./types.js";

function cacheFileName(containerName: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(containerName)) throw new Error("Invalid container name for Unraid icon cache");
  return `${containerName}-icon.png`;
}

/**
 * Unraid Docker Manager keeps both persistent and RAM icon copies. Removing both
 * makes the next Docker page request resolve the current template Icon value.
 */
export async function invalidateUnraidIconCache(config: AppConfig, containerName: string): Promise<void> {
  const fileName = cacheFileName(containerName);
  const directories = [config.iconCacheDir, config.iconCacheRamDir].filter((value): value is string => Boolean(value));
  for (const directory of directories) {
    try { await access(directory); }
    catch { throw new Error(`Required Unraid icon cache mount is unavailable: ${directory}`); }
  }
  await Promise.all(directories.map((directory) => rm(join(directory, fileName), { force: true })));
}
