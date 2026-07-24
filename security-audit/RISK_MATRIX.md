# Risk Matrix

| ID | Risk | Status | Level | Score | Impact | Exposure | Exploitability | Confidence | Fix |
|---|---|---|---|---:|---:|---:|---:|---|---|
| DSA-001 | Unauthenticated high-privilege management API | Remediated in 0.1.22 | Low | 10 | 5 | 1 | 2 | High | Mandatory token, session/CSRF, trusted CIDR, login limit and route guard |
| DSA-002 | Affected sharp/libvips parses untrusted images | Remediated in 0.1.22 | Low | 6 | 3 | 1 | 2 | High | Sharp 0.35.3, blocked unneeded loaders, production audit clean |
| DSA-003 | No rate/concurrency/storage quota | Remediated in 0.1.22 | Low | 10 | 3 | 1 | 3 | High | IP rate limit, mutation queue limit, gallery quotas, bounded listing workers |
| DSA-004 | Anonymous infrastructure/path disclosure | Remediated in 0.1.22 | Low | 4 | 2 | 1 | 2 | High | Authenticated DTOs; minimal public health only |
| DSA-005 | Root + daemon sockets + RW host mounts | Potential Risk | Medium | 45 | 5 | 3 | 3 | Medium | Split helper/proxy, non-root, least privilege |
| DSA-006 | Shared default bridge/ICC with 23 endpoints | Remediated in Compose profile | Low | 9 | 3 | 1 | 3 | Medium | Dedicated user-defined bridge in Compose; Unraid uses its selected network |
| DSA-007 | Mutable supply-chain references/no scan policy | Partially remediated | Low | 10 | 4 | 1 | 2 | High | CI blocks high production dependency CVEs and pins Actions to verified SHAs; Node base-image digest/SBOM signing remain follow-up |
| DSA-008 | find-my-way HTTP/2 DoS package installed | Remediated in 0.1.22 | Low | 2 | 3 | 1 | 1 | High | Resolved to 9.7.0; `npm audit --omit=dev` clean |
| DSA-009 | Missing health/resource/confinement controls | Remediated in 0.1.22 | Low | 4 | 2 | 1 | 2 | High | Healthcheck, limits, cap-drop and read-only rootfs profiles |

## Critical and High Attack Paths

| ID | Entry | Exploit | Privilege | Impact | Fix |
|---|---|---|---|---|---|
| DSA-001 | LAN/VPN TCP 8787 | Anonymous inventory plus apply/refresh/VM write APIs | Application already has Docker/libvirt and RW mount authority | Stop/delete/recreate selected containers, persistent template/metadata changes, service disruption | Authenticate/authorize, bind to management boundary, guard privileged actions |
| DSA-002 + DSA-005 | LAN image upload/import | Potential crafted-image native parser compromise | root process with Docker/libvirt sockets | Potential host/VM takeover if code execution is achieved | Upgrade sharp, then reduce socket/root blast radius |

## Fix Validation (2026-07-24)

- `npm run check`, `npm run build`, `npm audit --omit=dev --audit-level=high`, and XML validation passed locally.
- Focused API tests verify anonymous management APIs return `401`, stable icon delivery remains `200`, login is required, and mutation requests fail without valid same-origin CSRF data.
- Docker runtime execution could not be repeated from this workstation because the Docker CLI/daemon is unavailable. Deployment must verify `cap_drop=ALL` and `read_only` against the live Unraid sockets before retaining them.
