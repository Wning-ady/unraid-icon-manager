import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, lstat, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AppConfig, ManagedVirtualMachine } from "./types.js";

const execFileAsync = promisify(execFile);
export const UNRAID_VM_METADATA_URI = "http://unraid";
const LEGACY_VM_METADATA_URI = "unraid";

function decodeXml(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function encodeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function parseVmDomainXml(xml: string): { id: string; name: string; icon: string | null; metadata: string | null } {
  const id = decodeXml(xml.match(/<uuid>\s*([^<]+)\s*<\/uuid>/)?.[1]?.trim() ?? "");
  const name = decodeXml(xml.match(/<name>\s*([^<]+)\s*<\/name>/)?.[1]?.trim() ?? "");
  const metadata = xml.match(/<vmtemplate\b[^>]*(?:\/>|>[\s\S]*?<\/vmtemplate>)/)?.[0] ?? null;
  const icon = metadata?.match(/\bicon\s*=\s*(["'])(.*?)\1/)?.[2];
  if (!id || !name) throw new Error("libvirt domain XML 缺少名称或 UUID");
  return { id, name, icon: icon ? decodeXml(icon) : null, metadata };
}

export function replaceVmMetadataIcon(metadata: string | null, icon: string, name: string): string {
  const safeIcon = encodeXml(icon);
  if (!metadata) return `<vmtemplate xmlns="http://unraid" name="${encodeXml(name)}" icon="${safeIcon}" os="other"/>`;
  if (/\bicon\s*=\s*(["']).*?\1/.test(metadata)) return metadata.replace(/\bicon\s*=\s*(["']).*?\1/, `icon="${safeIcon}"`);
  return metadata.replace(/<vmtemplate\b/, `<vmtemplate icon="${safeIcon}"`);
}

async function virsh(config: AppConfig, args: string[]): Promise<string> {
  const result = await execFileAsync("virsh", ["-c", config.libvirtUri ?? "qemu+unix:///system?socket=/var/run/libvirt/libvirt-sock", ...args], { timeout: 12_000, maxBuffer: 2 * 1024 * 1024 });
  return result.stdout.trim();
}

async function removeLegacyVmMetadata(config: AppConfig, vmId: string, live: boolean): Promise<void> {
  try {
    await virsh(config, ["metadata", vmId, "--uri", LEGACY_VM_METADATA_URI, "--remove", live ? "--live" : "--config"]);
  } catch { /* Versions before 0.1.21 may have left bad-namespace metadata; absence is expected. */ }
}

async function copyVmIcon(source: string, target: string): Promise<void> {
  try {
    const metadata = await lstat(target);
    if (metadata.isSymbolicLink() || !metadata.isFile()) await unlink(target);
  } catch { /* Missing target is expected on first use. */ }
  await copyFile(source, target);
}

export async function listVirtualMachines(config: AppConfig): Promise<{ vms: ManagedVirtualMachine[]; libvirtAvailable: boolean }> {
  if (!existsSync("/var/run/libvirt/libvirt-sock")) return { vms: [], libvirtAvailable: false };
  try {
    const names = (await virsh(config, ["list", "--all", "--name"])).split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
    const vms = await Promise.all(names.map(async (domain) => {
      const parsed = parseVmDomainXml(await virsh(config, ["dumpxml", domain, "--inactive"]));
      const state = await virsh(config, ["domstate", parsed.id]);
      if (parsed.icon && /^[a-f0-9]{64}\.png$/.test(parsed.icon)) {
        const source = join(config.iconsDir, parsed.icon);
        const target = join(config.vmIconsDir ?? "/unraid/vm-icons", parsed.icon);
        if (existsSync(source) && !existsSync(target)) {
          await mkdir(config.vmIconsDir ?? "/unraid/vm-icons", { recursive: true });
          await copyVmIcon(source, target);
        }
      }
      return { id: parsed.id, name: parsed.name, state, icon: parsed.icon, displayIcon: parsed.icon ? `/api/vms/icon/${encodeURIComponent(parsed.icon)}` : null };
    }));
    return { vms, libvirtAvailable: true };
  } catch { return { vms: [], libvirtAvailable: false }; }
}

export async function updateVirtualMachineIcon(config: AppConfig, vmId: string, sourcePng: string, fileName: string): Promise<ManagedVirtualMachine> {
  if (!/^[0-9a-f-]{36}$/i.test(vmId)) throw new Error("虚拟机 UUID 无效");
  if (!/^[a-f0-9]{64}\.png$/.test(fileName)) throw new Error("VM 图标文件名无效");
  const xml = await virsh(config, ["dumpxml", vmId, "--inactive"]);
  const parsed = parseVmDomainXml(xml);
  const vmIconsDir = config.vmIconsDir ?? "/unraid/vm-icons";
  await mkdir(vmIconsDir, { recursive: true });
  await copyVmIcon(sourcePng, join(vmIconsDir, fileName));
  const metadata = replaceVmMetadataIcon(parsed.metadata, fileName, parsed.name);
  await virsh(config, ["metadata", vmId, "--uri", UNRAID_VM_METADATA_URI, "--key", "vmtemplate", "--set", metadata, "--config"]);
  const state = await virsh(config, ["domstate", vmId]);
  await removeLegacyVmMetadata(config, vmId, false);
  if (/running/i.test(state)) {
    await virsh(config, ["metadata", vmId, "--uri", UNRAID_VM_METADATA_URI, "--key", "vmtemplate", "--set", metadata, "--live"]);
    await removeLegacyVmMetadata(config, vmId, true);
  }
  return { id: parsed.id, name: parsed.name, state, icon: fileName, displayIcon: `/api/vms/icon/${encodeURIComponent(fileName)}` };
}
