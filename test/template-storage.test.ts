import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { restoreTemplate, updateTemplateIcon } from "../src/server/template-service.ts";
import type { AppConfig } from "../src/server/types.ts";

test("backs up, atomically changes, and restores a template", async () => {
  const root = await mkdtemp(join(tmpdir(), "unraid-icon-manager-"));
  const templatesDir = join(root, "templates");
  const configDir = join(root, "config");
  await mkdir(templatesDir); await mkdir(configDir);
  const fileName = "my-plex.xml";
  const original = "<Container><Name>plex</Name><Icon>old.png</Icon><Extra>preserved</Extra></Container>";
  await writeFile(join(templatesDir, fileName), original);
  const config: AppConfig = { port: 8787, host: "127.0.0.1", configDir, templatesDir, iconsDir: join(configDir, "icons"), iconHostRoot: "/mnt/user/icons", backupsDir: join(configDir, "backups"), maxUploadBytes: 10 };

  const changed = await updateTemplateIcon(config, fileName, "new.png");
  assert.equal(changed.oldIcon, "old.png");
  assert.match(await readFile(join(templatesDir, fileName), "utf8"), /<Icon>new.png<\/Icon>/);
  assert.equal(await readFile(changed.backupFile, "utf8"), original);

  await restoreTemplate(config, fileName, changed.backupFile);
  assert.equal(await readFile(join(templatesDir, fileName), "utf8"), original);
});

test("rejects path escapes and preserves the original template when a write preparation fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "unraid-icon-manager-"));
  const templatesDir = join(root, "templates");
  const configDir = join(root, "config");
  await mkdir(templatesDir); await mkdir(configDir);
  const fileName = "my-invalid.xml";
  const original = "not valid template xml";
  await writeFile(join(templatesDir, fileName), original);
  const config: AppConfig = { port: 8787, host: "127.0.0.1", configDir, templatesDir, iconsDir: join(configDir, "icons"), iconHostRoot: "/mnt/user/icons", backupsDir: join(configDir, "backups"), maxUploadBytes: 10 };

  await assert.rejects(updateTemplateIcon(config, fileName, "new.png"), /Template XML is invalid/);
  assert.equal(await readFile(join(templatesDir, fileName), "utf8"), original);
  await assert.rejects(updateTemplateIcon(config, "../outside.xml", "new.png"), /Invalid template file name/);
  await assert.rejects(restoreTemplate(config, fileName, join(root, "outside.xml")), /Backup path escapes backup directory/);
});
