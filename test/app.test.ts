import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApp } from "../src/server/app.ts";
import type { AppConfig, ManagedContainer } from "../src/server/types.ts";

const activeContainer: ManagedContainer = {
  name: "active", id: "active-id", image: "example/active", state: "running", status: "Up 1 minute",
  fileName: "my-active.xml", icon: "old.png", editable: true, templateMatch: "name", uneditableReason: null
};

test("apply and rollback reject template files that are not attached to an editable deployed container", async () => {
  const root = await mkdtemp(join(tmpdir(), "unraid-icon-manager-app-"));
  const configDir = join(root, "config");
  const templatesDir = join(root, "templates");
  await mkdir(configDir); await mkdir(templatesDir);
  await writeFile(join(templatesDir, "my-active.xml"), "<Container><Name>active</Name><Icon>old.png</Icon></Container>");
  const config: AppConfig = { port: 8787, host: "127.0.0.1", configDir, templatesDir, iconsDir: join(configDir, "icons"), iconHostRoot: "/mnt/user/icons", backupsDir: join(configDir, "backups"), maxUploadBytes: 1024 };
  let deployed = true;
  const app = createApp(config, { listManagedContainers: async () => ({ containers: deployed ? [activeContainer] : [], dockerAvailable: true }) });

  try {
    const rejected = await app.inject({ method: "POST", url: "/api/icons/apply", payload: { templateFiles: ["my-removed.xml"], icon: "https://example.com/icon.png" } });
    assert.equal(rejected.statusCode, 400);

    const applied = await app.inject({ method: "POST", url: "/api/icons/apply", payload: { templateFiles: ["my-active.xml"], icon: "https://example.com/icon.png" } });
    assert.equal(applied.statusCode, 200);
    const auditId = (applied.json() as { results: Array<{ id: number }> }).results[0].id;

    deployed = false;
    const restore = await app.inject({ method: "POST", url: `/api/audits/${auditId}/restore`, payload: {} });
    assert.equal(restore.statusCode, 400);
  } finally {
    await app.close();
  }
});
