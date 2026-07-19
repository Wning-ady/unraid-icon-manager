import { access, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { AppConfig, IconCacheBackup } from "./types.js";

function cacheFileName(containerName: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(containerName)) throw new Error("Invalid container name for Unraid icon cache");
  return `${containerName}-icon.png`;
}

/** Returns only a validated, regular, size-limited Unraid cache PNG. */
export async function findUnraidIconCache(config: AppConfig, containerName: string): Promise<string | null> {
  const fileName = cacheFileName(containerName);
  for (const directory of [config.iconCacheRamDir, config.iconCacheDir]) {
    if (!directory) continue;
    const candidate = join(directory, fileName);
    try {
      const metadata = await lstat(candidate);
      if (metadata.isFile() && metadata.size > 0 && metadata.size <= config.maxUploadBytes) return candidate;
    } catch { /* Missing cache is a normal state. */ }
  }
  return null;
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

/** Resolves only this app's already validated uploads. External URLs remain Unraid-fetched. */
export async function resolveOwnUploadedIconPng(config: AppConfig, icon: string): Promise<Buffer | null> {
  if (!config.publicBaseUrl) return null;
  const url = new URL(icon);
  const match = url.pathname.match(/^\/api\/icons\/file\/([a-f0-9]{64}\.png)$/);
  if (url.origin === new URL(config.publicBaseUrl).origin && !url.search && !url.hash && match) {
    return readFile(join(config.iconsDir, match[1]));
  }
  return null;
}

async function replaceCacheFile(directory: string, fileName: string, png: Buffer): Promise<void> {
  await access(directory);
  const target = join(directory, fileName);
  const temporary = join(directory, `.${fileName}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, png, { flag: "wx" });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function combinedError(message: string, original: unknown, recoveryErrors: unknown[]): Error {
  const originalMessage = original instanceof Error ? original.message : String(original);
  const recovery = recoveryErrors.map((error) => error instanceof Error ? error.message : String(error)).join("; ");
  return new Error(recovery ? `${message}: ${originalMessage}; recovery also failed: ${recovery}` : `${message}: ${originalMessage}`);
}

/** Writes both Unraid Docker Manager cache copies so collapsed Compose children update immediately. */
export async function writeUnraidIconCache(config: AppConfig, containerName: string, png: Buffer): Promise<void> {
  const fileName = cacheFileName(containerName);
  const directories = [config.iconCacheDir, config.iconCacheRamDir].filter((value): value is string => Boolean(value));
  const previous = new Map<string, Buffer | null>();
  for (const directory of directories) {
    try { previous.set(directory, await readFile(join(directory, fileName))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      previous.set(directory, null);
    }
  }
  try {
    for (const directory of directories) await replaceCacheFile(directory, fileName, png);
  } catch (error) {
    const recoveryErrors: unknown[] = [];
    for (const directory of directories) {
      const contents = previous.get(directory);
      try {
        if (contents) await replaceCacheFile(directory, fileName, contents);
        else await rm(join(directory, fileName), { force: true });
      } catch (recoveryError) { recoveryErrors.push(recoveryError); }
    }
    throw combinedError("Unraid icon cache refresh failed", error, recoveryErrors);
  }
}

function inside(base: string, candidate: string): boolean {
  return resolve(candidate).startsWith(`${resolve(base)}/`);
}

function cacheTargets(config: AppConfig, containerName: string) {
  const fileName = cacheFileName(containerName);
  return [
    config.iconCacheDir ? { key: "persistent" as const, directory: config.iconCacheDir, target: join(config.iconCacheDir, fileName) } : null,
    config.iconCacheRamDir ? { key: "ram" as const, directory: config.iconCacheRamDir, target: join(config.iconCacheRamDir, fileName) } : null
  ].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

/** Restores the exact cache state recorded before an icon change. */
export async function restoreUnraidIconCache(config: AppConfig, containerName: string, backup: IconCacheBackup): Promise<void> {
  const targets = cacheTargets(config, containerName);
  const desired = new Map<string, Buffer | null>();
  const previous = new Map<string, Buffer | null>();
  for (const target of targets) {
    const backupFile = backup[target.key];
    if (backupFile && !inside(config.backupsDir, backupFile)) throw new Error("Icon cache backup path escapes backup directory");
    desired.set(target.key, backupFile ? await readFile(backupFile) : null);
    try { previous.set(target.key, await readFile(target.target)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      previous.set(target.key, null);
    }
  }
  try {
    for (const target of targets) {
      const contents = desired.get(target.key);
      if (contents) await replaceCacheFile(target.directory, cacheFileName(containerName), contents);
      else await rm(target.target, { force: true });
    }
  } catch (error) {
    const recoveryErrors: unknown[] = [];
    for (const target of targets) {
      const contents = previous.get(target.key);
      try {
        if (contents) await replaceCacheFile(target.directory, cacheFileName(containerName), contents);
        else await rm(target.target, { force: true });
      } catch (recoveryError) { recoveryErrors.push(recoveryError); }
    }
    throw combinedError("Unraid icon cache restore failed", error, recoveryErrors);
  }
}

/** Creates durable copies of both current cache states without changing them. */
export async function snapshotUnraidIconCache(config: AppConfig, containerName: string): Promise<IconCacheBackup | null> {
  const targets = cacheTargets(config, containerName);
  if (!targets.length) return null;
  for (const target of targets) {
    try { await access(target.directory); }
    catch { throw new Error(`Required Unraid icon cache mount is unavailable: ${target.directory}`); }
  }
  await mkdir(config.backupsDir, { recursive: true });
  const backupDirectory = await mkdtemp(join(config.backupsDir, `cache-${containerName}-${Date.now()}-`));
  const backup: IconCacheBackup = { persistent: null, ram: null };
  for (const target of targets) {
    try {
      const contents = await readFile(target.target);
      const backupFile = join(backupDirectory, `${target.key}.png`);
      await writeFile(backupFile, contents, { flag: "wx" });
      backup[target.key] = backupFile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return backup;
}

/** Backs up both cache copies before atomically replacing or invalidating them. */
export async function mutateUnraidIconCache(config: AppConfig, containerName: string, png: Buffer | null): Promise<IconCacheBackup | null> {
  const targets = cacheTargets(config, containerName);
  if (!targets.length) return null;
  const backup = await snapshotUnraidIconCache(config, containerName);
  if (!backup) return null;
  try {
    for (const target of targets) {
      if (png) await replaceCacheFile(target.directory, cacheFileName(containerName), png);
      else await rm(target.target, { force: true });
    }
    return backup;
  } catch (error) {
    try { await restoreUnraidIconCache(config, containerName, backup); }
    catch (recoveryError) { throw combinedError("Unraid icon cache mutation failed", error, [recoveryError]); }
    throw combinedError("Unraid icon cache mutation failed", error, []);
  }
}
