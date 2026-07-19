import { createReadStream, existsSync } from "node:fs";
import { join } from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import type { AppConfig } from "./types.js";
import { AppDatabase } from "./database.js";
import { listManagedContainers } from "./container-service.js";
import { restoreTemplate, updateTemplateIcon } from "./template-service.js";
import { storeUploadedIcon } from "./icon-service.js";
import { validateIconUrl } from "./icon-validation.js";

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) throw new Error(`${label} must be a string array`);
  return value;
}

function httpError(error: unknown): { statusCode: number; message: string } {
  return { statusCode: 400, message: error instanceof Error ? error.message : "Invalid request" };
}

export function createApp(config: AppConfig, dependencies: { listManagedContainers?: typeof listManagedContainers } = {}) {
  const app = Fastify({ logger: true, bodyLimit: config.maxUploadBytes + 16_384 });
  const database = new AppDatabase(config);
  const clientRoot = join(process.cwd(), "dist/client");
  const listContainers = dependencies.listManagedContainers ?? listManagedContainers;

  app.addHook("onClose", () => database.close());
  app.get("/api/health", async () => ({ ok: true, templatesDir: config.templatesDir, templatesWritable: existsSync(config.templatesDir) }));
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
      return reply.code(201).send(result);
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
      const body = request.body as { templateFiles?: unknown; icon?: unknown };
      const templateFiles = stringArray(body.templateFiles, "templateFiles");
      if (!templateFiles.length) throw new Error("Select at least one container");
      if (typeof body.icon !== "string" || !body.icon.trim()) throw new Error("icon is required");
      const icon = body.icon.startsWith("/") ? body.icon : validateIconUrl(body.icon);
      const templates = (await listContainers(config)).containers;
      const templateByFile = new Map(templates.filter((template) => template.editable && template.fileName).map((template) => [template.fileName!, template]));
      const results = [];
      for (const fileName of templateFiles) {
        const template = templateByFile.get(fileName);
        if (!template) throw new Error(`Template ${fileName} is not attached to a deployed, editable container`);
        const update = await updateTemplateIcon(config, fileName, icon);
        results.push(database.addAudit({ containerName: template.name, templateFile: fileName, oldIcon: update.oldIcon, newIcon: icon, backupFile: update.backupFile, createdAt: new Date().toISOString(), result: "applied" }));
      }
      return { results, notice: "Templates were updated. Refresh the Unraid Docker page; no containers were restarted." };
    } catch (error) { return reply.code(httpError(error).statusCode).send(httpError(error)); }
  });

  app.post("/api/audits/:id/restore", async (request, reply) => {
    try {
      const id = Number((request.params as { id: string }).id);
      const audit = database.getAudit(id);
      if (!audit) return reply.code(404).send({ message: "Audit record not found" });
      const currentTemplates = await listContainers(config);
      const stillEditable = currentTemplates.containers.some((container) => container.editable && container.fileName === audit.templateFile);
      if (!stillEditable) throw new Error("Template is not attached to a deployed, editable container");
      await restoreTemplate(config, audit.templateFile, audit.backupFile);
      return database.addAudit({ containerName: audit.containerName, templateFile: audit.templateFile, oldIcon: audit.newIcon, newIcon: audit.oldIcon, backupFile: audit.backupFile, createdAt: new Date().toISOString(), result: "restored" });
    } catch (error) { return reply.code(httpError(error).statusCode).send(httpError(error)); }
  });

  if (existsSync(clientRoot)) {
    void app.register(fastifyStatic, { root: clientRoot, wildcard: false });
    app.get("/*", async (_request, reply) => reply.sendFile("index.html"));
  }
  return app;
}
