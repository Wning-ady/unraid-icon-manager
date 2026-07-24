import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppConfig } from "./types.js";
import type { StoredIcon } from "./types.js";
import { openSafeImage } from "./image-security.js";

const ICON_PATTERN = /^[a-f0-9]{64}\.png$/;

function safeImage(buffer: Buffer) {
  return openSafeImage(buffer, 16_000_000);
}

async function regularBytes(dir: string, pattern: RegExp): Promise<number> {
  const entries = await readdir(dir, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !pattern.test(entry.name)) continue;
    const info = await lstat(join(dir, entry.name));
    if (info.isFile() && !info.isSymbolicLink()) total += info.size;
  }
  return total;
}

export async function storeUploadedIcon(config: AppConfig, buffer: Buffer): Promise<{ icon: string; fileName: string }> {
  if (!buffer.length) throw new Error("Icon upload is empty");
  if (buffer.length > config.maxUploadBytes) throw new Error(`Icon upload exceeds ${config.maxUploadBytes} bytes`);
  let png: Buffer;
  try {
    const metadata = await safeImage(buffer).metadata();
    if (!metadata.format || !["png", "svg", "webp", "jpeg"].includes(metadata.format)) throw new Error("Upload must be PNG, SVG, WebP, or JPEG");
    png = await safeImage(buffer).resize(512, 512, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
  } catch {
    throw new Error("Upload must be a valid PNG, SVG, WebP, JPEG, or GIF image");
  }
  const fileName = `${createHash("sha256").update(png).digest("hex")}.png`;
  await mkdir(config.iconsDir, { recursive: true });
  if (config.maxIconGalleryBytes && !(await lstat(join(config.iconsDir, fileName)).catch(() => null))) {
    if ((await regularBytes(config.iconsDir, ICON_PATTERN)) + png.length > config.maxIconGalleryBytes) {
      throw new Error(`图标图库已达到 ${config.maxIconGalleryBytes} 字节配额，请先删除不再使用的图标`);
    }
  }
  try {
    await writeFile(join(config.iconsDir, fileName), png, { flag: "wx" });
  } catch (error: any) {
    if (error?.code !== "EEXIST") throw error;
  }
  return { fileName, icon: join(config.iconHostRoot, fileName) };
}

/** Lists only stable normalized PNG assets already stored inside /config/icons. */
export async function listStoredIcons(config: AppConfig, baseUrl: string, groupIds = new Map<string, number | null>()): Promise<StoredIcon[]> {
  await mkdir(config.iconsDir, { recursive: true });
  const entries = await readdir(config.iconsDir, { withFileTypes: true });
  const selected = entries.filter((entry) => entry.isFile() && ICON_PATTERN.test(entry.name));
  // A gallery can be large on a NAS; keep filesystem work bounded instead of opening every entry at once.
  const icons: StoredIcon[] = [];
  for (let index = 0; index < selected.length; index += 8) {
    const batch = await Promise.all(selected.slice(index, index + 8).map(async (entry) => {
      const metadata = await stat(join(config.iconsDir, entry.name));
      const previewUrl = `/api/icons/file/${entry.name}`;
      const createdAt = metadata.birthtimeMs > 0 ? metadata.birthtime : metadata.mtime;
      return { fileName: entry.name, previewUrl, icon: `${baseUrl}${previewUrl}`, bytes: metadata.size, createdAt: createdAt.toISOString(), groupId: groupIds.get(entry.name) ?? null };
    }));
    icons.push(...batch);
  }
  return icons.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function deleteStoredIcon(config: AppConfig, fileName: string): Promise<void> {
  if (!/^[a-f0-9]{64}\.png$/.test(fileName)) throw new Error("Invalid icon file name");
  const filePath = join(config.iconsDir, fileName);
  let metadata;
  try { metadata = await lstat(filePath); } catch { throw new Error("Icon file not found"); }
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("Icon asset is not a regular file");
  await unlink(filePath);
}
