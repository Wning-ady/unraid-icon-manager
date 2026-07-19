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
}

export interface TemplateRecord {
  name: string;
  fileName: string;
  filePath: string;
  icon: string | null;
}

export interface ManagedContainer {
  /** Name and Docker metadata always come from a currently deployed container. */
  name: string;
  id: string;
  image: string;
  state: string;
  status: string;
  /** A matching template is required because it is the persisted source of an Unraid icon. */
  fileName: string | null;
  icon: string | null;
  editable: boolean;
  templateMatch: "name" | "file" | null;
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
  createdAt: string;
  result: "applied" | "restored";
}
