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

function findTemplate(templates: TemplateRecord[], name: string): { template: TemplateRecord; match: Exclude<TemplateMatch, null> } | null {
  const exactName = templates.find((template) => template.name === name);
  if (exactName) return { template: exactName, match: "name" };

  const lowercaseName = name.toLocaleLowerCase();
  const insensitiveName = templates.find((template) => template.name.toLocaleLowerCase() === lowercaseName);
  if (insensitiveName) return { template: insensitiveName, match: "name" };

  const expectedFileName = `my-${name}.xml`;
  const exactFileName = templates.find((template) => template.fileName === expectedFileName);
  if (exactFileName) return { template: exactFileName, match: "file" };

  const insensitiveFileName = templates.find((template) => template.fileName.toLocaleLowerCase() === expectedFileName.toLocaleLowerCase());
  return insensitiveFileName ? { template: insensitiveFileName, match: "file" } : null;
}

/** Associates current Docker containers with their editable Unraid Docker Manager templates. */
export function associateManagedContainers(templates: TemplateRecord[], summaries: DockerSummary[]): ManagedContainer[] {
  return summaries
    .map((summary) => {
      const name = containerName(summary);
      if (!name) return null;
      const associated = findTemplate(templates, name);
      const composeManaged = Boolean(summary.Labels?.["com.docker.compose.project"] || summary.Labels?.["com.docker.compose.service"]);
      const uneditableReason: ManagedContainer["uneditableReason"] = composeManaged ? "compose" : associated ? null : "no-template";
      return {
        name,
        fileName: composeManaged ? null : associated?.template.fileName ?? null,
        icon: associated?.template.icon ?? null,
        templateMatch: composeManaged ? null : associated?.match ?? null,
        editable: Boolean(associated) && !composeManaged,
        uneditableReason,
        id: summary.Id,
        image: summary.Image,
        state: summary.State,
        status: summary.Status
      };
    })
    .filter((container): container is NonNullable<typeof container> => container !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}
