import Docker from "dockerode";
import type { AppConfig, ManagedContainer } from "./types.js";
import { associateManagedContainers, type DockerSummary } from "./container-association.js";
import { listTemplates } from "./template-service.js";
import { findUnraidIconCache } from "./unraid-cache-service.js";

/** Resolves only the explicit icon label Unraid itself renders for this container. */
export function resolveUnraidLabelIcon(unraidDockerUrl: string | undefined, rawIcon: string | undefined): string | null {
  if (!rawIcon) return null;
  try {
    const icon = new URL(rawIcon);
    if (icon.protocol === "http:" || icon.protocol === "https:") return icon.toString();
  } catch { /* Local Unraid paths are handled below. */ }
  if (!unraidDockerUrl || !rawIcon.startsWith("/mnt/user/") || rawIcon.includes("\\")) return null;
  const segments = rawIcon.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) return null;
  try {
    const dockerPage = new URL(unraidDockerUrl);
    return new URL(rawIcon, dockerPage.origin).toString();
  } catch { return null; }
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
    if (await findUnraidIconCache(config, container.name)) {
      container.displayIcon = `/api/containers/icon-cache/${encodeURIComponent(container.name)}`;
      container.displayIconSource = "unraid-cache";
      return;
    }
    const labelIcon = resolveUnraidLabelIcon(config.unraidDockerUrl, summariesById.get(container.id)?.Labels?.["net.unraid.docker.icon"]);
    if (labelIcon) {
      container.displayIcon = labelIcon;
      container.displayIconSource = "unraid-label";
    }
  }));
  return {
    dockerAvailable,
    containers
  };
}
