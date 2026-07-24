import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApp } from "../src/server/app.ts";
import type { AppConfig } from "../src/server/types.ts";

test("protects privileged APIs while preserving public hash-addressed icon delivery", async () => {
  const root = await mkdtemp(join(tmpdir(), "uim-security-"));
  const configDir = join(root, "config"); const templatesDir = join(root, "templates");
  await mkdir(join(configDir, "icons"), { recursive: true }); await mkdir(templatesDir);
  const fileName = `${"e".repeat(64)}.png`;
  await writeFile(join(configDir, "icons", fileName), "png");
  const config: AppConfig = { port: 8787, host: "127.0.0.1", configDir, templatesDir, iconsDir: join(configDir, "icons"), iconHostRoot: "/icons", backupsDir: join(configDir, "backups"), maxUploadBytes: 1024, adminToken: "a-secure-token-with-at-least-24-characters", trustedNetworks: ["127.0.0.1/32"] };
  const app = createApp(config);
  try {
    const health = await app.inject({ method: "GET", url: "/api/health" });
    assert.deepEqual(health.json().ok, true); assert.equal("templatesDir" in health.json(), false);
    assert.match(health.headers["content-security-policy"] ?? "", /default-src 'self'/);
    assert.equal((await app.inject({ method: "GET", url: "/api/containers" })).statusCode, 401);
    assert.equal((await app.inject({ method: "GET", url: `/api/icons/file/${fileName}` })).statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: "/api/icons/upload", payload: {} })).statusCode, 401);

    const badLogin = await app.inject({ method: "POST", url: "/api/auth/login", payload: { token: "wrong" } });
    assert.equal(badLogin.statusCode, 401);
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { token: config.adminToken } });
    assert.equal(login.statusCode, 200);
    const setCookie = (Array.isArray(login.headers["set-cookie"]) ? login.headers["set-cookie"] : [login.headers["set-cookie"]]).join(";");
    const cookie = ["uim_session", "uim_csrf"].map((name) => `${name}=${setCookie.match(new RegExp(`${name}=([^;]+)`))?.[1] ?? ""}`).join("; ");
    const csrf = login.json().csrf as string;
    assert.equal((await app.inject({ method: "GET", url: "/api/about", headers: { cookie } })).statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: "/api/ui-settings", headers: { cookie }, payload: {} })).statusCode, 403);
    const mutation = await app.inject({ method: "PATCH", url: "/api/ui-settings", headers: { cookie, host: "localhost:80", origin: "http://localhost:80", "x-csrf-token": csrf }, payload: { theme: "light" } });
    assert.equal(mutation.statusCode, 200);
  } finally { await app.close(); }
});
