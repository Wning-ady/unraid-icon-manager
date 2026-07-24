import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "./types.js";

function requiredDirectory(value: string, label: string): string {
  if (!value.startsWith("/")) throw new Error(`${label} must be an absolute path`);
  return value;
}

function optionalHttpUrl(value: string | undefined, label: string): string | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${label} must use HTTP or HTTPS`);
  return value.replace(/\/$/, '');
}

function positiveInteger(value: string | undefined, fallback: number, label: string): number {
  const result = Number(value ?? fallback);
  if (!Number.isInteger(result) || result < 1) throw new Error(`${label} must be a positive integer`);
  return result;
}

export function loadConfig(env = process.env): AppConfig {
  const adminToken = env.ADMIN_TOKEN?.trim();
  if (!adminToken || adminToken.length < 24 || /^change[_-]?me/i.test(adminToken)) throw new Error("ADMIN_TOKEN must be set to a random value of at least 24 characters");
  const configDir = requiredDirectory(env.CONFIG_DIR ?? "/config", "CONFIG_DIR");
  const templatesDir = requiredDirectory(env.TEMPLATES_DIR ?? "/unraid/templates-user", "TEMPLATES_DIR");
  const iconHostRoot = requiredDirectory(
    env.ICON_HOST_ROOT ?? "/mnt/user/appdata/unraid-icon-manager/icons",
    "ICON_HOST_ROOT"
  );
  const config: AppConfig = {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? "0.0.0.0",
    configDir,
    templatesDir,
    iconsDir: join(configDir, "icons"),
    iconHostRoot,
    wallpapersDir: join(configDir, "wallpapers"),
    wallpaperHostRoot: requiredDirectory(env.WALLPAPER_HOST_ROOT ?? "/mnt/user/appdata/unraid-icon-manager/wallpapers", "WALLPAPER_HOST_ROOT"),
    backupsDir: join(configDir, "backups"),
    maxUploadBytes: positiveInteger(env.MAX_UPLOAD_BYTES, 5 * 1024 * 1024, "MAX_UPLOAD_BYTES"),
    maxWallpaperBytes: positiveInteger(env.MAX_WALLPAPER_BYTES, 30 * 1024 * 1024, "MAX_WALLPAPER_BYTES"),
    maxIconGalleryBytes: positiveInteger(env.MAX_ICON_GALLERY_BYTES, 500 * 1024 * 1024, "MAX_ICON_GALLERY_BYTES"),
    maxWallpaperGalleryBytes: positiveInteger(env.MAX_WALLPAPER_GALLERY_BYTES, 2 * 1024 * 1024 * 1024, "MAX_WALLPAPER_GALLERY_BYTES"),
    maxMutationQueue: positiveInteger(env.MAX_MUTATION_QUEUE, 20, "MAX_MUTATION_QUEUE"),
    adminToken,
    trustedNetworks: (env.TRUSTED_NETWORKS ?? "127.0.0.1/32,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16").split(",").map((entry) => entry.trim()).filter(Boolean),
    iconCacheDir: requiredDirectory(env.ICON_CACHE_DIR ?? "/unraid/icon-cache", "ICON_CACHE_DIR"),
    iconCacheRamDir: requiredDirectory(env.ICON_CACHE_RAM_DIR ?? "/unraid/icon-cache-ram", "ICON_CACHE_RAM_DIR"),
    composeProjectsDir: env.COMPOSE_PROJECTS_DIR ? requiredDirectory(env.COMPOSE_PROJECTS_DIR, "COMPOSE_PROJECTS_DIR") : undefined,
    composeHostRoot: env.COMPOSE_HOST_ROOT ? requiredDirectory(env.COMPOSE_HOST_ROOT, "COMPOSE_HOST_ROOT") : undefined,
    publicBaseUrl: optionalHttpUrl(env.PUBLIC_BASE_URL, "PUBLIC_BASE_URL"),
    unraidDockerUrl: optionalHttpUrl(env.UNRAID_DOCKER_URL, "UNRAID_DOCKER_URL") ?? "/Docker",
    vmIconsDir: requiredDirectory(env.VM_ICONS_DIR ?? "/unraid/vm-icons", "VM_ICONS_DIR"),
    libvirtUri: env.LIBVIRT_URI ?? "qemu+unix:///system?socket=/var/run/libvirt/libvirt-sock",
    unraidVmUrl: optionalHttpUrl(env.UNRAID_VM_URL, "UNRAID_VM_URL") ?? "/VMs"
  };
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error("PORT must be between 1 and 65535");
  }
  for (const directory of [config.configDir, config.iconsDir, config.wallpapersDir!, config.backupsDir]) mkdirSync(directory, { recursive: true });
  return config;
}
