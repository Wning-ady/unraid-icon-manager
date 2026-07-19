import type { ManagedContainer, TemplateRecord } from "./types.js";

export interface DockerSummary {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
  Labels?: Record<string, string>;
}

export type TemplateMatch = "name" | "file" | null;

function containerName(summary: DockerSummary): string | null {
  const name = summary.Names[0]?.replace(/^\//, "").trim();
  return name || null;
}

function normalizedRepository(repository: string): string {
  if (repository.includes("@")) return repository;
  const lastSegment = repository.split("/").pop() ?? repository;
  return lastSegment.includes(":") ? repository : `${repository}:latest`;
}

function findTemplate(templates: TemplateRecord[], name: string, image: string): { template: TemplateRecord; match: Exclude<TemplateMatch, null> } | null {
  const exactName = templates.find((template) => template.name === name && template.repository && normalizedRepository(template.repository) === normalizedRepository(image));
  if (exactName) return { template: exactName, match: "name" };
  return null;
}

/** Associates current Docker containers with their editable Unraid Docker Manager templates. */
export function associateManagedContainers(templates: TemplateRecord[], summaries: DockerSummary[]): ManagedContainer[] {
  return summaries
    .map((summary) => {
      const name = containerName(summary);
      if (!name) return null;
      const associated = findTemplate(templates, name, summary.Image);
      const composeManaged = Boolean(summary.Labels?.["com.docker.compose.project"] || summary.Labels?.["com.docker.compose.service"]);
      const templateState: ManagedContainer["templateState"] = associated ? (associated.template.generated ? "generated" : "linked") : "will-create";
      return {
        name,
        fileName: associated?.template.fileName ?? null,
        icon: associated?.template.icon ?? null,
        templateMatch: associated?.match ?? null,
        editable: true,
        composeManaged,
        templateState,
        id: summary.Id,
        image: summary.Image,
        state: summary.State,
        status: summary.Status
      };
    })
    .filter((container): container is NonNullable<typeof container> => container !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}
