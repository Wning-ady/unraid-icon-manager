import { constants, createReadStream, existsSync, readFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import type { AppConfig, UiSettings } from "./types.js";
import { AppDatabase } from "./database.js";
import { listManagedContainers } from "./container-service.js";
import { createGeneratedTemplate, getTemplate, listTemplates, removeGeneratedTemplate, restoreTemplate, updateTemplateIcon } from "./template-service.js";
import { deleteStoredIcon, listStoredIcons, storeUploadedIcon } from "./icon-service.js";
import { validateIconUrl } from "./icon-validation.js";
import { downloadRemoteImage } from "./remote-image-service.js";
import { deleteWallpaper, listWallpaperFiles, storeWallpaper, wallpaperPath } from "./wallpaper-service.js";
import { findUnraidIconCache, invalidateUnraidIconCache, mutateUnraidIconCache, resolveOwnUploadedIconPng, restoreUnraidIconCache, snapshotUnraidIconCache, writeUnraidIconCache } from "./unraid-cache-service.js";
import { synchronizeContainerIcon } from "./container-sync-service.js";
import { listVirtualMachines, updateVirtualMachineIcon } from "./vm-service.js";

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
  if (!config.publicBaseUrl) throw new Error("PUBLIC_BASE_URL 必须配置为 Unraid 主机可访问的本工具地址");
  return `${publicBaseUrl(config, request)}/api/icons/file/${fileName}`;
}

function ownIconFile(config: AppConfig, value: string): string | null {
  const icon = value.trim();
  let path = icon;
  try { if (/^https?:\/\//i.test(icon)) path = new URL(icon).pathname; } catch { return null; }
  const fileName = path.split("/").pop() ?? "";
  return /^[a-f0-9]{64}\.png$/.test(fileName) && existsSync(join(config.iconsDir, fileName)) ? fileName : null;
}

export function createApp(config: AppConfig, dependencies: { listManagedContainers?: typeof listManagedContainers; downloadRemoteImage?: typeof downloadRemoteImage; synchronizeContainerIcon?: typeof synchronizeContainerIcon } = {}) {
  const bodyBytes = Math.max(config.maxUploadBytes, config.maxWallpaperBytes ?? config.maxUploadBytes);
  const app = Fastify({ logger: true, bodyLimit: Math.ceil(bodyBytes * 4 / 3) + 16_384 });
  const database = new AppDatabase(config);
  const clientRoot = join(process.cwd(), "dist/client");
  const listContainers = dependencies.listManagedContainers ?? listManagedContainers;
  const downloadImage = dependencies.downloadRemoteImage ?? downloadRemoteImage;
  const syncIcon = dependencies.synchronizeContainerIcon ?? synchronizeContainerIcon;
  let iconMutationTail = Promise.resolve();
  async function withIconMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = iconMutationTail;
    let release!: () => void;
    iconMutationTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }
  let appVersion = "dev";
  try { appVersion = (JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { version?: string }).version ?? appVersion; } catch { /* Development fallback. */ }

  app.addHook("onClose", () => database.close());
  app.get("/api/health", async () => ({
    ok: true,
    templatesDir: config.templatesDir,
    templatesWritable: existsSync(config.templatesDir),
    iconCachesMounted: Boolean(config.iconCacheDir && config.iconCacheRamDir && existsSync(config.iconCacheDir) && existsSync(config.iconCacheRamDir))
  }));
  app.get("/api/about", async () => ({ version: appVersion, githubUrl: "https://github.com/Wning-ady/unraid-icon-manager",
    iconHostRoot: config.iconHostRoot, iconContainerRoot: "/config/icons",
    wallpaperHostRoot: config.wallpaperHostRoot ?? join(config.configDir, "wallpapers"), wallpaperContainerRoot: "/config/wallpapers" }));
  app.get("/api/ui-settings", async () => database.getUiSettings());
  app.patch("/api/ui-settings", async (request, reply) => {
    try {
      const body = request.body;
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("设置必须是 JSON 对象");
      const patch = body as Record<string, unknown>;
      const allowed = new Set(["theme", "wallpaperFileName", "glassBlur", "surfaceOpacity"]);
      if (Object.keys(patch).some((key) => !allowed.has(key))) throw new Error("包含未知的 UI 设置字段");
      const current = database.getUiSettings();
      const next: UiSettings = { ...current };
      if ("theme" in patch) {
        if (patch.theme !== "light" && patch.theme !== "dark") throw new Error("theme 必须是 light 或 dark");
        next.theme = patch.theme;
      }
      if ("wallpaperFileName" in patch) {
        if (patch.wallpaperFileName !== null && typeof patch.wallpaperFileName !== "string") throw new Error("wallpaperFileName 必须是字符串或 null");
        if (typeof patch.wallpaperFileName === "string") {
          if (!/^[a-f0-9]{64}\.(?:png|jpg|webp)$/.test(patch.wallpaperFileName) || !existsSync(wallpaperPath(config, patch.wallpaperFileName))) {
            throw new Error("壁纸不存在");
          }
        }
        next.wallpaperFileName = patch.wallpaperFileName;
      }
      if ("glassBlur" in patch) {
        if (!Number.isInteger(patch.glassBlur) || (patch.glassBlur as number) < 0 || (patch.glassBlur as number) > 30) {
          throw new Error("glassBlur 必须是 0 到 30 的整数");
        }
        next.glassBlur = patch.glassBlur as number;
      }
      if ("surfaceOpacity" in patch) {
        if (!Number.isInteger(patch.surfaceOpacity) || (patch.surfaceOpacity as number) < 0 || (patch.surfaceOpacity as number) > 100) {
          throw new Error("surfaceOpacity 必须是 0 到 100 的整数");
        }
        next.surfaceOpacity = patch.surfaceOpacity as number;
      }
      return database.updateUiSettings(next);
    } catch (error) { return reply.code(400).send(httpError(error)); }
  });
  app.get("/api/containers", async () => listContainers(config));
  app.get("/api/vms", async () => listVirtualMachines(config));
  app.get("/api/vms/icon/:fileName", async (request, reply) => {
    const fileName = (request.params as { fileName: string }).fileName;
    if (!/^[A-Za-z0-9_.-]+$/.test(fileName)) return reply.code(404).send({ message: "VM 图标不存在" });
    try {
      const handle = await open(join(config.vmIconsDir ?? "/unraid/vm-icons", fileName), constants.O_RDONLY | constants.O_NOFOLLOW);
      if (!(await handle.stat()).isFile()) { await handle.close(); return reply.code(404).send({ message: "VM 图标不存在" }); }
      return reply.type("image/png").send(handle.createReadStream());
    } catch { return reply.code(404).send({ message: "VM 图标不存在" }); }
  });
  app.post("/api/vms/:vmId/icon", async (request, reply) => {
    try {
      const vmId = (request.params as { vmId: string }).vmId;
      const body = request.body as { icon?: unknown };
      if (typeof body.icon !== "string" || !body.icon.trim()) throw new Error("图标不能为空");
      let fileName = ownIconFile(config, body.icon);
      if (!fileName) {
        const content = await downloadImage(validateIconUrl(body.icon.trim()), config.maxUploadBytes);
        fileName = (await storeUploadedIcon(config, content)).fileName;
      }
      database.ensureIconAsset(fileName);
      const vm = await updateVirtualMachineIcon(config, vmId, join(config.iconsDir, fileName), fileName);
      return { vm, icon: uploadedIconUrl(config, request, fileName), refreshUrl: config.unraidVmUrl, notice: `已更新虚拟机 ${vm.name} 的图标，无需重启虚拟机。` };
    } catch (error) { return reply.code(httpError(error).statusCode).send(httpError(error)); }
  });
  app.get("/api/containers/icon-cache/:containerName", async (request, reply) => {
    try {
      const containerName = (request.params as { containerName: string }).containerName;
      const cachePath = await findUnraidIconCache(config, containerName);
      if (!cachePath) return reply.code(404).send({ message: "Container icon cache not found" });
      return reply.header("cache-control", "no-cache").type("image/png").send(createReadStream(cachePath));
    } catch (error) { return reply.code(httpError(error).statusCode).send(httpError(error)); }
  });
  app.get("/api/audits", async () => database.listAudits());

  app.post("/api/icons/upload", async (request, reply) => {
    try {
      const body = request.body as { contentBase64?: unknown; groupId?: unknown };
      if (typeof body?.contentBase64 !== "string") throw new Error("contentBase64 is required");
      const content = body.contentBase64.replace(/^data:[^;]+;base64,/, "");
      const result = await storeUploadedIcon(config, Buffer.from(content, "base64"));
      if (body.groupId !== undefined) database.setIconGroup(result.fileName, body.groupId === null ? null : Number(body.groupId));
      else database.ensureIconAsset(result.fileName);
      return reply.code(201).send({ ...result, icon: uploadedIconUrl(config, request, result.fileName), previewUrl: `/api/icons/file/${result.fileName}` });
    } catch (error) { return reply.code(httpError(error).statusCode).send(httpError(error)); }
  });

  app.get("/api/icon-groups", async () => database.listIconGroups());
  app.post("/api/icon-groups", async (request, reply) => {
    try {
      const body = request.body as { name?: unknown };
      if (typeof body?.name !== "string") throw new Error("分组名称不能为空");
      return reply.code(201).send(database.addIconGroup(body.name));
    } catch (error) { return reply.code(400).send(httpError(error)); }
  });
  app.get("/api/icons", async (request) => listStoredIcons(config, publicBaseUrl(config, request), database.iconGroupMap()));

  app.patch("/api/icons/:fileName", async (request, reply) => {
    try {
      const fileName = (request.params as { fileName: string }).fileName;
      if (!/^[a-f0-9]{64}\.png$/.test(fileName) || !existsSync(join(config.iconsDir, fileName))) throw new Error("图标不存在");
      const body = request.body as { groupId?: unknown };
      const groupId = body.groupId === null ? null : Number(body.groupId);
      database.setIconGroup(fileName, groupId);
      return { ok: true };
    } catch (error) { return reply.code(400).send(httpError(error)); }
  });

  app.delete("/api/icons/:fileName", async (request, reply) => {
    try {
      await withIconMutation(async () => {
        const fileName = (request.params as { fileName: string }).fileName;
        if (!/^[a-f0-9]{64}\.png$/.test(fileName)) throw new Error("Invalid icon file name");
        const referenced = (value: string | null) => Boolean(value && value.includes(fileName));
        const templateReferences = (await listTemplates(config)).filter((template) => referenced(template.icon));
        const auditReferences = database.countIconReferences(fileName);
        if (templateReferences.length || auditReferences) {
          const error = new Error(`该图标仍被 ${templateReferences.length} 个模板和 ${auditReferences} 条变更记录引用，不能删除`) as Error & { statusCode: number };
          error.statusCode = 409; throw error;
        }
        await deleteStoredIcon(config, fileName);
        database.removeIcon(fileName);
      });
      return reply.code(204).send();
    } catch (error) { const detail = httpError(error); return reply.code((error as { statusCode?: number }).statusCode ?? detail.statusCode).send(detail); }
  });

  app.get("/api/icons/file/:fileName", async (request, reply) => {
    const fileName = (request.params as { fileName: string }).fileName;
    if (!/^[a-f0-9]{64}\.png$/.test(fileName)) return reply.code(400).send({ message: "Invalid icon file name" });
    const filePath = join(config.iconsDir, fileName);
    try {
      const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      if (!(await handle.stat()).isFile()) { await handle.close(); return reply.code(404).send({ message: "Icon file not found" }); }
      return reply.type("image/png").send(handle.createReadStream());
    } catch { return reply.code(404).send({ message: "Icon file not found" }); }
  });

  app.post("/api/icons/apply", async (request, reply) => {
    return withIconMutation(async () => { try {
      const body = request.body as { containerIds?: unknown; icon?: unknown };
      const containerIds = stringArray(body.containerIds, "containerIds");
      if (!containerIds.length) throw new Error("Select at least one container");
      if (typeof body.icon !== "string" || !body.icon.trim()) throw new Error("icon is required");
      const containers = (await listContainers(config)).containers;
      const containerById = new Map(containers.map((container) => [container.id, container]));
      const targets = [...new Set(containerIds)].map((containerId) => {
        const container = containerById.get(containerId);
        if (!container) throw new Error(`Container ${containerId.slice(0, 12)} is no longer deployed`);
        return container;
      });
      const existingFile = ownIconFile(config, body.icon);
      let fileName = existingFile;
      if (!fileName) {
        const remoteUrl = validateIconUrl(body.icon.trim());
        const downloaded = await downloadImage(remoteUrl, config.maxUploadBytes);
        fileName = (await storeUploadedIcon(config, downloaded)).fileName;
      }
      database.ensureIconAsset(fileName);
      const icon = uploadedIconUrl(config, request, fileName);
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
          auditRecord = database.addAudit({ containerName: container.name, templateFile: fileName, oldIcon, newIcon: icon, backupFile, cacheBackup, revertsAuditId: null, revertedByAuditId: null, templateCreated, createdAt: new Date().toISOString(), result: "applied" });
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
      return { results, icon, refreshUrl: config.unraidDockerUrl, notice: "图标已下载到图库（或确认已在图库中），并保存到模板和缓存。要让 Unraid WebGUI 与 Compose Manager 使用新的运行标签，请点击下方同步按钮。" };
    } catch (error) { return reply.code(httpError(error).statusCode).send(httpError(error)); } });
  });

  app.get("/api/wallpaper-groups", async () => database.listWallpaperGroups());
  app.post("/api/wallpaper-groups", async (request, reply) => {
    try {
      const body = request.body as { name?: unknown };
      if (typeof body?.name !== "string") throw new Error("分组名称不能为空");
      return reply.code(201).send(database.addWallpaperGroup(body.name));
    } catch (error) { return reply.code(400).send(httpError(error)); }
  });
  app.get("/api/wallpapers", async (request) => listWallpaperFiles(config, publicBaseUrl(config, request), database.wallpaperGroupMap()));
  app.post("/api/wallpapers/upload", async (request, reply) => {
    try {
      const body = request.body as { contentBase64?: unknown; groupId?: unknown };
      if (typeof body?.contentBase64 !== "string") throw new Error("contentBase64 is required");
      const content = body.contentBase64.replace(/^data:[^;]+;base64,/, "");
      const stored = await storeWallpaper(config, Buffer.from(content, "base64"));
      const groupId = body.groupId === null || body.groupId === undefined ? null : Number(body.groupId);
      database.setWallpaperGroup(stored.fileName, groupId);
      return reply.code(201).send(stored);
    } catch (error) { return reply.code(400).send(httpError(error)); }
  });
  app.post("/api/wallpapers/import", async (request, reply) => {
    try {
      const body = request.body as { url?: unknown; groupId?: unknown };
      if (typeof body?.url !== "string" || !body.url.trim()) throw new Error("壁纸 URL 不能为空");
      const content = await downloadImage(validateIconUrl(body.url.trim()), config.maxWallpaperBytes ?? config.maxUploadBytes);
      const stored = await storeWallpaper(config, content);
      const groupId = body.groupId === null || body.groupId === undefined ? null : Number(body.groupId);
      database.setWallpaperGroup(stored.fileName, groupId);
      return reply.code(201).send(stored);
    } catch (error) { return reply.code(400).send(httpError(error)); }
  });
  app.patch("/api/wallpapers/:fileName", async (request, reply) => {
    try {
      const fileName = (request.params as { fileName: string }).fileName;
      if (!/^[a-f0-9]{64}\.(?:png|jpg|webp)$/.test(fileName) || !existsSync(wallpaperPath(config, fileName))) throw new Error("壁纸不存在");
      const body = request.body as { groupId?: unknown };
      const groupId = body.groupId === null ? null : Number(body.groupId);
      database.setWallpaperGroup(fileName, groupId); return { ok: true };
    } catch (error) { return reply.code(400).send(httpError(error)); }
  });
  app.delete("/api/wallpapers/:fileName", async (request, reply) => {
    try { const fileName = (request.params as { fileName: string }).fileName; await deleteWallpaper(config, fileName); database.removeWallpaper(fileName); return reply.code(204).send(); }
    catch (error) { return reply.code(400).send(httpError(error)); }
  });
  app.get("/api/wallpapers/file/:fileName", async (request, reply) => {
    const fileName = (request.params as { fileName: string }).fileName;
    if (!/^[a-f0-9]{64}\.(?:png|jpg|webp)$/.test(fileName)) return reply.code(404).send({ message: "壁纸不存在" });
    const extension = fileName.split(".").pop();
    if ((request.query as { download?: string }).download === "1") reply.header("content-disposition", `attachment; filename="${fileName}"`);
    try {
      const handle = await open(wallpaperPath(config, fileName), constants.O_RDONLY | constants.O_NOFOLLOW);
      if (!(await handle.stat()).isFile()) { await handle.close(); return reply.code(404).send({ message: "壁纸不存在" }); }
      return reply.type(extension === "jpg" ? "image/jpeg" : `image/${extension}`).send(handle.createReadStream());
    } catch { return reply.code(404).send({ message: "壁纸不存在" }); }
  });

  app.post("/api/unraid/refresh", async (request, reply) => {
    return withIconMutation(async () => { try {
      const body = request.body as { containerIds?: unknown };
      const containerIds = stringArray(body.containerIds, "containerIds");
      if (!containerIds.length) throw new Error("Select at least one container");
      const containers = (await listContainers(config)).containers;
      const byId = new Map(containers.map((container) => [container.id, container]));
      const results = [];
      for (const id of containerIds) {
        const container = byId.get(id);
        if (!container) throw new Error(`Container ${id.slice(0, 12)} is no longer deployed`);
        if (!container.icon) throw new Error(`${container.name} 没有已保存的图标，无法同步`);
        if (container.icon?.startsWith("http://") || container.icon?.startsWith("https://")) {
          const png = await resolveOwnUploadedIconPng(config, container.icon);
          if (png) await writeUnraidIconCache(config, container.name, png);
          else await invalidateUnraidIconCache(config, container.name);
        } else {
          await invalidateUnraidIconCache(config, container.name);
        }
        results.push(await syncIcon(config, container, container.icon));
      }
      const recreated = results.filter((result) => result.recreated).length;
      const composeUpdated = results.filter((result) => result.composeOverrideUpdated).length;
      return { url: config.unraidDockerUrl, results,
        notice: `同步完成：重建 ${recreated} 个容器${composeUpdated ? `，更新 ${composeUpdated} 个 Compose Manager override` : ""}。数据卷和其他容器未变更。` };
    } catch (error) { return reply.code(httpError(error).statusCode).send(httpError(error)); } });
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
        restored = database.addAudit({ containerName: audit.containerName, templateFile: audit.templateFile, oldIcon: audit.newIcon, newIcon: audit.oldIcon, backupFile: audit.backupFile, cacheBackup: null, revertsAuditId: audit.id, revertedByAuditId: null, templateCreated: false, createdAt: new Date().toISOString(), result: "restored" });
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
