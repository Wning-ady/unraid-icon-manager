import { createReadStream, existsSync } from "node:fs";
import { join } from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import type { AppConfig } from "./types.js";
import { AppDatabase } from "./database.js";
import { listManagedContainers } from "./container-service.js";
import { createGeneratedTemplate, removeGeneratedTemplate, restoreTemplate, updateTemplateIcon } from "./template-service.js";
import { storeUploadedIcon } from "./icon-service.js";
import { validateIconUrl } from "./icon-validation.js";
import { invalidateUnraidIconCache } from "./unraid-cache-service.js";

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) throw new Error(`${label} must be a string array`);
  return value;
}

function httpError(error: unknown): { statusCode: number; message: string } {
  return { statusCode: 400, message: error instanceof Error ? error.message : "Invalid request" };
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

  app.addHook("onClose", () => database.close());
  app.get("/api/health", async () => ({
    ok: true,
    templatesDir: config.templatesDir,
    templatesWritable: existsSync(config.templatesDir),
    iconCachesMounted: Boolean(config.iconCacheDir && config.iconCacheRamDir && existsSync(config.iconCacheDir) && existsSync(config.iconCacheRamDir))
  }));
  app.get("/api/containers", async () => listContainers(config));
  app.get("/api/groups", async () => database.listGroups());
  app.post("/api/groups", async (request, reply) => {
    try {
      const body = request.body as { name?: unknown; containerNames?: unknown };
      if (typeof body?.name !== "string") throw new Error("name is required");
      const group = database.saveGroup(body.name, stringArray(body.containerNames, "containerNames"));
      return reply.code(201).send(group);
    } catch (error) { return reply.code(httpError(error).statusCode).send(httpError(error)); }
  });
  app.delete("/api/groups/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ message: "Invalid group id" });
    database.deleteGroup(id);
    return reply.code(204).send();
  });
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
      const results = [];
      for (const containerId of containerIds) {
        const container = containerById.get(containerId);
        if (!container) throw new Error(`Container ${containerId.slice(0, 12)} is no longer deployed`);
        let fileName = container.fileName;
        let backupFile = "";
        let oldIcon = container.icon;
        let templateCreated = false;
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
          await invalidateUnraidIconCache(config, container.name);
        } catch (error) {
          if (fileName) {
            if (templateCreated) await removeGeneratedTemplate(config, fileName, icon).catch(() => undefined);
            else if (backupFile) await restoreTemplate(config, fileName, backupFile).catch(() => undefined);
          }
          throw error;
        }
        results.push(database.addAudit({ containerName: container.name, templateFile: fileName, oldIcon, newIcon: icon, backupFile, templateCreated, createdAt: new Date().toISOString(), result: "applied" }));
      }
      return { results, refreshUrl: config.unraidDockerUrl, notice: "图标已保存且 Unraid 缓存已清除；请点击刷新按钮查看。容器没有重启或重建。" };
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
        await invalidateUnraidIconCache(config, container.name);
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
      if (audit.templateCreated) await removeGeneratedTemplate(config, audit.templateFile, audit.newIcon);
      else await restoreTemplate(config, audit.templateFile, audit.backupFile);
      await invalidateUnraidIconCache(config, audit.containerName);
      return database.addAudit({ containerName: audit.containerName, templateFile: audit.templateFile, oldIcon: audit.newIcon, newIcon: audit.oldIcon, backupFile: audit.backupFile, templateCreated: false, createdAt: new Date().toISOString(), result: "restored" });
    } catch (error) { return reply.code(httpError(error).statusCode).send(httpError(error)); }
  });

  if (existsSync(clientRoot)) {
    void app.register(fastifyStatic, { root: clientRoot, wildcard: false });
    app.get("/*", async (_request, reply) => reply.sendFile("index.html"));
  }
  return app;
}
