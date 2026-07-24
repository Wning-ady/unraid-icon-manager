# Architecture Map

## Summary

- Environment: Unraid 7.3.1 home-server/NAS; one Fastify/React/SQLite container
- Public entry points: none intentionally; TCP 8787 is technically bound to every host IPv4 and IPv6 interface
- Admin entry points: unauthenticated Web UI and JSON API on 8787; Docker and libvirt Unix sockets behind the application
- Datastores: SQLite WAL database under `/config`
- Storage paths: `/config/icons`, `/config/wallpapers`, `/config/backups`, Unraid templates/caches, Compose projects and VM icon directory

## Flow

```text
LAN client (no authentication)
  -> 0.0.0.0/[::]:8787 Fastify API + React UI (root in container)
     -> SQLite and /config uploads/backups
     -> Unraid template XML + RAM/persistent icon caches (RW)
     -> Compose Manager project overrides (RW)
     -> Docker socket -> inspect and stop/remove/create/start selected containers
     -> libvirt socket -> read domains and modify VM metadata
     -> outbound HTTP(S) image importer -> public IP only -> sharp/libvips decoder
```

## Trust Boundaries

| Boundary | Services | Risk Notes |
|---|---|---|
| LAN/VPN → management UI | Browser/API → Fastify | No identity boundary; any reachable client is treated as administrator |
| Web process → Docker host | Fastify → Docker socket | Full daemon socket is available; RO bind is not an API permission control |
| Web process → VM host | Fastify/virsh → libvirt socket | Live mount grants full libvirt channel even though code intends metadata-only operations |
| Container → host files | Node process → templates/caches/Compose/appdata | Several sensitive paths are writable by a root process |
| Internet image source → native parser | downloader → sharp/libvips | SSRF controls are strong, but untrusted raster bytes reach an affected native dependency |
| CI → GitHub/Docker Hub | GitHub Actions → release credentials | Actions and base images use mutable tags rather than immutable SHAs/digests |

## Data Paths

| Data | Source | Destination | Protection | Evidence |
|---|---|---|---|---|
| Uploaded icon | unauthenticated request | `/config/icons/<sha256>.png` | byte/pixel limits, format decode, normalized hash filename | `src/server/app.ts:155-164`; `src/server/icon-service.ts:8-24` |
| Imported wallpaper | public HTTP(S) URL | `/config/wallpapers/<sha256>.*` | DNS/IP SSRF checks, redirect revalidation, size/time limits | `src/server/remote-image-service.ts:26-103`; `src/server/wallpaper-service.ts:9-24` |
| Container icon update | API target IDs + icon | template, cache, audit DB | container ID lookup, safe filenames, atomic writes/backups | `src/server/app.ts:218-279`; `src/server/template-service.ts:103-123` |
| Container synchronization | saved icon + container ID | Docker daemon, Compose override | selected-container lookup and recovery logic; no user authorization | `src/server/app.ts:338-363`; `src/server/container-sync-service.ts:158-213` |
| VM icon update | VM UUID + icon | VM icon path and libvirt metadata | UUID/hash allowlists, `execFile`, no shell | `src/server/app.ts:130-143`; `src/server/vm-service.ts:76-92` |
| Audit history | change operations | SQLite and `/config/backups` | local persistence; absolute backup paths returned by API | `src/server/database.ts:41-63`; `/api/audits` |

