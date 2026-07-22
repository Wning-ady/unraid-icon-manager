export type IconSource = "upload" | "url";

export interface AppConfig {
  port: number;
  host: string;
  configDir: string;
  templatesDir: string;
  iconsDir: string;
  iconHostRoot: string;
  wallpapersDir?: string;
  wallpaperHostRoot?: string;
  backupsDir: string;
  maxUploadBytes: number;
  maxWallpaperBytes?: number;
  /** Host Docker Manager's persistent and RAM icon caches, mounted read/write. */
  iconCacheDir?: string;
  iconCacheRamDir?: string;
  /** Compose Manager projects, mounted read/write only when label persistence is enabled. */
  composeProjectsDir?: string;
  composeHostRoot?: string;
  /** Public URL used by Unraid itself to download uploaded icons. */
  publicBaseUrl?: string;
  unraidDockerUrl?: string;
  vmIconsDir?: string;
  libvirtUri?: string;
  unraidVmUrl?: string;
}

export interface ManagedVirtualMachine {
  id: string;
  name: string;
  state: string;
  icon: string | null;
  displayIcon: string | null;
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
  /** What Unraid currently renders, kept separate from the persisted template Icon. */
  displayIcon: string | null;
  displayIconSource: "unraid-cache" | "unraid-label" | "template" | null;
  editable: boolean;
  templateMatch: "name" | "file" | null;
  composeManaged: boolean;
  templateState: "linked" | "will-create" | "generated";
  iconCandidates: IconCandidate[];
}

export interface IconCandidate {
  value: string;
  source: "container-label" | "image-label" | "unraid-template";
  labelKey: string;
}

export interface StoredIcon {
  fileName: string;
  previewUrl: string;
  icon: string;
  bytes: number;
  createdAt: string;
  groupId: number | null;
}

export interface IconGroup {
  id: number;
  name: string;
  createdAt: string;
}

export interface WallpaperGroup {
  id: number;
  name: string;
  createdAt: string;
}

export interface StoredWallpaper {
  fileName: string;
  previewUrl: string;
  downloadUrl: string;
  url: string;
  bytes: number;
  width: number;
  height: number;
  mimeType: string;
  groupId: number | null;
  createdAt: string;
}

export interface UiSettings {
  theme: "light" | "dark";
  wallpaperFileName: string | null;
  glassBlur: number;
  surfaceOpacity: number;
}

export interface AuditRecord {
  id: number;
  containerName: string;
  templateFile: string;
  oldIcon: string | null;
  newIcon: string | null;
  backupFile: string;
  cacheBackup: IconCacheBackup | null;
  revertsAuditId: number | null;
  revertedByAuditId: number | null;
  templateCreated: boolean;
  createdAt: string;
  result: "applied" | "restored";
}

export interface IconCacheBackup {
  persistent: string | null;
  ram: string | null;
}

export interface IconSyncResult {
  containerName: string;
  containerId: string;
  recreated: boolean;
  composeOverrideUpdated: boolean;
}
