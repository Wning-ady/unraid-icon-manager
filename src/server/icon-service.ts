import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { AppConfig } from "./types.js";

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
