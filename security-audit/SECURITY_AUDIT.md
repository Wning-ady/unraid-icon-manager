# Security Audit

## Project Score

- Overall score: 75/125 (highest confirmed finding; higher is worse)
- Overall risk: High on the current trusted LAN; Critical if TCP 8787 is exposed to an untrusted/public network
- Confidence: High for source/config/runtime; Medium for image CVEs because Trivy/Syft were unavailable
- Scope: repository, dependencies, live Unraid container/runtime, reachable HTTP interface and supply chain
- Date: 2026-07-24

## Executive Summary

The project has good path containment, SSRF, upload-size, image-type, atomic-write and rollback controls. It is not safe as a generally reachable LAN admin service yet: every client that can reach port 8787 is implicitly an administrator. Runtime evidence confirms the service is bound to all IPv4 and IPv6 interfaces, runs as root, and holds Docker/libvirt sockets plus several RW host paths. Source evidence confirms unauthenticated routes can write templates and VM metadata and can stop, remove, recreate and start selected containers.

The second immediate concern is `sharp@0.34.5`, which processes unauthenticated raster inputs and is affected by a High GitHub advisory inherited from libvips. The exact exploit impact was not proven here, so it is rated Medium in context, but it increases the importance of the socket/root blast-radius finding.

No secrets matching high-confidence GitHub, Docker Hub, AWS or private-key patterns were found in tracked files or Git history. This was an heuristic scan only because Gitleaks was unavailable.

## Tool Coverage

| Tool/Check | Status | Evidence | Confidence Impact |
|---|---|---|---|
| Environment and runtime | Completed | Docker inspect/ps/info/top/stats, host stat, HTTP GET | High confidence |
| Dockerfile/Compose/Unraid template | Completed | line-level manual/static review | High confidence |
| Web/API/source review | Completed | all Fastify routes and privileged service paths reviewed | High confidence |
| `npm audit` | Completed | 0 critical, 2 high, 0 moderate/low; 416 dependencies | High confidence for Node advisories |
| Secret heuristic/current+history | Completed | 0 high-confidence credential/private-key matches; no tracked `.env` | Medium confidence only |
| Trivy | Tool missing; not executed | no local or Unraid binary | Image/OS CVE confidence reduced |
| Syft | Tool missing; not executed | no local or Unraid binary | SBOM not generated; confidence reduced |
| Gitleaks | Tool missing; not executed | heuristic replacement only | Secret-scan confidence reduced |
| Semgrep | Tool missing; not executed | manual source review only | Pattern coverage reduced |
| Hadolint | Tool missing; not executed | manual Dockerfile review only | Lint coverage reduced |

## Findings

### DSA-001 — Unauthenticated high-privilege management API

- Status: Confirmed Vulnerability
- Level: High
- Score: 75 = Impact 5 × Exposure 3 × Exploitability 5
- Confidence: High
- Location: `src/server/config.ts:24-27`; `docker-compose.yml:6-7`; `src/server/app.ts:119-143,218-279,338-405`; `src/server/container-sync-service.ts:158-213`
- Evidence: Fastify has no authentication/authorization hook. Runtime exposes `0.0.0.0:8787` and `[::]:8787`; unauthenticated GETs returned container, VM and audit inventories. Source shows unguarded write routes and stop/remove/create/start calls.
- Command Result: `docker ps` reported both all-interface bindings; unauthenticated requests returned 41 containers, 3 VMs and 72 audits.
- Impact: Any reachable LAN/VPN client can persistently modify icons/templates, alter VM metadata, and trigger stop/remove/recreate/start of selected containers. Repeated use can cause service disruption. Public exposure would make this an unauthenticated internet admin plane.
- Attack Path: reach TCP 8787 → enumerate `/api/containers` or `/api/vms` → POST apply/refresh/VM icon endpoint → privileged application changes host-backed configuration or container runtime.
- Recommendation: Add application authentication and per-route authorization. Default to a specified management IP/loopback or authenticated reverse proxy/VPN. Require explicit re-authentication/confirmation for container recreation. Add strict Origin/Host checks after the authentication design is chosen.
- Validation: Anonymous inventory and write requests must return 401/403; authenticated authorized requests must still pass existing integration tests and Unraid functional checks.
- Rollback: retain a documented opt-out emergency flag restricted to loopback during migration; preserve `/config` before adding credential state.

### DSA-002 — Affected sharp/libvips processes untrusted images

- Status: Confirmed Vulnerability
- Level: Medium (upstream advisory severity: High)
- Score: 27 = Impact 3 × Exposure 3 × Exploitability 3
- Confidence: Medium
- Location: `package-lock.json` (`sharp@0.34.5`); `src/server/app.ts:130-139,155-164,291-310`; `src/server/icon-service.ts:8-15`; `src/server/wallpaper-service.ts:9-16`; `src/server/remote-image-service.ts:19-23`
- Evidence: `npm audit` maps `sharp <0.35.0` to GHSA-f88m-g3jw-g9cj. GitHub advisory states untrusted-input users are affected by libvips CVE-2026-33327, CVE-2026-33328, CVE-2026-35590 and CVE-2026-35591.
- Command Result: installed `sharp@0.34.5`; fixed release `0.35.3`; direct unauthenticated upload/import routes feed bytes to sharp.
- Impact: Crafted images may trigger affected native image-decoder behavior, including availability or memory-safety consequences described upstream. This audit did not prove RCE.
- Attack Path: LAN client uploads/imports a crafted raster → sharp/libvips parses it → affected native decoder path executes. A successful code-execution variant would chain into root/socket access.
- Recommendation: Upgrade to sharp 0.35.3 after compatibility testing. Until then, use `sharp.block` to disable GIF/TIFF/VIPS loaders where compatible; note remote GIF is currently accepted and uploads accept GIF/SVG/JPEG despite UI text being narrower.
- Validation: run unit/integration tests across PNG/JPEG/WebP/GIF/SVG, malformed files, 16M/80M pixel limits, amd64/arm64 builds, then rerun `npm audit` and an image scanner.
- Rollback: pin the previous lockfile/image digest and retain `/config`; no database migration is required.

### DSA-003 — No rate limit, concurrency bound or persistent storage quota

- Status: Confirmed Vulnerability
- Level: Medium
- Score: 45 = Impact 3 × Exposure 3 × Exploitability 5
- Confidence: High
- Location: `src/server/app.ts:52-66,155-164,218-279,290-311`; `src/server/wallpaper-service.ts:9-38`; runtime has no CPU/memory/PID limits
- Evidence: Per-request byte/pixel limits exist, but there is no IP/session rate limit, total gallery quota, disk free-space gate, pagination or queue bound. Each unique file persists; wallpaper listing performs concurrent sharp metadata reads.
- Command Result: code/manifest contain no rate-limit dependency or resource quota; Docker inspect reports Memory=0, NanoCPUs=0 and no PidsLimit.
- Impact: A LAN client can grow `/config` until storage pressure, consume CPU/memory with concurrent decodes, and queue privileged mutations, degrading Unraid and the manager.
- Attack Path: send many unique maximum-size uploads/imports and list requests → native decoding plus persistent writes/unbounded lists → resource exhaustion.
- Recommendation: Add IP/user rate limits, bounded worker concurrency, queue length, total asset/disk quota, pagination and host resource limits after benchmarking.
- Validation: load tests must show bounded memory/PIDs/queue and deterministic 429/507 responses without blocking legitimate batch changes.
- Rollback: limits should be configurable; revert settings, not stored data.

### DSA-004 — Unauthenticated infrastructure and path disclosure

- Status: Confirmed Vulnerability
- Level: Medium
- Score: 30 = Impact 2 × Exposure 3 × Exploitability 5
- Confidence: High
- Location: `src/server/app.ts:72-80,119-153`; `src/server/database.ts:48-54`; API DTOs
- Evidence: health/about expose mount roots; containers/VMs expose IDs, images and states; audits include absolute backup/cache paths.
- Command Result: anonymous GET returned full inventory and audit collections.
- Impact: Reveals topology, UUIDs, images and filesystem layout that directly support DSA-001 and later lateral movement.
- Attack Path: anonymous GET inventory/audits → collect identifiers/paths → target privileged mutation routes or other services.
- Recommendation: Authenticate inventory/audit routes; reduce public health to minimal status/version; map database records to DTOs that omit internal backup paths.
- Validation: unauthenticated responses contain no infrastructure details; authorized UI remains functional.
- Rollback: restore old DTO only if compatibility requires it; no stored-data change.

### DSA-005 — Root process with full daemon sockets and RW host paths

- Status: Potential Risk
- Level: Medium
- Score: 45 = Impact 5 × Exposure 3 × Exploitability 3
- Confidence: High for configuration, Medium for exploit chain
- Location: `Dockerfile:9-19`; `docker-compose.yml:27-45`; `unraid/template.xml:24-31`; live `docker inspect`/`docker top`
- Evidence: root Node process; writable rootfs; Docker default capabilities; Docker socket mounted RO; libvirt and templates/caches/Compose/appdata mounted RW. `no-new-privileges` and seccomp are active positive controls.
- Command Result: `User=""`, root:root process, CapDrop=null, ReadonlyRootfs=false; Docker/libvirt sockets and seven RW host paths are present.
- Impact: Any future code execution in the web process can likely become Docker-host takeover or VM/configuration compromise. RO on the socket inode does not restrict Docker API verbs.
- Attack Path: web/parser/dependency compromise → root process → Docker/libvirt socket or RW host path → privileged container/VM control/persistence.
- Recommendation: Split the UI from a narrowly allow-listed local helper or socket proxy. Research non-root UID/GID and exact ACLs; drop all capabilities and restore only proven requirements; use read-only rootfs plus tmpfs. Keep libvirt opt-in.
- Validation: run full container/Compose/VM icon workflows with denied non-allow-listed Docker/libvirt operations and unchanged appdata ownership.
- Rollback: retain current image digest and a backup of `/config`; permission/socket changes require explicit production approval.

### DSA-006 — Shared default bridge enlarges lateral-movement scope

- Status: Potential Risk
- Level: Medium
- Score: 27 = Impact 3 × Exposure 3 × Exploitability 3
- Confidence: High for topology, Medium for exploit chain
- Location: live Docker `bridge` network
- Evidence: container uses default bridge; ICC is enabled and the network has 23 endpoints.
- Command Result: runtime network inspection reported `internal=false`, `enable_icc=true`, endpoint count 23.
- Impact: A compromised manager can discover or reach other containers sharing the bridge, depending on their listeners and authentication.
- Attack Path: compromise manager → enumerate shared bridge peers → attack reachable internal services.
- Recommendation: Move the manager to a dedicated user-defined bridge and apply host/container firewall policy after checking Unraid compatibility.
- Validation: required outbound image downloads and Docker/libvirt Unix socket access work; unintended container peers are unreachable.
- Rollback: reconnect the previous bridge network; production network changes require approval.

### DSA-007 — Mutable supply-chain references and no enforced scanner/SBOM policy

- Status: Potential Risk
- Level: Low
- Score: 16 = Impact 4 × Exposure 2 × Exploitability 2
- Confidence: High
- Location: `Dockerfile:1,9,12`; `docker-compose.yml:3`; `.github/workflows/ci.yml:15-27`; `.github/workflows/release.yml:14-38`; `.dockerignore`
- Evidence: base images, release image and 11 Actions references are tag-based, not immutable digests/SHAs. CI builds but does not run npm audit, Trivy, SBOM, signature or provenance verification. `.dockerignore` does not exclude `.env*`.
- Command Result: 11 non-SHA Action references; current and history high-confidence secret patterns returned zero; all 416 lockfile sources use npmjs with integrity metadata (positive control).
- Impact: Compromised/moved upstream tags or contaminated local build contexts can alter builds or expose CI release credentials.
- Attack Path: upstream tag/action compromise or local `.env` in build context → CI/build executes or packages unintended content → malicious image/release.
- Recommendation: Pin Actions and base images to immutable SHAs/digests, add `.env*` to `.dockerignore`, add Dependabot/Renovate, Trivy, SBOM/attestation and signing with verification policy.
- Validation: CI records verified immutable references, publishes SBOM/provenance and rejects known policy-breaking vulnerabilities/secrets.
- Rollback: revert reference pins individually; no runtime data impact.

### DSA-008 — find-my-way HTTP/2 DoS package is installed but HTTP/2 is not enabled

- Status: Potential Risk
- Level: Low
- Score: 6 = Impact 3 × Exposure 1 × Exploitability 2
- Confidence: Medium
- Location: `package-lock.json` (`find-my-way@9.6.0` via `fastify@5.10.0`); `src/server/app.ts:52-55`
- Evidence: `npm audit` reports GHSA-c96f-x56v-gq3h/CVE-2026-47219, fixed in 9.7.0. The application creates a normal Fastify HTTP server and does not enable Node HTTP/2.
- Command Result: installed range is vulnerable, but the required HTTP/2 condition is absent in current source/runtime.
- Impact: If HTTP/2 is enabled later without upgrading, an unauthenticated invalid method can crash the router/server.
- Attack Path: future HTTP/2 listener → crafted method such as inherited object property → router exception/DoS.
- Recommendation: refresh the lockfile to a compatible `find-my-way >=9.7.0`; do not enable HTTP/2 before verification.
- Validation: `npm audit` clears the advisory and HTTP routing regression tests pass.
- Rollback: restore the previous lockfile; no database impact.

### DSA-009 — Missing healthcheck, resource limits and extra confinement

- Status: Potential Risk
- Level: Low
- Score: 8 = Impact 2 × Exposure 2 × Exploitability 2
- Confidence: High
- Location: `Dockerfile:16-19`; `docker-compose.yml:44-47`; live Docker inspect
- Evidence: no image/Compose healthcheck; no CPU/memory/PID limits; no CapDrop; writable rootfs; no AppArmor/SELinux/userns. Positive controls: privileged=false, no devices/host namespaces, NNP and seccomp active.
- Command Result: Config.Healthcheck=null, ReadonlyRootfs=false, CapDrop=null and all resource limits unset.
- Impact: Reduced fault detection and a larger post-compromise/resource-exhaustion blast radius.
- Attack Path: application hang or excessive work remains `running`; future compromise retains default capabilities and writable filesystem.
- Recommendation: Add `/api/health` healthcheck, benchmarked limits, `cap_drop: ALL`, non-root user and read-only rootfs/tmpfs only after functional validation.
- Validation: Docker health becomes healthy/unhealthy correctly; all Docker/Compose/VM features pass; limits do not break image processing.
- Rollback: remove the individual hardening setting that fails; preserve image digest and `/config` backup.

## Attack Chains

1. **Direct unauthorized administration:** LAN/VPN reachability → anonymous inventory → apply icon/VM mutation → trigger container stop/remove/recreate/start → service disruption and persistent host configuration changes.
2. **Parser-to-host chain (potential):** anonymous crafted image → affected sharp/libvips or future web RCE → root Node process → Docker socket → privileged container/host filesystem takeover; libvirt and RW host mounts provide additional persistence paths.
3. **Resource exhaustion:** anonymous repeated unique images/imports → sharp decoding + unbounded persistent storage/listing → appdata/CPU/memory pressure → management outage or NAS degradation.

## Fix Priority

1. P0: authentication/authorization and network restriction for port 8787.
2. P0: upgrade sharp to 0.35.3 and rescan/test both architectures.
3. P1: rate limits, bounded concurrency, quota/pagination and resource limits.
4. P1: reduce privileged blast radius with helper/proxy, non-root/cap-drop/read-only design.
5. P1: remove internal paths from unauthenticated DTOs and add security headers/Origin policy.
6. P2: dedicated network, healthcheck and immutable supply-chain/scanner policy.

## Release Recommendation

Do not expose the current release outside a tightly trusted LAN/VPN. Before any broader deployment, block on DSA-001 and DSA-002. A normal LAN-only maintenance release should still prioritize both immediately. This report is advisory only; no production or application changes were made.

