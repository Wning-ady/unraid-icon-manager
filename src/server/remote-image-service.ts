import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import ipaddr from "ipaddr.js";
import { openSafeImage } from "./image-security.js";

export function isPublicImageAddress(address: string): boolean {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === "ipv6") {
      const ipv6 = parsed as ipaddr.IPv6;
      if (ipv6.parts.slice(0, 6).every((part) => part === 0)) return false;
      if (ipv6.isIPv4MappedAddress()) parsed = ipv6.toIPv4Address();
    }
    return parsed.range() === "unicast";
  } catch { return false; }
}

export async function validateRemoteRaster(buffer: Buffer): Promise<void> {
  let format: string | undefined;
  try { format = (await openSafeImage(buffer, 80_000_000).metadata()).format; }
  catch { throw new Error("远程地址没有返回有效图片"); }
  if (!format || !["png", "jpeg", "webp"].includes(format)) throw new Error("远程图片只支持 PNG、JPEG 或 WebP，不接受远程 SVG、GIF 或 TIFF");
}

async function target(url: URL, deadline: number): Promise<{ address: string; family: 4 | 6 }> {
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("图片 URL 只支持 HTTP 或 HTTPS");
  if (url.username || url.password) throw new Error("图片 URL 不能包含用户名或密码");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const records = await Promise.race([
    lookup(url.hostname, { all: true, verbatim: true }),
    new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("解析图片地址超时")), Math.max(1, deadline - Date.now())); })
  ]).finally(() => { if (timer) clearTimeout(timer); });
  if (!records.length || records.some((record) => !isPublicImageAddress(record.address))) {
    throw new Error("为安全起见，图片 URL 不能指向本机、局域网或保留地址");
  }
  return { address: records[0].address, family: records[0].family as 4 | 6 };
}

async function requestOnce(url: URL, maxBytes: number, deadline: number): Promise<{ body?: Buffer; location?: string; status: number; contentType: string }> {
  const resolved = await target(url, deadline);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, value?: { body?: Buffer; location?: string; status: number; contentType: string }) => {
      if (settled) return; settled = true; clearTimeout(totalTimer);
      if (error) reject(error); else resolve(value!);
    };
    const requester = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = requester(url, {
      headers: { accept: "image/png,image/jpeg,image/webp,*/*;q=0.1", "accept-encoding": "identity", "user-agent": "unraid-icon-manager/0.1" },
      lookup: (_hostname, options, callback) => {
        if (typeof options === "object" && options.all) {
          (callback as (error: null, addresses: Array<{ address: string; family: 4 | 6 }>) => void)(null, [resolved]);
        } else {
          (callback as (error: null, address: string, family: 4 | 6) => void)(null, resolved.address, resolved.family);
        }
      }
    }, (response) => {
      const status = response.statusCode ?? 0;
      const contentType = String(response.headers["content-type"] ?? "").split(";", 1)[0].toLowerCase();
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume(); finish(undefined, { status, location: response.headers.location, contentType }); return;
      }
      if (status < 200 || status >= 300) { response.resume(); finish(new Error(`下载图片失败：远程服务器返回 ${status}`)); return; }
      if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") {
        response.resume(); finish(new Error("远程图片使用了不支持的压缩编码")); return;
      }
      const declared = Number(response.headers["content-length"] ?? 0);
      if (declared > maxBytes) { response.resume(); finish(new Error(`远程图片超过 ${maxBytes} 字节限制`)); return; }
      const chunks: Buffer[] = []; let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maxBytes) response.destroy(new Error(`远程图片超过 ${maxBytes} 字节限制`));
        else chunks.push(chunk);
      });
      response.on("end", () => finish(undefined, { status, contentType, body: Buffer.concat(chunks) }));
      response.on("error", (error) => finish(error));
    });
    const totalTimer = setTimeout(() => req.destroy(new Error("下载图片超过 15 秒总时限")), Math.max(1, deadline - Date.now()));
    req.setTimeout(8_000, () => req.destroy(new Error("下载图片连接超时")));
    req.on("error", (error) => finish(error)); req.end();
  });
}

export async function downloadRemoteImage(rawUrl: string, maxBytes: number): Promise<Buffer> {
  let url = new URL(rawUrl);
  const deadline = Date.now() + 15_000;
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const result = await requestOnce(url, maxBytes, deadline);
    if (!result.location) {
      if (!result.body?.length) throw new Error("远程图片为空");
      if (result.contentType && !["image/png", "image/jpeg", "image/webp", "application/octet-stream"].includes(result.contentType)) {
        throw new Error(`远程地址不是支持的图片类型：${result.contentType}`);
      }
      await validateRemoteRaster(result.body);
      return result.body;
    }
    if (redirect === 3) throw new Error("远程图片重定向次数过多");
    const next = new URL(result.location, url);
    if (url.protocol === "https:" && next.protocol !== "https:") throw new Error("拒绝从 HTTPS 降级到 HTTP 的重定向");
    url = next;
  }
  throw new Error("无法下载远程图片");
}
