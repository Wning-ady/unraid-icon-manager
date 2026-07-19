import Docker from "dockerode";
import type { AppConfig, ManagedContainer } from "./types.js";
import { listTemplates } from "./template-service.js";

interface DockerSummary {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
}

export async function listManagedContainers(config: AppConfig): Promise<{ containers: ManagedContainer[]; dockerAvailable: boolean }> {
  const templates = await listTemplates(config);
  let summaries: DockerSummary[] = [];
  let dockerAvailable = true;
  try {
    summaries = await new Docker({ socketPath: "/var/run/docker.sock" }).listContainers({ all: true }) as DockerSummary[];
  } catch {
    dockerAvailable = false;
  }
  const byName = new Map<string, DockerSummary>();
  for (const container of summaries) {
    for (const rawName of container.Names ?? []) byName.set(rawName.replace(/^\//, ""), container);
  }
  return {
    dockerAvailable,
    containers: templates.map((template) => {
      const container = byName.get(template.name);
      return {
        ...template,
        id: container?.Id ?? null,
        image: container?.Image ?? null,
        state: container?.State ?? null,
        status: container?.Status ?? null,
        managed: Boolean(container)
      };
    })
  };
}
