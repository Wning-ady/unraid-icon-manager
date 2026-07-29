import Docker from "dockerode";
import type { AppConfig, ManagedContainer } from "./types.js";
import { associateManagedContainers, type DockerSummary } from "./container-association.js";
import { listTemplates } from "./template-service.js";
import { findUnraidIconCache } from "./unraid-cache-service.js";

/** Resolves only the explicit icon label Unraid itself renders for this container. */
export function resolveUnraidLabelIcon(unraidDockerUrl: string | undefined, rawIcon: string | undefined, containerName?: string): string | null {
  if (!rawIcon) return null;
  try {
    const icon = new URL(rawIcon);
    if (icon.protocol === "http:" || icon.protocol === "https:") {
      if (unraidDockerUrl && containerName && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(containerName)) {
        try {
          const dockerPage = new URL(unraidDockerUrl);
          return new URL(`/state/plugins/dynamix.docker.manager/images/${encodeURIComponent(containerName)}-icon.png`, dockerPage.origin).toString();
        } catch { /* A relative Docker page URL cannot provide an Unraid origin. */ }
      }
      return icon.toString();
    }
  } catch { /* Local Unraid paths are handled below. */ }
  if (!unraidDockerUrl || !rawIcon.startsWith("/mnt/user/") || rawIcon.includes("\\")) return null;
  const segments = rawIcon.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) return null;
  try {
    const dockerPage = new URL(unraidDockerUrl);
    return new URL(rawIcon, dockerPage.origin).toString();
  } catch { return null; }
}

export type ContainerAction = "start" | "restart";

export interface ContainerActionResult {
  containerId: string;
  containerName: string;
  action: ContainerAction;
  changed: boolean;
  notice: string;
}

interface ActionContainerLike {
  inspect(): Promise<{ State?: { Running?: boolean } }>;
  start(): Promise<unknown>;
  restart(options?: Record<string, unknown>): Promise<unknown>;
}

interface ActionDockerLike {
  getContainer(id: string): ActionContainerLike;
}

/** Starts or restarts one currently deployed container selected by immutable Docker id. */
export async function performContainerAction(
  container: ManagedContainer,
  action: ContainerAction,
  docker: ActionDockerLike = new Docker({ socketPath: "/var/run/docker.sock" })
): Promise<ContainerActionResult> {
  const target = docker.getContainer(container.id);
  const current = await target.inspect();
  if (action === "start") {
    if (current.State?.Running) {
      return { containerId: container.id, containerName: container.name, action, changed: false, notice: `${container.name} 已在运行` };
    }
    await target.start();
    return { containerId: container.id, containerName: container.name, action, changed: true, notice: `${container.name} 已启动` };
  }
  if (!current.State?.Running) {
    const error = new Error(`${container.name} 当前不是运行中，无法执行重启；请先启动`) as Error & { statusCode: number };
    error.statusCode = 409;
    throw error;
  }
  await target.restart({ t: 15 });
  return { containerId: container.id, containerName: container.name, action, changed: true, notice: `${container.name} 已重启` };
}

export function resolveContainerDisplayIcon(
  unraidDockerUrl: string | undefined,
  containerName: string,
  rawLabelIcon: string | undefined,
  cacheAvailable: boolean
): Pick<ManagedContainer, "displayIcon" | "displayIconSource"> {
  const labelIcon = resolveUnraidLabelIcon(unraidDockerUrl, rawLabelIcon, containerName);
  if (labelIcon && cacheAvailable) {
    return { displayIcon: `/api/containers/icon-cache/${encodeURIComponent(containerName)}`, displayIconSource: "unraid-cache" };
  }
  if (labelIcon) return { displayIcon: labelIcon, displayIconSource: "unraid-label" };
  return { displayIcon: null, displayIconSource: null };
}

export async function listManagedContainers(config: AppConfig): Promise<{ containers: ManagedContainer[]; dockerAvailable: boolean }> {
  const templates = await listTemplates(config);
  let summaries: DockerSummary[] = [];
  const imageLabels = new Map<string, Record<string, string>>();
  let dockerAvailable = true;
  try {
    const docker = new Docker({ socketPath: "/var/run/docker.sock" });
    summaries = await docker.listContainers({ all: true }) as DockerSummary[];
    const associated = associateManagedContainers(templates, summaries);
    const images = [...new Set(associated.filter((container) => !container.icon).map((container) => container.image))];
    for (let offset = 0; offset < images.length; offset += 4) {
      await Promise.all(images.slice(offset, offset + 4).map(async (image) => {
        try {
          const inspected = await docker.getImage(image).inspect();
          if (inspected.Config?.Labels) imageLabels.set(image, inspected.Config.Labels);
        } catch { /* A missing local image must not hide the deployed container. */ }
      }));
    }
  } catch {
    dockerAvailable = false;
  }
  const containers = dockerAvailable ? associateManagedContainers(templates, summaries, imageLabels) : [];
  const summariesById = new Map(summaries.map((summary) => [summary.Id, summary]));
  await Promise.all(containers.map(async (container) => {
    const rawLabelIcon = summariesById.get(container.id)?.Labels?.["net.unraid.docker.icon"];
    // A template or stale cache is not proof that the running container still
    // carries the immutable label Unraid needs after an image update.
    const liveIcon = resolveContainerDisplayIcon(
      config.unraidDockerUrl,
      container.name,
      rawLabelIcon,
      Boolean(await findUnraidIconCache(config, container.name))
    );
    Object.assign(container, liveIcon);
    container.iconNeedsSync = Boolean(container.icon && (!rawLabelIcon || rawLabelIcon !== container.icon));
    // Keep a saved template icon visible in the manager while clearly marking
    // that Unraid's live Docker label still needs synchronization.
    if (!liveIcon.displayIcon && container.icon) {
      container.displayIcon = container.icon;
      container.displayIconSource = "template";
    }
  }));
  return {
    dockerAvailable,
    containers
  };
}
