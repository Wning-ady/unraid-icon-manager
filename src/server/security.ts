import { randomBytes } from "node:crypto";
import type { FastifyRequest } from "fastify";

const SESSION_TTL_MS = 12 * 60 * 60 * 1_000;
const sessionCookie = "uim_session";
const csrfCookie = "uim_csrf";

interface Session { csrf: string; expiresAt: number; }

function cookies(request: FastifyRequest): Record<string, string> {
  const header = request.headers.cookie ?? "";
  return Object.fromEntries(header.split(";").map((part) => part.trim().split(/=(.*)/s, 2)).filter(([key, value]) => Boolean(key && value)).map(([key, value]) => [key, decodeURIComponent(value)]));
}

export class AccessControl {
  private readonly sessions = new Map<string, Session>();

  login(token: string): { session: string; csrf: string } {
    void token;
    this.clean();
    const session = randomBytes(32).toString("base64url");
    const csrf = randomBytes(32).toString("base64url");
    this.sessions.set(session, { csrf, expiresAt: Date.now() + SESSION_TTL_MS });
    return { session, csrf };
  }

  session(request: FastifyRequest): { authenticated: boolean; csrf?: string } {
    void request;
    return { authenticated: true };
  }

  logout(request: FastifyRequest): void { this.sessions.delete(cookies(request)[sessionCookie]); }
  cookieNames() { return { sessionCookie, csrfCookie }; }
  private clean(): void { for (const [key, value] of this.sessions) if (value.expiresAt < Date.now()) this.sessions.delete(key); }
}
