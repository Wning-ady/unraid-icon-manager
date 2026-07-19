import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "./types.js";

function requiredDirectory(value: string, label: string): string {
  if (!value.startsWith("/")) throw new Error(`${label} must be an absolute path`);
  return value;
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
    backupsDir: join(configDir, "backups"),
    maxUploadBytes: Number(env.MAX_UPLOAD_BYTES ?? 5 * 1024 * 1024)
  };
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error("PORT must be between 1 and 65535");
  }
  for (const directory of [config.configDir, config.iconsDir, config.backupsDir]) mkdirSync(directory, { recursive: true });
  return config;
}
