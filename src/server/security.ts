import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import ipaddr from "ipaddr.js";
import type { FastifyRequest } from "fastify";
import type { AppConfig } from "./types.js";

const SESSION_TTL_MS = 12 * 60 * 60 * 1_000;
const sessionCookie = "uim_session";
const csrfCookie = "uim_csrf";

interface Session { csrf: string; expiresAt: number; }

function cookies(request: FastifyRequest): Record<string, string> {
  const header = request.headers.cookie ?? "";
  return Object.fromEntries(header.split(";").map((part) => part.trim().split(/=(.*)/s, 2)).filter(([key, value]) => Boolean(key && value)).map(([key, value]) => [key, decodeURIComponent(value)]));
}

function fixedEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function matchesNetwork(address: string, cidr: string): boolean {
  try {
    const ip = ipaddr.process(address);
    const [network, prefix] = ipaddr.parseCIDR(cidr);
    return ip.kind() === network.kind() && ip.match(network, prefix);
  } catch { return false; }
}

export class AccessControl {
  private readonly sessions = new Map<string, Session>();
  constructor(private readonly config: AppConfig) {}

  isTrusted(request: FastifyRequest): boolean {
    if (!this.config.adminToken) return true;
    // Fastify's default trustProxy=false means request.ip is the actual TCP peer, never a spoofable X-Forwarded-For header.
    return (this.config.trustedNetworks ?? []).some((network) => matchesNetwork(request.ip, network));
  }

  login(token: string): { session: string; csrf: string } | null {
    if (!this.config.adminToken || !fixedEqual(token, this.config.adminToken)) return null;
    this.clean();
    const session = randomBytes(32).toString("base64url");
    const csrf = randomBytes(32).toString("base64url");
    this.sessions.set(session, { csrf, expiresAt: Date.now() + SESSION_TTL_MS });
    return { session, csrf };
  }

  authenticated(request: FastifyRequest): boolean {
    // No token deliberately means direct unit tests can construct a focused app; loadConfig always requires it in runtime.
    if (!this.config.adminToken) return true;
    const session = this.sessions.get(cookies(request)[sessionCookie]);
    if (!session || session.expiresAt < Date.now()) return false;
    return true;
  }

  csrfValid(request: FastifyRequest): boolean {
    if (!this.config.adminToken) return true;
    const cookie = cookies(request);
    const session = this.sessions.get(cookie[sessionCookie]);
    const csrf = request.headers["x-csrf-token"];
    if (!session || typeof csrf !== "string" || !fixedEqual(csrf, session.csrf) || !fixedEqual(cookie[csrfCookie] ?? "", session.csrf)) return false;
    const origin = request.headers.origin;
    if (!origin) return false;
    try {
      if (!request.headers.host) return false;
      return new URL(origin).origin === new URL(`${request.protocol}://${request.headers.host}`).origin;
    } catch { return false; }
  }

  session(request: FastifyRequest): { authenticated: boolean; csrf?: string } {
    if (!this.config.adminToken) return { authenticated: true };
    const current = this.sessions.get(cookies(request)[sessionCookie]);
    return current && current.expiresAt >= Date.now() ? { authenticated: true, csrf: current.csrf } : { authenticated: false };
  }

  logout(request: FastifyRequest): void { this.sessions.delete(cookies(request)[sessionCookie]); }
  cookieNames() { return { sessionCookie, csrfCookie }; }
  private clean(): void { for (const [key, value] of this.sessions) if (value.expiresAt < Date.now()) this.sessions.delete(key); }
}
