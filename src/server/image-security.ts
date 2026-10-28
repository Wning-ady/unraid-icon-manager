import sharp from "sharp";
import type { Sharp } from "sharp";

// Disallow loaders we never need before processing untrusted uploads or downloads.
// This is process-wide by design, so every Sharp call in the service inherits it.
sharp.block({ operation: ["VipsForeignLoadGif", "VipsForeignLoadTiff", "VipsForeignLoadVips"] });

// Keep libvips from retaining a large decoded-image cache in the long-lived
// server process. Uploads and wallpaper previews are processed sequentially,
// so a small cache and two workers are enough without letting large images
// compete with the application for memory.
sharp.cache({ items: 32, files: 0, memory: 32 });
sharp.concurrency(2);

export function openSafeImage(input: Buffer | string, limitInputPixels: number): Sharp {
  return sharp(input, { limitInputPixels });
}
