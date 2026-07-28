const LEGACY_HASH = "[a-f0-9]{64}";
const SHORT_HASH = "[a-f0-9]{16}(?:[a-f0-9]{8})?";

/** New assets use readable, short content-addressed names; legacy 64-character names remain valid. */
export const ICON_FILE_NAME_PATTERN = new RegExp(`^(?:icon-${SHORT_HASH}|${LEGACY_HASH})\\.png$`);
export const WALLPAPER_FILE_NAME_PATTERN = new RegExp(`^(?:wallpaper-${SHORT_HASH}|${LEGACY_HASH})\\.(?:png|jpg|webp)$`);

export function iconFileName(hash: string, length = 16): string {
  return `icon-${hash.slice(0, length)}.png`;
}

export function wallpaperFileName(hash: string, extension: "png" | "jpg" | "webp", length = 16): string {
  return `wallpaper-${hash.slice(0, length)}.${extension}`;
}
