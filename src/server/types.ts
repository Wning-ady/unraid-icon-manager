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

export interface ManagedContainer extends TemplateRecord {
  id: string | null;
  image: string | null;
  state: string | null;
  status: string | null;
  managed: boolean;
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
