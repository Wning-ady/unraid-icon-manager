import Docker from "dockerode";
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import type { AppConfig, IconSyncResult, ManagedContainer } from "./types.js";

const ICON_LABEL = "net.unraid.docker.icon";
const COMPOSE_SERVICE_LABEL = "com.docker.compose.service";
const COMPOSE_WORKING_DIR_LABEL = "com.docker.compose.project.working_dir";

interface ComposeOverrideMutation {
  target: string;
  backupFile: string | null;
  created: boolean;
}

interface DockerContainerLike {
  inspect(): Promise<any>;
  stop(options?: Record<string, unknown>): Promise<unknown>;
  remove(options?: Record<string, unknown>): Promise<unknown>;
  start(): Promise<unknown>;
}

interface DockerLike {
  getContainer(id: string): DockerContainerLike;
  createContainer(options: Record<string, unknown>): Promise<DockerContainerLike & { id?: string }>;
}

function inside(base: string, candidate: string): boolean {
  const path = relative(resolve(base), resolve(candidate));
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function quoteYaml(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function findServiceRange(lines: string[], service: string): { start: number; end: number } {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(service)) throw new Error("Compose service name is unsafe");
  const servicesIndex = lines.findIndex((line) => /^services:\s*(?:#.*)?$/.test(line));
  if (servicesIndex < 0) throw new Error("Compose override has no services mapping");
  const servicePattern = new RegExp(`^  ${service.replaceAll(".", "\\.")}:\\s*(?:#.*)?$`);
  const start = lines.findIndex((line, index) => index > servicesIndex && servicePattern.test(line));
  if (start < 0) throw new Error(`Compose override has no service named ${service}`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^ {2}\S/.test(lines[index]) || /^\S/.test(lines[index])) { end = index; break; }
  }
  return { start, end };
}

/** Updates only one Compose Manager service label while preserving every unrelated line. */
export function updateComposeOverrideText(source: string, service: string, icon: string): string {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const trailingNewline = source.endsWith("\n");
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  if (trailingNewline) lines.pop();
  const range = findServiceRange(lines, service);
  const labelsIndex = lines.findIndex((line, index) => index > range.start && index < range.end && /^ {4}labels:\s*(?:#.*)?$/.test(line));
  const nextLabel = `      ${ICON_LABEL}: ${quoteYaml(icon)}`;
  if (labelsIndex < 0) {
    lines.splice(range.start + 1, 0, "    labels:", nextLabel);
  } else {
    let labelsEnd = range.end;
    for (let index = labelsIndex + 1; index < range.end; index += 1) {
      if (/^ {4}\S/.test(lines[index]) || /^ {2}\S/.test(lines[index]) || /^\S/.test(lines[index])) { labelsEnd = index; break; }
    }
    const iconIndex = lines.findIndex((line, index) => index > labelsIndex && index < labelsEnd && /^ {6}net\.unraid\.docker\.icon\s*:/.test(line));
    if (iconIndex >= 0) lines[iconIndex] = nextLabel;
    else lines.splice(labelsIndex + 1, 0, nextLabel);
  }
  return `${lines.join(newline)}${trailingNewline ? newline : ""}`;
}

async function atomicWrite(target: string, contents: string): Promise<void> {
  const temporary = join(dirname(target), `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, contents, { flag: "wx" });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function updateComposeOverride(config: AppConfig, labels: Record<string, string>, icon: string): Promise<ComposeOverrideMutation> {
  if (!config.composeProjectsDir || !config.composeHostRoot) {
    throw new Error("Compose Manager 项目目录未挂载；请配置 COMPOSE_PROJECTS_DIR、COMPOSE_HOST_ROOT 和只限项目根目录的读写挂载");
  }
  const workingDir = labels[COMPOSE_WORKING_DIR_LABEL];
  const service = labels[COMPOSE_SERVICE_LABEL];
  if (!workingDir || !service || !inside(config.composeHostRoot, workingDir)) throw new Error("Compose Manager 项目路径或服务标签无效");
  const relativeProject = relative(resolve(config.composeHostRoot), resolve(workingDir));
  const projectsRoot = await realpath(config.composeProjectsDir);
  const projectDir = join(projectsRoot, relativeProject);
  const realProjectDir = await realpath(projectDir);
  if (!inside(projectsRoot, realProjectDir)) throw new Error("Compose Manager 项目路径逃逸挂载根目录");
  const target = join(realProjectDir, "docker-compose.override.yml");
  let source: string;
  let created = false;
  try {
    const metadata = await lstat(target);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("Compose override 必须是普通文件");
    source = await readFile(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    source = `services:\n  ${service}:\n    labels:\n`;
    created = true;
  }
  const next = updateComposeOverrideText(source, service, icon);
  if (next === source) return { target, backupFile: null, created: false };
  let backupFile: string | null = null;
  if (!created) {
    await mkdir(config.backupsDir, { recursive: true });
    const backupDir = await mkdtemp(join(config.backupsDir, `compose-${service}-${Date.now()}-`));
    backupFile = join(backupDir, "docker-compose.override.yml");
    await writeFile(backupFile, source, { flag: "wx" });
  }
  await atomicWrite(target, next);
  return { target, backupFile, created };
}

async function restoreComposeOverride(mutation: ComposeOverrideMutation): Promise<void> {
  if (mutation.created) await rm(mutation.target, { force: true });
  else if (mutation.backupFile) await atomicWrite(mutation.target, await readFile(mutation.backupFile, "utf8"));
}

function createOptionsFromInspect(info: any, icon: string | null): Record<string, unknown> {
  const config = structuredClone(info.Config ?? {});
  if (config.Hostname === String(info.Id).slice(0, 12)) config.Hostname = "";
  config.Labels = { ...(config.Labels ?? {}) };
  if (icon === null) delete config.Labels[ICON_LABEL];
  else config.Labels[ICON_LABEL] = icon;
  const hostConfig = structuredClone(info.HostConfig ?? {});
  const bindTargets = new Set<string>((hostConfig.Binds ?? []).map((bind: string) => bind.split(":").at(-2) ?? ""));
  const preservedVolumes = (info.Mounts ?? [])
    .filter((mount: any) => mount.Type === "volume" && mount.Name && !bindTargets.has(mount.Destination))
    .map((mount: any) => ({ Type: "volume", Source: mount.Name, Target: mount.Destination, ReadOnly: !mount.RW }));
  if (preservedVolumes.length) hostConfig.Mounts = [...(hostConfig.Mounts ?? []), ...preservedVolumes];
  const endpoints: Record<string, unknown> = {};
  if (!String(hostConfig.NetworkMode ?? "").startsWith("container:")) {
    for (const [networkName, network] of Object.entries(info.NetworkSettings?.Networks ?? {}) as Array<[string, any]>) {
      endpoints[networkName] = {
        IPAMConfig: network.IPAMConfig ?? undefined,
        Links: network.Links ?? undefined,
        Aliases: network.Aliases ?? undefined,
        MacAddress: network.MacAddress || undefined,
        DriverOpts: network.DriverOpts ?? undefined
      };
    }
  }
  return { ...config, name: String(info.Name ?? "").replace(/^\//, ""), HostConfig: hostConfig,
    NetworkingConfig: Object.keys(endpoints).length ? { EndpointsConfig: endpoints } : undefined };
}

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }

/** Recreates exactly one selected container so its immutable icon label becomes current. */
export async function recreateContainerWithIcon(docker: DockerLike, containerId: string, icon: string): Promise<{ id: string }> {
  const original = docker.getContainer(containerId);
  const info = await original.inspect();
  const wasRunning = Boolean(info.State?.Running);
  const originalOptions = createOptionsFromInspect(info, info.Config?.Labels?.[ICON_LABEL] ?? null);
  const nextOptions = createOptionsFromInspect(info, icon);
  let replacement: (DockerContainerLike & { id?: string }) | null = null;
  let originalRemoved = false;
  try {
    if (wasRunning) await original.stop({ t: 15 });
    await original.remove({ v: false, force: true });
    originalRemoved = true;
    replacement = await docker.createContainer(nextOptions);
    if (wasRunning) await replacement.start();
    const current = await replacement.inspect();
    if (current.Config?.Labels?.[ICON_LABEL] !== icon) throw new Error("容器重建后图标标签未更新");
    return { id: String(current.Id ?? replacement.id ?? "") };
  } catch (error) {
    const recoveryErrors: unknown[] = [];
    if (replacement) {
      try { await replacement.remove({ v: false, force: true }); } catch (recoveryError) { recoveryErrors.push(recoveryError); }
    }
    try {
      if (originalRemoved) {
        const restored = await docker.createContainer(originalOptions);
        if (wasRunning) await restored.start();
      } else if (wasRunning) {
        const currentState = await original.inspect();
        if (!currentState.State?.Running) await original.start();
      }
    } catch (recoveryError) { recoveryErrors.push(recoveryError); }
    const recovery = recoveryErrors.map(errorText).join("; ");
    throw new Error(recovery ? `重建容器失败：${errorText(error)}；自动恢复也失败：${recovery}` : `重建容器失败，已自动恢复原容器：${errorText(error)}`);
  }
}

export async function synchronizeContainerIcon(config: AppConfig, container: ManagedContainer, icon: string): Promise<IconSyncResult> {
  if (container.name === "unraid-icon-manager") {
    return { containerName: container.name, containerId: container.id, recreated: false, composeOverrideUpdated: false };
  }
  const docker = new Docker({ socketPath: "/var/run/docker.sock" }) as unknown as DockerLike;
  const inspected = await docker.getContainer(container.id).inspect();
  const labels = (inspected.Config?.Labels ?? {}) as Record<string, string>;
  let composeMutation: ComposeOverrideMutation | null = null;
  try {
    if (container.composeManaged) composeMutation = await updateComposeOverride(config, labels, icon);
    const replacement = await recreateContainerWithIcon(docker, container.id, icon);
    return { containerName: container.name, containerId: replacement.id, recreated: true, composeOverrideUpdated: Boolean(composeMutation) };
  } catch (error) {
    if (composeMutation) {
      try { await restoreComposeOverride(composeMutation); }
      catch (restoreError) { throw new Error(`${errorText(error)}；Compose override 自动恢复失败：${errorText(restoreError)}`); }
    }
    throw error;
  }
}
