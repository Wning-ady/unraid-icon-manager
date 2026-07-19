export function validateIconUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Icon URL must use HTTP or HTTPS");
  return url.toString();
}
