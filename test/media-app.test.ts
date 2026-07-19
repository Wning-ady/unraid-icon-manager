import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import test from "node:test";
import { createApp } from "../src/server/app.ts";
import type { AppConfig, ManagedContainer } from "../src/server/types.ts";

async function fixture(failDownload = false) {
  const root = await mkdtemp(join(tmpdir(), "unraid-icon-media-"));
  const configDir = join(root, "config"); const templatesDir = join(root, "templates");
  await mkdir(configDir); await mkdir(templatesDir); await mkdir(join(configDir, "icons"));
  await writeFile(join(templatesDir, "my-active.xml"), "<Container><Name>active</Name><Repository>example/active</Repository><Icon>old.png</Icon></Container>");
  const config: AppConfig = { port: 8787, host: "127.0.0.1", configDir, templatesDir, iconsDir: join(configDir, "icons"), iconHostRoot: "/mnt/user/appdata/tool/icons",
    wallpapersDir: join(configDir, "wallpapers"), wallpaperHostRoot: "/mnt/user/appdata/tool/wallpapers", backupsDir: join(configDir, "backups"), maxUploadBytes: 1024 * 1024,
    maxWallpaperBytes: 2 * 1024 * 1024, publicBaseUrl: "http://unraid:8787" };
  const container: ManagedContainer = { name: "active", id: "active-id", image: "example/active", state: "running", status: "Up", fileName: "my-active.xml", icon: "old.png",
    displayIcon: "old.png", displayIconSource: "template", editable: true, templateMatch: "name", composeManaged: false, templateState: "linked", iconCandidates: [] };
  const png = await sharp({ create: { width: 4, height: 4, channels: 4, background: "#ff6600" } }).png().toBuffer();
  const app = createApp(config, { listManagedContainers: async () => ({ containers: [container], dockerAvailable: true }), downloadRemoteImage: async () => { if (failDownload) throw new Error("remote failed"); return png; } });
  return { app, config, png };
}

test("downloads an icon URL into the gallery before applying and protects referenced assets", async () => {
  const { app, config, png } = await fixture();
  try {
    const applied = await app.inject({ method: "POST", url: "/api/icons/apply", payload: { containerIds: ["active-id"], icon: "https://images.example/icon.png" } });
    assert.equal(applied.statusCode, 200);
    const canonical = applied.json().icon as string;
    assert.match(canonical, /^http:\/\/unraid:8787\/api\/icons\/file\/[a-f0-9]{64}\.png$/);
    assert.equal(applied.json().notice.includes("下载到图库"), true);
    const fileName = canonical.split("/").pop()!;
    assert.deepEqual(await readFile(join(config.iconsDir, fileName)), await sharp(png).resize(512, 512, { fit: "inside", withoutEnlargement: true }).png().toBuffer());
    assert.match(await readFile(join(config.templatesDir, "my-active.xml"), "utf8"), new RegExp(fileName));
    const blocked = await app.inject({ method: "DELETE", url: `/api/icons/${fileName}` });
    assert.equal(blocked.statusCode, 409);

    const unused = await app.inject({ method: "POST", url: "/api/icons/upload", payload: { contentBase64: (await sharp(png).negate().png().toBuffer()).toString("base64") } });
    const unusedName = unused.json().fileName as string;
    const removed = await app.inject({ method: "DELETE", url: `/api/icons/${unusedName}` });
    assert.equal(removed.statusCode, 204);
    await assert.rejects(access(join(config.iconsDir, unusedName)));
  } finally { await app.close(); }
});

test("leaves template, audit and gallery unchanged when an icon URL download fails", async () => {
  const { app, config } = await fixture(true);
  try {
    const applied = await app.inject({ method: "POST", url: "/api/icons/apply", payload: { containerIds: ["active-id"], icon: "https://images.example/broken.png" } });
    assert.equal(applied.statusCode, 400);
    assert.match(await readFile(join(config.templatesDir, "my-active.xml"), "utf8"), /<Icon>old\.png<\/Icon>/);
    assert.deepEqual((await app.inject({ method: "GET", url: "/api/icons", headers: { host: "unraid:8787" } })).json(), []);
    assert.deepEqual((await app.inject({ method: "GET", url: "/api/audits" })).json(), []);
  } finally { await app.close(); }
});

test("uploads, imports, groups, downloads and deletes wallpapers", async () => {
  const { app, png } = await fixture();
  try {
    const group = await app.inject({ method: "POST", url: "/api/wallpaper-groups", payload: { name: "深色" } });
    assert.equal(group.statusCode, 201); const groupId = group.json().id as number;
    const uploaded = await app.inject({ method: "POST", url: "/api/wallpapers/upload", payload: { contentBase64: png.toString("base64"), groupId } });
    assert.equal(uploaded.statusCode, 201); const fileName = uploaded.json().fileName as string;
    const gallery = await app.inject({ method: "GET", url: "/api/wallpapers", headers: { host: "unraid:8787" } });
    assert.equal(gallery.json()[0].groupId, groupId);
    assert.equal(gallery.json()[0].url, `http://unraid:8787/api/wallpapers/file/${fileName}`);
    const moved = await app.inject({ method: "PATCH", url: `/api/wallpapers/${fileName}`, payload: { groupId: null } });
    assert.equal(moved.statusCode, 200);
    const downloaded = await app.inject({ method: "GET", url: `/api/wallpapers/file/${fileName}?download=1` });
    assert.equal(downloaded.statusCode, 200); assert.match(downloaded.headers["content-disposition"] ?? "", /attachment/);
    const imported = await app.inject({ method: "POST", url: "/api/wallpapers/import", payload: { url: "https://images.example/wallpaper.png", groupId } });
    assert.equal(imported.statusCode, 201);
    const removed = await app.inject({ method: "DELETE", url: `/api/wallpapers/${fileName}` });
    assert.equal(removed.statusCode, 204);
  } finally { await app.close(); }
});
