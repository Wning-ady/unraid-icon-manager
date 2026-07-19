import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { invalidateUnraidIconCache, mutateUnraidIconCache, resolveOwnUploadedIconPng, restoreUnraidIconCache, writeUnraidIconCache } from "../src/server/unraid-cache-service.ts";
import type { AppConfig } from "../src/server/types.ts";

test("invalidates only the selected container's persistent and RAM Unraid icon caches", async () => {
  const root = await mkdtemp(join(tmpdir(), "unraid-cache-"));
  const persistent = join(root, "persistent"); const ram = join(root, "ram");
  await mkdir(persistent); await mkdir(ram);
  for (const directory of [persistent, ram]) {
    await writeFile(join(directory, "target-icon.png"), "target");
    await writeFile(join(directory, "other-icon.png"), "other");
  }
  const config = { iconCacheDir: persistent, iconCacheRamDir: ram } as AppConfig;
  await invalidateUnraidIconCache(config, "target");
  await assert.rejects(access(join(persistent, "target-icon.png")));
  await assert.rejects(access(join(ram, "target-icon.png")));
  await access(join(persistent, "other-icon.png"));
  await access(join(ram, "other-icon.png"));
  await assert.rejects(invalidateUnraidIconCache(config, "../escape"), /Invalid container name/);
  assert.ok(true);
});

test("resolves a local uploaded PNG and atomically writes both Unraid cache copies", async () => {
  const root = await mkdtemp(join(tmpdir(), "unraid-cache-write-"));
  const iconsDir = join(root, "icons"); const persistent = join(root, "persistent"); const ram = join(root, "ram");
  await mkdir(iconsDir); await mkdir(persistent); await mkdir(ram);
  const fileName = `${"c".repeat(64)}.png`;
  const png = Buffer.from("normalized-png");
  await writeFile(join(iconsDir, fileName), png);
  const config = { iconsDir, backupsDir: join(root, "backups"), publicBaseUrl: "http://unraid:8787", iconCacheDir: persistent, iconCacheRamDir: ram, maxUploadBytes: 1024 } as AppConfig;
  const resolved = await resolveOwnUploadedIconPng(config, `http://unraid:8787/api/icons/file/${fileName}`);
  assert.ok(resolved);
  await writeUnraidIconCache(config, "compose-child", resolved);
  assert.deepEqual(await readFile(join(persistent, "compose-child-icon.png")), png);
  assert.deepEqual(await readFile(join(ram, "compose-child-icon.png")), png);
});

test("backs up and restores exact cache bytes without fetching external URLs", async () => {
  const root = await mkdtemp(join(tmpdir(), "unraid-cache-restore-"));
  const persistent = join(root, "persistent"); const ram = join(root, "ram");
  await mkdir(persistent); await mkdir(ram);
  await writeFile(join(persistent, "target-icon.png"), "persistent-old");
  await writeFile(join(ram, "target-icon.png"), "ram-old");
  const config = { iconsDir: join(root, "icons"), backupsDir: join(root, "backups"), publicBaseUrl: "http://unraid:8787", iconCacheDir: persistent, iconCacheRamDir: ram } as AppConfig;
  assert.equal(await resolveOwnUploadedIconPng(config, "https://example.com/icon.png"), null);
  const backup = await mutateUnraidIconCache(config, "target", Buffer.from("new"));
  assert.ok(backup);
  assert.equal(await readFile(join(persistent, "target-icon.png"), "utf8"), "new");
  await restoreUnraidIconCache(config, "target", backup);
  assert.equal(await readFile(join(persistent, "target-icon.png"), "utf8"), "persistent-old");
  assert.equal(await readFile(join(ram, "target-icon.png"), "utf8"), "ram-old");
});
