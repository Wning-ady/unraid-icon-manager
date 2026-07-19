# Changelog

## 0.1.14

- Correct Compose Manager container-card guidance so the UI accurately states that explicit synchronization updates the selected service override and recreates only that container.

## 0.1.13

- Make explicit Unraid synchronization update the immutable `net.unraid.docker.icon` label by recreating only selected containers while preserving binds, named volumes, ports, environment, restart policy, networks, and stopped/running state.
- Persist Compose Manager icons by atomically updating only the selected service in `docker-compose.override.yml`; leave the main Compose file and unrelated services untouched and restore the prior override/container after failures.
- Require the narrowly scoped Compose Manager projects mount and document the Docker mutation risk accurately.
- Add per-wallpaper copy actions for the selected file's complete HTTP URL and complete Unraid host path.
- Mark rollbacks as requiring another synchronization so runtime labels are restored as well as templates and caches.

## 0.1.12

- Make Chinese the primary GitHub README and keep English as supplementary documentation.
- Add a clear disclosure that the project is built entirely with AI assistance.
- Document every Docker Compose field, environment variable, port, mount, permission, security option, upgrade step, and rollback consideration.
- Make the Compose image tag, host WebUI port, time zone, config host directory, icon host root, and upload limit configurable with truthful `.env.example` defaults.
- Add `no-new-privileges` to the Compose example to match the Unraid template.
- Download external icon URLs into the persistent gallery before changing templates or caches, with redirect, size, type and local-network protections.
- Add safe icon deletion, stable-address and host/container root copy actions, and preserve assets referenced by templates or audit history.
- Add a separate wallpaper gallery with uploads, public-URL imports, downloads, deletion, host/container root copy actions, manual groups and per-wallpaper classification.
- Apply the new project icon to the Web UI, favicon, Apple touch icon, README and Unraid template metadata.
- Upgrade the static-file and Docker client dependencies to patched releases and add zero-vulnerability production dependency verification.

## 0.1.11

- Render external `net.unraid.docker.icon` labels through the same Unraid WebGUI cache URL used on the Docker page, avoiding direct browser requests to third-party icon hosts.

## 0.1.10

- Display the exact `net.unraid.docker.icon` used by Unraid when a Compose container points to an HTTP(S) icon or a host path under `/mnt/user` and no materialized cache is available.
- Resolve host-path labels through the configured Unraid WebGUI origin without mounting or reading arbitrary Compose project directories.

## 0.1.9

- Show the icon that Unraid is actually rendering from its current RAM or persistent cache, including Compose containers without a matching user template.
- Keep the displayed Unraid icon separate from the editable template value so existing Compose icons are visible without treating cached state as persistent metadata.
- Compact recent-change entries into small before/after thumbnails, retain full icon addresses in expandable details, and offer rollback only for the latest change that is still active.
- Link new rollback audit events to the change they restore so history labels distinguish applied, reverted, and rollback events.

## 0.1.8

- Use the file modification time for gallery assets on Unraid filesystems that do not expose a birth time, avoiding a misleading 1970 timestamp.

## 0.1.7

- Materialize app-uploaded PNG files directly into both Unraid Docker Manager caches so running, stopped, Compose, and collapsed Compose containers update consistently.
- Back up the exact persistent and RAM cache bytes with every audit and restore them during rollback.
- Keep arbitrary external icon URLs out of the manager's network boundary: Unraid fetches those URLs after targeted cache invalidation.
- Open the configured Unraid Docker page directly from the post-change refresh button, preserving an exact cache rollback.
- Add a persistent icon gallery, gallery selection in the single-container editor, and safe icon candidates from explicit Docker/Compose and local image labels.
- Replace saved groups with detailed audit cards showing before/after icons, status, time, and rollback.
- Show the live package version and public GitHub repository on the About page.

## 0.1.6

- Make every currently deployed Docker container eligible for an icon change: existing templates are updated and missing templates receive an auditable, manager-generated template without changing Compose files or recreating containers.
- Serve uploaded icons from the configured `PUBLIC_BASE_URL` over HTTP(S), which Unraid Docker Manager can fetch reliably.
- Invalidate only the target container's persistent and RAM Docker Manager icon-cache files so the Docker page can display the new icon after refresh.
- Add explicit Docker-page refresh configuration through `UNRAID_DOCKER_URL` and document the two narrowly scoped cache mounts and their security implications.
- Refresh the dashboard with a Docker Copilot-inspired navigation shell and add an About page with the maintainer's Alipay and WeChat support QR codes.

## 0.1.5

- Open a focused single-container icon editor when an editable container card is clicked, while keeping checkboxes dedicated to bulk selection.
- Add safe previews for tool-uploaded PNG files and clear fallback messages for invalid URLs or external host paths.

## 0.1.4

- Refresh the dashboard UI with clearer container cards, selection states, and responsive layout.
- Separate Docker lifecycle state from Compose and template-persistence notices so card labels never run together.

## 0.1.3

- Add coverage for case-insensitive container/template association, icon format validation, upload size limits, path safety, and failed template-write preparation.

## 0.1.2

- List current Docker containers first and omit stale historical templates.
- Associate deployed containers with editable Unraid templates by name or template filename.
- Keep deployed containers without a template visible as read-only and reject non-deployed template writes.
- Keep Docker Compose-labelled containers read-only and require a current editable association for rollback.

## 0.1.1

- Fix Docker Hub release tags to publish `vX.Y.Z` and `vX.Y` as documented.
- Declare React runtime packages as production dependencies so container builds are reproducible.

## 0.1.0

- Initial public release with bulk icon changes, uploads, URL icons, groups, audits, and rollback.
