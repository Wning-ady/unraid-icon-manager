import Docker from "dockerode";
import type { AppConfig, ManagedContainer } from "./types.js";
import { associateManagedContainers, type DockerSummary } from "./container-association.js";
import { listTemplates } from "./template-service.js";

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
  return {
    dockerAvailable,
    containers: dockerAvailable ? associateManagedContainers(templates, summaries, imageLabels) : []
  };
}
