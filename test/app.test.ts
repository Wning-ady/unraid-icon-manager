import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApp } from "../src/server/app.ts";
import type { AppConfig, ManagedContainer } from "../src/server/types.ts";

const activeContainer: ManagedContainer = {
  name: "active", id: "active-id", image: "example/active", state: "running", status: "Up 1 minute",
  fileName: "my-active.xml", icon: "old.png", editable: true, templateMatch: "name", composeManaged: false, templateState: "linked"
};

test("applies by deployed container id, invalidates caches, and rejects removed containers", async () => {
  const root = await mkdtemp(join(tmpdir(), "unraid-icon-manager-app-"));
  const configDir = join(root, "config");
  const templatesDir = join(root, "templates");
  const cacheDir = join(root, "cache"); const cacheRamDir = join(root, "cache-ram");
  await mkdir(configDir); await mkdir(templatesDir); await mkdir(cacheDir); await mkdir(cacheRamDir);
  await writeFile(join(templatesDir, "my-active.xml"), "<Container><Name>active</Name><Icon>old.png</Icon></Container>");
  const config: AppConfig = { port: 8787, host: "127.0.0.1", configDir, templatesDir, iconsDir: join(configDir, "icons"), iconHostRoot: "/mnt/user/icons", backupsDir: join(configDir, "backups"), maxUploadBytes: 1024, iconCacheDir: cacheDir, iconCacheRamDir: cacheRamDir, publicBaseUrl: "http://unraid:8787", unraidDockerUrl: "http://unraid/Docker" };
  await mkdir(config.iconsDir);
  const iconFile = `${"a".repeat(64)}.png`;
  await writeFile(join(config.iconsDir, iconFile), Buffer.from("png-test"));
  let deployed = true;
  const app = createApp(config, { listManagedContainers: async () => ({ containers: deployed ? [activeContainer] : [], dockerAvailable: true }) });

  try {
    const preview = await app.inject({ method: "GET", url: `/api/icons/file/${iconFile}` });
    assert.equal(preview.statusCode, 200);
    assert.match(preview.headers["content-type"] ?? "", /image\/png/);
    const invalidPreview = await app.inject({ method: "GET", url: "/api/icons/file/not-a-hash.png" });
    assert.equal(invalidPreview.statusCode, 400);
    const uploaded = await app.inject({ method: "POST", url: "/api/icons/upload", payload: { contentBase64: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>').toString("base64") } });
    assert.equal(uploaded.statusCode, 201);
    assert.match(uploaded.json().icon, /^http:\/\/unraid:8787\/api\/icons\/file\/[a-f0-9]{64}\.png$/);
    assert.match(uploaded.json().previewUrl, /^\/api\/icons\/file\/[a-f0-9]{64}\.png$/);

    await writeFile(join(cacheDir, "active-icon.png"), "old");
    await writeFile(join(cacheRamDir, "active-icon.png"), "old");
    const rejected = await app.inject({ method: "POST", url: "/api/icons/apply", payload: { containerIds: ["removed-id"], icon: "https://example.com/icon.png" } });
    assert.equal(rejected.statusCode, 400);

    const applied = await app.inject({ method: "POST", url: "/api/icons/apply", payload: { containerIds: ["active-id"], icon: `/mnt/user/icons/${iconFile}` } });
    assert.equal(applied.statusCode, 200);
    assert.match(await readFile(join(templatesDir, "my-active.xml"), "utf8"), new RegExp(`http://unraid:8787/api/icons/file/${iconFile}`));
    await assert.rejects(access(join(cacheDir, "active-icon.png")));
    await assert.rejects(access(join(cacheRamDir, "active-icon.png")));
    const auditId = (applied.json() as { results: Array<{ id: number }> }).results[0].id;

    const refreshed = await app.inject({ method: "POST", url: "/api/unraid/refresh", payload: { containerIds: ["active-id"] } });
    assert.equal(refreshed.statusCode, 200);
    assert.equal(refreshed.json().url, "http://unraid/Docker");

    deployed = false;
    const restore = await app.inject({ method: "POST", url: `/api/audits/${auditId}/restore`, payload: {} });
    assert.equal(restore.statusCode, 400);
  } finally {
    await app.close();
  }
});

test("creates and rolls back icon metadata for a deployed container without a template", async () => {
  const root = await mkdtemp(join(tmpdir(), "unraid-icon-manager-generated-"));
  const configDir = join(root, "config"); const templatesDir = join(root, "templates");
  await mkdir(configDir); await mkdir(templatesDir); await mkdir(join(configDir, "icons"));
  const generatedContainer: ManagedContainer = { ...activeContainer, name: "compose-app", id: "compose-id", image: "example/compose:latest", fileName: null, icon: null, templateMatch: null, composeManaged: true, templateState: "will-create" };
  const config: AppConfig = { port: 8787, host: "127.0.0.1", configDir, templatesDir, iconsDir: join(configDir, "icons"), iconHostRoot: "/mnt/user/icons", backupsDir: join(configDir, "backups"), maxUploadBytes: 1024 };
  const app = createApp(config, { listManagedContainers: async () => ({ containers: [generatedContainer], dockerAvailable: true }) });
  try {
    const applied = await app.inject({ method: "POST", url: "/api/icons/apply", payload: { containerIds: ["compose-id"], icon: "https://example.com/compose.png" } });
    assert.equal(applied.statusCode, 200);
    const result = applied.json().results[0] as { id: number; templateFile: string };
    const xml = await readFile(join(templatesDir, result.templateFile), "utf8");
    assert.match(xml, /<Repository>example\/compose:latest<\/Repository>/);
    assert.match(xml, /<IconManager>generated<\/IconManager>/);
    const auditId = result.id;
    const restored = await app.inject({ method: "POST", url: `/api/audits/${auditId}/restore`, payload: {} });
    assert.equal(restored.statusCode, 200);
    await assert.rejects(access(join(templatesDir, result.templateFile)));
  } finally { await app.close(); }
});
