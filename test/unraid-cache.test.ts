import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { invalidateUnraidIconCache } from "../src/server/unraid-cache-service.ts";
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
