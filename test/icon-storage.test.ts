import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import test from "node:test";
import { listStoredIcons, storeUploadedIcon } from "../src/server/icon-service.ts";
import type { AppConfig } from "../src/server/types.ts";

async function configForTest(): Promise<AppConfig> {
  const configDir = await mkdtemp(join(tmpdir(), "unraid-icon-manager-icons-"));
  return { port: 8787, host: "127.0.0.1", configDir, templatesDir: "/templates", iconsDir: join(configDir, "icons"), iconHostRoot: "/mnt/user/icons", backupsDir: join(configDir, "backups"), maxUploadBytes: 1024 * 1024 };
}

test("normalizes valid PNG, SVG, and WebP uploads to stable PNG paths", async () => {
  const config = await configForTest();
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>');
  const png = await sharp(svg).png().toBuffer();
  const webp = await sharp(svg).webp().toBuffer();

  for (const upload of [png, svg, webp]) {
    const stored = await storeUploadedIcon(config, upload);
    assert.match(stored.fileName, /^[a-f0-9]{64}\.png$/);
    assert.match(stored.icon, /^\/mnt\/user\/icons\/[a-f0-9]{64}\.png$/);
    assert.equal((await stat(join(config.iconsDir, stored.fileName))).isFile(), true);
  }
});

test("rejects empty, invalid, and oversized image uploads", async () => {
  const config = await configForTest();
  await assert.rejects(storeUploadedIcon(config, Buffer.alloc(0)), /empty/);
  await assert.rejects(storeUploadedIcon(config, Buffer.from("not an image")), /valid PNG/);
  await assert.rejects(storeUploadedIcon({ ...config, maxUploadBytes: 3 }, Buffer.from("four")), /exceeds 3 bytes/);
});

test("lists normalized uploads as a persistent newest-first gallery", async () => {
  const config = await configForTest();
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="blue"/></svg>');
  const stored = await storeUploadedIcon(config, svg);
  const gallery = await listStoredIcons(config, "http://unraid:8787");
  assert.equal(gallery.length, 1);
  assert.equal(gallery[0].fileName, stored.fileName);
  assert.equal(gallery[0].icon, `http://unraid:8787/api/icons/file/${stored.fileName}`);
  assert.ok(gallery[0].bytes > 0);
});
