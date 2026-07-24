# Asset Inventory

## Scope

- Project/host: `Wning-ady/unraid-icon-manager` and live `unraid-icon-manager` container on Unraid `192.168.2.21`
- Date: 2026-07-24 (Asia/Shanghai)
- Mode: AUDIT (read-only)
- Evidence sources: repository at commit `d8d8a83`, GitHub advisory API, `npm audit`, unauthenticated HTTP GETs, and read-only Docker/host commands over SSH

## Environment

| Item | Value | Evidence |
|---|---|---|
| OS | Unraid OS 7.3.1, amd64 | `/etc/unraid-version`; `docker info` |
| Kernel | `6.18.33-Unraid` | `uname -a` |
| Docker | Server 29.5.2, API 1.54, overlay2, cgroup v2 | `docker version`; `docker info` |
| Compose | Not used to run the audited live container | Runtime `docker inspect`; repository Compose reviewed statically |
| Environment type | Home-server/NAS production management service on trusted LAN | Live host and project documentation |

## Services

| Service | Image | Version/Digest | Status | Ports | Networks | Volumes/Mounts | User/Permissions |
|---|---|---|---|---|---|---|---|
| `unraid-icon-manager` | `waning/unraid-icon-manager:v0.1.21` | RepoDigest `sha256:e2db6fb777589edff5b0e4009034ec5cd741858361033963107e87a95e10046d` | Running, restart `unless-stopped`, no healthcheck | `0.0.0.0:8787`, `[::]:8787` | default bridge, ICC enabled, 23 endpoints | `/config`, templates, two icon caches, Compose projects, VM icons and libvirt are RW; Docker socket is mounted RO | root process; privileged=false; Docker default capability set; `no-new-privileges`; seccomp active; writable rootfs; no resource limits |

Current sample: 174–186 MiB memory, 11 PIDs, 0% CPU. The app returned 41 containers, 3 VMs and 72 audit entries without authentication during the audit.

## Sensitive Surfaces

| Surface | Location | Exposure | Notes |
|---|---|---|---|
| Web management/API | TCP 8787 | All IPv4/IPv6 interfaces; LAN reachable | No application authentication or route authorization |
| Docker daemon | `/var/run/docker.sock` | Mounted into root web container | `:ro` does not make Docker HTTP API read-only; application calls stop/remove/create/start |
| libvirt daemon | `/var/run/libvirt/libvirt-sock` | RW mount enabled live | Socket grants broader VM-management authority than icon metadata alone |
| Unraid templates | `/boot/config/plugins/dockerMan/templates-user` | RW mount | Root-owned mode 0700 on host; exposed to app process |
| Compose projects | `/mnt/user/docker` | RW mount | Host path mode 0777; application writes selected override files |
| App state | `/mnt/user/appdata/unraid-icon-manager` | RW mount | SQLite, uploads, audit history and backups; host mode 0755 |
| Image parsers | `sharp@0.34.5` / bundled libvips | Unauthenticated upload and URL-import routes | Version is affected by GHSA-f88m-g3jw-g9cj |

