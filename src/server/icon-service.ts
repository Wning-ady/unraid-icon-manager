import { createHash } from "node:crypto";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { AppConfig } from "./types.js";
import type { StoredIcon } from "./types.js";

export async function storeUploadedIcon(config: AppConfig, buffer: Buffer): Promise<{ icon: string; fileName: string }> {
  if (!buffer.length) throw new Error("Icon upload is empty");
  if (buffer.length > config.maxUploadBytes) throw new Error(`Icon upload exceeds ${config.maxUploadBytes} bytes`);
  let png: Buffer;
  try {
    png = await sharp(buffer, { limitInputPixels: 16_000_000 }).resize(512, 512, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
  } catch {
    throw new Error("Upload must be a valid PNG, SVG, WebP, JPEG, or GIF image");
  }
  const fileName = `${createHash("sha256").update(png).digest("hex")}.png`;
  await mkdir(config.iconsDir, { recursive: true });
  try {
    await writeFile(join(config.iconsDir, fileName), png, { flag: "wx" });
  } catch (error: any) {
    if (error?.code !== "EEXIST") throw error;
  }
  return { fileName, icon: join(config.iconHostRoot, fileName) };
}

/** Lists only stable normalized PNG assets already stored inside /config/icons. */
export async function listStoredIcons(config: AppConfig, baseUrl: string): Promise<StoredIcon[]> {
  await mkdir(config.iconsDir, { recursive: true });
  const entries = await readdir(config.iconsDir, { withFileTypes: true });
  const icons = await Promise.all(entries
    .filter((entry) => entry.isFile() && /^[a-f0-9]{64}\.png$/.test(entry.name))
    .map(async (entry) => {
      const metadata = await stat(join(config.iconsDir, entry.name));
      const previewUrl = `/api/icons/file/${entry.name}`;
      const createdAt = metadata.birthtimeMs > 0 ? metadata.birthtime : metadata.mtime;
      return { fileName: entry.name, previewUrl, icon: `${baseUrl}${previewUrl}`, bytes: metadata.size, createdAt: createdAt.toISOString() };
    }));
  return icons.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
