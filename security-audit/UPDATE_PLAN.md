# Update Plan

| Component | Current Version | Target Version | Upgrade Risk | Database Impact | Backup Need | Rollback Plan | Validation |
|---|---|---|---|---|---|---|---|
| Authentication/authorization | None | Mandatory admin identity + route authorization | Medium; affects every UI/API call | May require credential/session table or token config | Back up `/config` before schema/config work | Emergency loopback-only opt-out; previous image digest | Anonymous 401/403, authorized E2E, container/VM workflows |
| Network exposure | `0.0.0.0/[::]:8787` | management IP/loopback + authenticated proxy/VPN | Medium; can lock out users | None | Export current template/Compose | Restore prior port bind/firewall | Verify only intended subnet and Unraid self-fetch URL work |
| sharp | 0.34.5 | 0.35.3 | Medium; SemVer-major/native binary behavior | None | No database backup required, but preserve `/config` before image rollout | Pin v0.1.21/image digest | PNG/JPEG/WebP/GIF/SVG, malformed input, pixel/byte limits, amd64/arm64, npm audit |
| find-my-way | 9.6.0 | 9.7.0+ compatible lock resolution | Low | None | Lockfile commit | Restore previous lockfile | npm audit, routing and integration tests |
| Rate limit/queue/quota | None | authenticated IP/user limits, bounded queue, disk quota and pagination | Medium; tune for large galleries | Possible indexes/settings only | Back up `/config` if adding persistent quota state | Disable new limits via config | Load test, 429/507 behavior, no data deletion |
| Docker/libvirt authority | Full sockets in root web container | allow-listed helper/proxy, libvirt opt-in | High compatibility/production impact | None | Back up appdata/templates and record runtime inspect | Restore prior mounts/image | prove allowed workflows and denial of arbitrary daemon operations |
| Container user/capabilities/rootfs | root/default caps/writable | non-root, `cap_drop: ALL`, read-only rootfs + tmpfs | High; host path ownership/socket group sensitive | None | Back up `/config`; record UID/GID/modes | revert one hardening setting at a time | full Unraid Docker/Compose/VM/icon/upload test suite |
| Resource/health controls | no limits/healthcheck | benchmarked memory/CPU/PID limits + `/api/health` | Low–Medium | None | No | remove failing limit/healthcheck | stress image decode; Docker healthy/unhealthy transitions |
| Docker base image | `node:22-bookworm-slim` tag | tested immutable digest with automated updates | Low | None | No | previous digest | build/test amd64+arm64, Trivy image scan |
| GitHub Actions | 11 mutable `@vN` references | full commit SHAs with update bot | Low | None | Git history | revert individual action pin | CI/release dry run, least permissions |
| Image/SBOM policy | build only | npm audit + Trivy fs/image + SBOM/provenance/signature verification | Medium initial policy tuning | None | No | advisory/non-blocking mode initially | expected artifacts, digest/signature verification, controlled failure test |
| HTTP security controls | no Helmet/Origin policy | CSP/nosniff/frame policy + strict Origin/Host | Medium; CSP can block image previews | None | No | revert individual header/policy | UI image sources, uploads, redirects, reverse proxy and negative Origin tests |
| Bridge network | default bridge, ICC, 23 endpoints | dedicated user-defined bridge | Medium production network change | None | Record inspect/network config | reconnect default bridge | outbound imports and all app features work; peer reachability reduced |

## Notes

- Fix implementation started with explicit owner approval. Version 0.1.22 implements authentication, CSRF/Origin protection, LAN CIDR access control, rate/queue/quota limits, Sharp/find-my-way updates, data minimization, headers, health checks, Compose confinement/resource controls, a dedicated Compose network and CI production audit.
- Docker/libvirt sockets remain an intentional, documented residual authority because the product explicitly recreates selected Docker containers and updates optional VM metadata. A narrowly scoped socket helper and non-root operation need an Unraid-specific ownership/socket compatibility design before they can safely replace the current mounts.
- Production network, socket, UID/GID, capability, bind-mount and database/schema changes require explicit approval.
- Before fixes, preserve `/mnt/user/appdata/unraid-icon-manager`, the Unraid user template and the current image digest.
- Trivy, Syft, Gitleaks, Semgrep and Hadolint were unavailable in this audit; rerun them before declaring the image hardened.
