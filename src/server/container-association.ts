import type { IconCandidate, ManagedContainer, TemplateRecord } from "./types.js";

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

const iconLabelKeys = new Set([
  "net.unraid.docker.icon",
  "com.docker.compose.icon",
  "com.docker.compose.icon-url",
  "org.opencontainers.image.icon",
  "org.opencontainers.image.icon-url"
]);

function labelCandidates(labels: Record<string, string> | undefined, source: IconCandidate["source"]): IconCandidate[] {
  if (!labels) return [];
  return Object.entries(labels).flatMap(([labelKey, rawValue]) => {
    if (!iconLabelKeys.has(labelKey.toLowerCase()) || rawValue.length > 2048) return [];
    try {
      const url = new URL(rawValue);
      if (url.protocol !== "http:" && url.protocol !== "https:") return [];
      return [{ value: url.toString(), source, labelKey }];
    } catch { return []; }
  });
}

export function discoverIconCandidates(containerLabels?: Record<string, string>, imageLabels?: Record<string, string>): IconCandidate[] {
  const seen = new Set<string>();
  return [...labelCandidates(containerLabels, "container-label"), ...labelCandidates(imageLabels, "image-label")]
    .filter((candidate) => !seen.has(candidate.value) && Boolean(seen.add(candidate.value)));
}

function repositoryTemplateCandidates(templates: TemplateRecord[], image: string): IconCandidate[] {
  return templates.flatMap((template) => {
    if (!template.icon || !template.repository || normalizedRepository(template.repository) !== normalizedRepository(image)) return [];
    try {
      const url = new URL(template.icon);
      if (url.protocol !== "http:" && url.protocol !== "https:") return [];
      return [{ value: url.toString(), source: "unraid-template" as const, labelKey: template.fileName }];
    } catch { return []; }
  });
}

/** Associates current Docker containers with their editable Unraid Docker Manager templates. */
export function associateManagedContainers(templates: TemplateRecord[], summaries: DockerSummary[], imageLabels = new Map<string, Record<string, string>>()): ManagedContainer[] {
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
        displayIcon: associated?.template.icon ?? null,
        displayIconSource: associated?.template.icon ? "template" as const : null,
        templateMatch: associated?.match ?? null,
        editable: true,
        composeManaged,
        templateState,
        id: summary.Id,
        image: summary.Image,
        state: summary.State,
        status: summary.Status,
        iconCandidates: associated?.template.icon ? [] : [...discoverIconCandidates(summary.Labels, imageLabels.get(summary.Image)), ...repositoryTemplateCandidates(templates, summary.Image)]
      };
    })
    .filter((container): container is NonNullable<typeof container> => container !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}
