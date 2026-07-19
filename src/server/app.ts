import { createReadStream, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import type { AppConfig } from "./types.js";
import { AppDatabase } from "./database.js";
import { listManagedContainers } from "./container-service.js";
import { createGeneratedTemplate, getTemplate, removeGeneratedTemplate, restoreTemplate, updateTemplateIcon } from "./template-service.js";
import { listStoredIcons, storeUploadedIcon } from "./icon-service.js";
import { validateIconUrl } from "./icon-validation.js";
import { invalidateUnraidIconCache, mutateUnraidIconCache, resolveOwnUploadedIconPng, restoreUnraidIconCache, snapshotUnraidIconCache, writeUnraidIconCache } from "./unraid-cache-service.js";

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) throw new Error(`${label} must be a string array`);
  return value;
}

function httpError(error: unknown): { statusCode: number; message: string } {
  return { statusCode: 400, message: error instanceof Error ? error.message : "Invalid request" };
}

function operationError(original: unknown, recoveryErrors: unknown[]): Error {
  const originalMessage = original instanceof Error ? original.message : String(original);
  const recovery = recoveryErrors.map((error) => error instanceof Error ? error.message : String(error)).join("; ");
  return new Error(recovery ? `${originalMessage}; automatic recovery also failed: ${recovery}` : originalMessage);
}

function publicBaseUrl(config: AppConfig, request: { protocol: string; headers: { host?: string } }): string {
  if (config.publicBaseUrl) return config.publicBaseUrl;
  if (!request.headers.host) throw new Error("PUBLIC_BASE_URL is required because the request has no Host header");
  return `${request.protocol}://${request.headers.host}`;
}

function uploadedIconUrl(config: AppConfig, request: { protocol: string; headers: { host?: string } }, fileName: string): string {
  return `${publicBaseUrl(config, request)}/api/icons/file/${fileName}`;
}

function normalizeIcon(config: AppConfig, request: { protocol: string; headers: { host?: string } }, value: string): string {
  const icon = value.trim();
  if (!icon.startsWith("/")) return validateIconUrl(icon);
  const fileName = icon.split("/").pop() ?? "";
  if (!/^[a-f0-9]{64}\.png$/.test(fileName) || !existsSync(join(config.iconsDir, fileName))) {
    throw new Error("Local icon must be an image uploaded through this app");
  }
  return uploadedIconUrl(config, request, fileName);
}

export function createApp(config: AppConfig, dependencies: { listManagedContainers?: typeof listManagedContainers } = {}) {
  const app = Fastify({ logger: true, bodyLimit: config.maxUploadBytes + 16_384 });
  const database = new AppDatabase(config);
  const clientRoot = join(process.cwd(), "dist/client");
  const listContainers = dependencies.listManagedContainers ?? listManagedContainers;
  let appVersion = "dev";
  try { appVersion = (JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { version?: string }).version ?? appVersion; } catch { /* Development fallback. */ }

  app.addHook("onClose", () => database.close());
  app.get("/api/health", async () => ({
    ok: true,
    templatesDir: config.templatesDir,
    templatesWritable: existsSync(config.templatesDir),
    iconCachesMounted: Boolean(config.iconCacheDir && config.iconCacheRamDir && existsSync(config.iconCacheDir) && existsSync(config.iconCacheRamDir))
  }));
  app.get("/api/about", async () => ({ version: appVersion, githubUrl: "https://github.com/Wning-ady/unraid-icon-manager" }));
  app.get("/api/containers", async () => listContainers(config));
  app.get("/api/audits", async () => database.listAudits());

  app.post("/api/icons/upload", async (request, reply) => {
    try {
      const body = request.body as { contentBase64?: unknown };
      if (typeof body?.contentBase64 !== "string") throw new Error("contentBase64 is required");
      const content = body.contentBase64.replace(/^data:[^;]+;base64,/, "");
      const result = await storeUploadedIcon(config, Buffer.from(content, "base64"));
      return reply.code(201).send({ ...result, icon: uploadedIconUrl(config, request, result.fileName), previewUrl: `/api/icons/file/${result.fileName}` });
    } catch (error) { return reply.code(httpError(error).statusCode).send(httpError(error)); }
  });

  app.get("/api/icons", async (request) => listStoredIcons(config, publicBaseUrl(config, request)));

  app.get("/api/icons/file/:fileName", async (request, reply) => {
    const fileName = (request.params as { fileName: string }).fileName;
    if (!/^[a-f0-9]{64}\.png$/.test(fileName)) return reply.code(400).send({ message: "Invalid icon file name" });
    const filePath = join(config.iconsDir, fileName);
    if (!existsSync(filePath)) return reply.code(404).send({ message: "Icon file not found" });
    return reply.type("image/png").send(createReadStream(filePath));
  });

  app.post("/api/icons/apply", async (request, reply) => {
    try {
      const body = request.body as { containerIds?: unknown; icon?: unknown };
      const containerIds = stringArray(body.containerIds, "containerIds");
      if (!containerIds.length) throw new Error("Select at least one container");
      if (typeof body.icon !== "string" || !body.icon.trim()) throw new Error("icon is required");
      const icon = normalizeIcon(config, request, body.icon);
      const containers = (await listContainers(config)).containers;
      const containerById = new Map(containers.map((container) => [container.id, container]));
      const targets = [...new Set(containerIds)].map((containerId) => {
        const container = containerById.get(containerId);
        if (!container) throw new Error(`Container ${containerId.slice(0, 12)} is no longer deployed`);
        return container;
      });
      const iconPng = await resolveOwnUploadedIconPng(config, icon);
      const results = [];
      for (const container of targets) {
        let fileName = container.fileName;
        let backupFile = "";
        let oldIcon = container.icon;
        let templateCreated = false;
        let cacheBackup = null;
        let auditRecord;
        try {
          if (fileName) {
            const update = await updateTemplateIcon(config, fileName, icon);
            backupFile = update.backupFile;
            oldIcon = update.oldIcon;
          } else {
            const created = await createGeneratedTemplate(config, container.name, container.image, icon);
            fileName = created.fileName;
            backupFile = created.backupFile;
            templateCreated = true;
          }
          cacheBackup = await mutateUnraidIconCache(config, container.name, iconPng);
          auditRecord = database.addAudit({ containerName: container.name, templateFile: fileName, oldIcon, newIcon: icon, backupFile, cacheBackup, templateCreated, createdAt: new Date().toISOString(), result: "applied" });
        } catch (error) {
          const recoveryErrors: unknown[] = [];
          if (cacheBackup) {
            try { await restoreUnraidIconCache(config, container.name, cacheBackup); }
            catch (recoveryError) { recoveryErrors.push(recoveryError); }
          }
          if (fileName) {
            try {
              if (templateCreated) await removeGeneratedTemplate(config, fileName, icon);
              else if (backupFile) await restoreTemplate(config, fileName, backupFile);
            } catch (recoveryError) { recoveryErrors.push(recoveryError); }
          }
          throw operationError(error, recoveryErrors);
        }
        results.push(auditRecord);
      }
      return { results, refreshUrl: config.unraidDockerUrl, notice: iconPng ? "图标已保存并写入 Unraid 缓存；请点击刷新按钮查看。容器没有重启或重建。" : "图标 URL 已保存，Unraid 将在 Docker 页面打开时获取新图标。容器没有重启或重建。" };
    } catch (error) { return reply.code(httpError(error).statusCode).send(httpError(error)); }
  });

  app.post("/api/unraid/refresh", async (request, reply) => {
    try {
      const body = request.body as { containerIds?: unknown };
      const containerIds = stringArray(body.containerIds, "containerIds");
      const containers = (await listContainers(config)).containers;
      const byId = new Map(containers.map((container) => [container.id, container]));
      for (const id of containerIds) {
        const container = byId.get(id);
        if (!container) throw new Error(`Container ${id.slice(0, 12)} is no longer deployed`);
        if (container.icon?.startsWith("http://") || container.icon?.startsWith("https://")) {
          const png = await resolveOwnUploadedIconPng(config, container.icon);
          if (png) await writeUnraidIconCache(config, container.name, png);
          else await invalidateUnraidIconCache(config, container.name);
        } else {
          await invalidateUnraidIconCache(config, container.name);
        }
      }
      return { url: config.unraidDockerUrl, notice: "Unraid 图标缓存已清除" };
    } catch (error) { return reply.code(httpError(error).statusCode).send(httpError(error)); }
  });

  app.post("/api/audits/:id/restore", async (request, reply) => {
    try {
      const id = Number((request.params as { id: string }).id);
      const audit = database.getAudit(id);
      if (!audit) return reply.code(404).send({ message: "Audit record not found" });
      const currentTemplates = await listContainers(config);
      const container = currentTemplates.containers.find((entry) => entry.name === audit.containerName);
      if (!container) throw new Error("Container is no longer deployed");
      const currentTemplate = await getTemplate(config, audit.templateFile);
      if (currentTemplate.icon !== audit.newIcon) throw new Error("Template changed after this audit; refusing to overwrite a newer icon");
      const currentCacheBackup = await snapshotUnraidIconCache(config, audit.containerName);
      let currentTemplateBackup = "";
      if (!audit.templateCreated) currentTemplateBackup = (await updateTemplateIcon(config, audit.templateFile, audit.newIcon ?? "")).backupFile;
      let templateChanged = false;
      let cacheMutationStarted = false;
      let restored;
      try {
        if (audit.templateCreated) await removeGeneratedTemplate(config, audit.templateFile, audit.newIcon);
        else await restoreTemplate(config, audit.templateFile, audit.backupFile);
        templateChanged = true;
        cacheMutationStarted = true;
        if (audit.cacheBackup) await restoreUnraidIconCache(config, audit.containerName, audit.cacheBackup);
        else await invalidateUnraidIconCache(config, audit.containerName);
        restored = database.addAudit({ containerName: audit.containerName, templateFile: audit.templateFile, oldIcon: audit.newIcon, newIcon: audit.oldIcon, backupFile: audit.backupFile, cacheBackup: null, templateCreated: false, createdAt: new Date().toISOString(), result: "restored" });
      } catch (error) {
        const recoveryErrors: unknown[] = [];
        if (cacheMutationStarted && currentCacheBackup) {
          try { await restoreUnraidIconCache(config, audit.containerName, currentCacheBackup); }
          catch (recoveryError) { recoveryErrors.push(recoveryError); }
        }
        if (templateChanged) {
          try {
            if (audit.templateCreated) await createGeneratedTemplate(config, audit.containerName, container.image, audit.newIcon ?? "");
            else await restoreTemplate(config, audit.templateFile, currentTemplateBackup);
          } catch (recoveryError) { recoveryErrors.push(recoveryError); }
        }
        throw operationError(error, recoveryErrors);
      }
      return { audit: restored, refreshUrl: config.unraidDockerUrl };
    } catch (error) { return reply.code(httpError(error).statusCode).send(httpError(error)); }
  });

  if (existsSync(clientRoot)) {
    void app.register(fastifyStatic, { root: clientRoot, wildcard: false });
    app.get("/*", async (_request, reply) => reply.sendFile("index.html"));
  }
  return app;
}
