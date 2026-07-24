import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppConfig, StoredWallpaper } from "./types.js";
import { openSafeImage } from "./image-security.js";

function directory(config: AppConfig): string { return config.wallpapersDir ?? join(config.configDir, "wallpapers"); }
const WALLPAPER_PATTERN = /^[a-f0-9]{64}\.(?:png|jpg|webp)$/;

function safeImage(input: Buffer | string) {
  return openSafeImage(input, 80_000_000);
}

async function galleryBytes(dir: string): Promise<number> {
  const entries = await readdir(dir, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !WALLPAPER_PATTERN.test(entry.name)) continue;
    const info = await lstat(join(dir, entry.name));
    if (info.isFile() && !info.isSymbolicLink()) total += info.size;
  }
  return total;
}

export async function storeWallpaper(config: AppConfig, buffer: Buffer): Promise<{ fileName: string; bytes: number; width: number; height: number; mimeType: string }> {
  if (!buffer.length) throw new Error("壁纸文件为空");
  const maxBytes = config.maxWallpaperBytes ?? config.maxUploadBytes;
  if (buffer.length > maxBytes) throw new Error(`壁纸超过 ${maxBytes} 字节限制`);
  let metadata;
  try { metadata = await safeImage(buffer).metadata(); }
  catch { throw new Error("壁纸必须是有效的 PNG、JPEG 或 WebP 图片"); }
  if (!metadata.width || !metadata.height || !["png", "jpeg", "webp"].includes(metadata.format ?? "")) {
    throw new Error("壁纸必须是有效的 PNG、JPEG 或 WebP 图片");
  }
  const extension = metadata.format === "jpeg" ? "jpg" : metadata.format;
  const fileName = `${createHash("sha256").update(buffer).digest("hex")}.${extension}`;
  await mkdir(directory(config), { recursive: true });
  if (config.maxWallpaperGalleryBytes && !(await lstat(join(directory(config), fileName)).catch(() => null))) {
    if ((await galleryBytes(directory(config))) + buffer.length > config.maxWallpaperGalleryBytes) {
      throw new Error(`壁纸图库已达到 ${config.maxWallpaperGalleryBytes} 字节配额，请先删除不再使用的壁纸`);
    }
  }
  try { await writeFile(join(directory(config), fileName), buffer, { flag: "wx" }); }
  catch (error: any) { if (error?.code !== "EEXIST") throw error; }
  return { fileName, bytes: buffer.length, width: metadata.width, height: metadata.height, mimeType: `image/${metadata.format}` };
}

export async function listWallpaperFiles(config: AppConfig, baseUrl: string, groupIds: Map<string, number | null>): Promise<StoredWallpaper[]> {
  await mkdir(directory(config), { recursive: true });
  const entries = await readdir(directory(config), { withFileTypes: true });
  const selected = entries.filter((entry) => entry.isFile() && WALLPAPER_PATTERN.test(entry.name));
  const items: StoredWallpaper[] = [];
  for (let index = 0; index < selected.length; index += 4) {
    const batch = await Promise.all(selected.slice(index, index + 4).map(async (entry) => {
    const filePath = join(directory(config), entry.name);
    const [file, image] = await Promise.all([stat(filePath), safeImage(filePath).metadata()]);
    const createdAt = file.birthtimeMs > 0 ? file.birthtime : file.mtime;
    const previewUrl = `/api/wallpapers/file/${entry.name}`;
    return { fileName: entry.name, previewUrl, downloadUrl: `${previewUrl}?download=1`, url: `${baseUrl}${previewUrl}`, bytes: file.size,
      width: image.width ?? 0, height: image.height ?? 0, mimeType: `image/${image.format}`, groupId: groupIds.get(entry.name) ?? null, createdAt: createdAt.toISOString() };
    }));
    items.push(...batch);
  }
  return items.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function deleteWallpaper(config: AppConfig, fileName: string): Promise<void> {
  if (!/^[a-f0-9]{64}\.(?:png|jpg|webp)$/.test(fileName)) throw new Error("壁纸文件名无效");
  const filePath = join(directory(config), fileName);
  let metadata;
  try { metadata = await lstat(filePath); } catch { throw new Error("壁纸不存在"); }
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("壁纸不是普通文件");
  await unlink(filePath);
}

export function wallpaperPath(config: AppConfig, fileName: string): string { return join(directory(config), fileName); }
