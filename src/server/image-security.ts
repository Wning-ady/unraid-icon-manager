import sharp from "sharp";
import type { Sharp } from "sharp";

// Disallow loaders we never need before processing untrusted uploads or downloads.
// This is process-wide by design, so every Sharp call in the service inherits it.
sharp.block({ operation: ["VipsForeignLoadGif", "VipsForeignLoadTiff", "VipsForeignLoadVips"] });

export function openSafeImage(input: Buffer | string, limitInputPixels: number): Sharp {
  return sharp(input, { limitInputPixels });
}
