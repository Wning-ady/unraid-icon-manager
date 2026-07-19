export type IconSource = "upload" | "url";

export interface AppConfig {
  port: number;
  host: string;
  configDir: string;
  templatesDir: string;
  iconsDir: string;
  iconHostRoot: string;
  backupsDir: string;
  maxUploadBytes: number;
  /** Host Docker Manager's persistent and RAM icon caches, mounted read/write. */
  iconCacheDir?: string;
  iconCacheRamDir?: string;
  /** Public URL used by Unraid itself to download uploaded icons. */
  publicBaseUrl?: string;
  unraidDockerUrl?: string;
}

export interface TemplateRecord {
  name: string;
  fileName: string;
  filePath: string;
  icon: string | null;
  repository: string | null;
  generated?: boolean;
}

export interface ManagedContainer {
  /** Name and Docker metadata always come from a currently deployed container. */
  name: string;
  id: string;
  image: string;
  state: string;
  status: string;
  fileName: string | null;
  icon: string | null;
  editable: boolean;
  templateMatch: "name" | "file" | null;
  composeManaged: boolean;
  templateState: "linked" | "will-create" | "generated";
}

export interface Group {
  id: number;
  name: string;
  containerNames: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AuditRecord {
  id: number;
  containerName: string;
  templateFile: string;
  oldIcon: string | null;
  newIcon: string | null;
  backupFile: string;
  templateCreated: boolean;
  createdAt: string;
  result: "applied" | "restored";
}
