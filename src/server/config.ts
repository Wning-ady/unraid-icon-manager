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

export function loadConfig(env = process.env): AppConfig {
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
    maxUploadBytes: Number(env.MAX_UPLOAD_BYTES ?? 5 * 1024 * 1024),
    maxWallpaperBytes: Number(env.MAX_WALLPAPER_BYTES ?? 30 * 1024 * 1024),
    iconCacheDir: requiredDirectory(env.ICON_CACHE_DIR ?? "/unraid/icon-cache", "ICON_CACHE_DIR"),
    iconCacheRamDir: requiredDirectory(env.ICON_CACHE_RAM_DIR ?? "/unraid/icon-cache-ram", "ICON_CACHE_RAM_DIR"),
    composeProjectsDir: env.COMPOSE_PROJECTS_DIR ? requiredDirectory(env.COMPOSE_PROJECTS_DIR, "COMPOSE_PROJECTS_DIR") : undefined,
    composeHostRoot: env.COMPOSE_HOST_ROOT ? requiredDirectory(env.COMPOSE_HOST_ROOT, "COMPOSE_HOST_ROOT") : undefined,
    publicBaseUrl: optionalHttpUrl(env.PUBLIC_BASE_URL, "PUBLIC_BASE_URL"),
    unraidDockerUrl: optionalHttpUrl(env.UNRAID_DOCKER_URL, "UNRAID_DOCKER_URL") ?? "/Docker"
  };
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error("PORT must be between 1 and 65535");
  }
  if (!Number.isInteger(config.maxUploadBytes) || config.maxUploadBytes < 1) throw new Error("MAX_UPLOAD_BYTES must be a positive integer");
  if (!Number.isInteger(config.maxWallpaperBytes) || config.maxWallpaperBytes! < 1) throw new Error("MAX_WALLPAPER_BYTES must be a positive integer");
  for (const directory of [config.configDir, config.iconsDir, config.wallpapersDir!, config.backupsDir]) mkdirSync(directory, { recursive: true });
  return config;
}
