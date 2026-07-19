import Docker from "dockerode";
import type { AppConfig, ManagedContainer } from "./types.js";
import { associateManagedContainers, type DockerSummary } from "./container-association.js";
import { listTemplates } from "./template-service.js";

export async function listManagedContainers(config: AppConfig): Promise<{ containers: ManagedContainer[]; dockerAvailable: boolean }> {
  const templates = await listTemplates(config);
  let summaries: DockerSummary[] = [];
  let dockerAvailable = true;
  try {
    summaries = await new Docker({ socketPath: "/var/run/docker.sock" }).listContainers({ all: true }) as DockerSummary[];
  } catch {
    dockerAvailable = false;
  }
  return {
    dockerAvailable,
    containers: dockerAvailable ? associateManagedContainers(templates, summaries) : []
  };
}
