import { copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { AppConfig, TemplateRecord } from "./types.js";

const namePattern = /<Name(?:\s[^>]*)?>([\s\S]*?)<\/Name>/i;
const iconPattern = /<Icon(?:\s[^>]*)?>[\s\S]*?<\/Icon>/i;

function decodeXml(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function getTemplateName(xml: string, fallbackFileName: string): string {
  const name = xml.match(namePattern)?.[1]?.trim();
  return name ? decodeXml(name) : fallbackFileName.replace(/^my-/, "").replace(/\.xml$/i, "");
}

export function getTemplateIcon(xml: string): string | null {
  const match = xml.match(/<Icon(?:\s[^>]*)?>([\s\S]*?)<\/Icon>/i);
  return match ? decodeXml(match[1].trim()) : null;
}

/** Changes only the Icon element, preserving every unknown XML field and attribute byte-for-byte. */
export function setTemplateIcon(xml: string, icon: string): string {
  if (!xml.includes("<")) throw new Error("Template XML is invalid");
  const element = `<Icon>${escapeXml(icon)}</Icon>`;
  if (iconPattern.test(xml)) return xml.replace(iconPattern, element);
  const closing = xml.match(/<\/Container>/i) ? /<\/Container>/i : /<\/Containers>/i;
  if (!closing.test(xml)) throw new Error("Template XML does not contain a Container root");
  return xml.replace(closing, `  ${element}\n$&`);
}

function inside(base: string, candidate: string): boolean {
  const resolvedBase = resolve(base) + "/";
  return resolve(candidate).startsWith(resolvedBase);
}

export async function listTemplates(config: AppConfig): Promise<TemplateRecord[]> {
  let files: string[];
  try { files = await readdir(config.templatesDir); } catch { return []; }
  const templates: TemplateRecord[] = [];
  for (const fileName of files.filter((file) => file.toLowerCase().endsWith(".xml"))) {
    const filePath = join(config.templatesDir, fileName);
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) continue;
    const xml = await readFile(filePath, "utf8");
    templates.push({ name: getTemplateName(xml, fileName), fileName, filePath, icon: getTemplateIcon(xml) });
  }
  return templates.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getTemplate(config: AppConfig, fileName: string): Promise<TemplateRecord> {
  if (!fileName.endsWith(".xml") || basename(fileName) !== fileName) throw new Error("Invalid template file name");
  const filePath = join(config.templatesDir, fileName);
  if (!inside(config.templatesDir, filePath)) throw new Error("Template path escapes templates directory");
  const xml = await readFile(filePath, "utf8");
  return { name: getTemplateName(xml, fileName), fileName, filePath, icon: getTemplateIcon(xml) };
}

export async function updateTemplateIcon(config: AppConfig, fileName: string, icon: string): Promise<{ oldIcon: string | null; backupFile: string }> {
  const template = await getTemplate(config, fileName);
  const xml = await readFile(template.filePath, "utf8");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDirectory = join(config.backupsDir, timestamp);
  await mkdir(backupDirectory, { recursive: true });
  const backupFile = join(backupDirectory, fileName);
  await copyFile(template.filePath, backupFile);
  const temporaryFile = join(config.templatesDir, `.${fileName}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temporaryFile, setTemplateIcon(xml, icon), "utf8");
  await rename(temporaryFile, template.filePath);
  return { oldIcon: template.icon, backupFile };
}

export async function restoreTemplate(config: AppConfig, fileName: string, backupFile: string): Promise<void> {
  const template = await getTemplate(config, fileName);
  if (!inside(config.backupsDir, backupFile)) throw new Error("Backup path escapes backup directory");
  const contents = await readFile(backupFile, "utf8");
  const temporaryFile = join(config.templatesDir, `.${fileName}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temporaryFile, contents, "utf8");
  await rename(temporaryFile, template.filePath);
}
