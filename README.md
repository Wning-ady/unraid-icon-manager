# Unraid Icon Manager

[中文说明](README.zh-CN.md) · English

<p align="center"><img src="docs/screenshot.svg" alt="Unraid Icon Manager dashboard preview" width="760"></p>

Bulk-manage icons for **Unraid Docker Manager** containers from a small self-hosted web UI. It updates only the `<Icon>` element in your saved Docker template XML, so it does not stop, restart, recreate, or otherwise modify your application containers.

> [!WARNING]
> This app must stay on a trusted LAN. It runs as container root so it can access the Unraid-owned Docker socket and template files; it receives template write access and Docker metadata access. Do not expose it directly to the internet.

## Features

- The list starts with containers currently deployed through Docker, not historical template files.
- Search and multi-select editable Docker Manager containers.
- Upload PNG, SVG, or WebP icons; uploads are normalized to stable PNG files.
- Use an existing HTTP(S) icon URL.
- Save and reuse container groups.
- Apply one icon to many templates, with automatic timestamped backups.
- View audit history and restore an individual change.
- Read current container state through the Docker socket without issuing Docker mutations.

The app first reads the current Docker container list, then associates each container with an Unraid template by its `<Name>` or `my-container-name.xml` filename. Containers without a matching file in Unraid's `templates-user` directory remain visible, but are deliberately read-only: there is nowhere safe to persist their Docker Manager icon. Historical templates without a currently deployed Docker container are not shown. Containers carrying Docker Compose labels are also read-only, even when a same-named historical template exists; Compose files are never modified.

## Install on Unraid

### Docker Hub

```bash
docker pull waning/unraid-icon-manager:latest
```

Create the container through the Unraid Docker tab with these mappings:

| Unraid host path | Container path | Access | Purpose |
| --- | --- | --- | --- |
| `/mnt/user/appdata/unraid-icon-manager` | `/config` | Read/write | Database, uploaded icons, audit history, and backups |
| `/boot/config/plugins/dockerMan/templates-user` | `/unraid/templates-user` | Read/write | Saved Docker Manager template XML files |
| `/var/run/docker.sock` | `/var/run/docker.sock` | Read-only | Current container names, images, and status |

Map TCP port `8787` to a free host port, then open `http://YOUR_UNRAID_IP:8787`.

Alternatively, copy [`unraid/template.xml`](unraid/template.xml) to `/boot/config/plugins/dockerMan/templates-user/` and select **unraid-icon-manager** from Unraid's Add Container template list.

### Docker Compose

The included [`docker-compose.yml`](docker-compose.yml) uses the same trusted-LAN configuration:

```bash
docker compose up -d
```

Set `ICON_HOST_ROOT` if your `/config` host location differs. This value must be the **host-side absolute path** of the `icons` directory, because Unraid stores this path in its template's `<Icon>` field.

## Use and recovery

1. Select one or more containers.
2. Paste an HTTPS icon URL or upload an image.
3. Click **应用到 N 个容器**.
4. Refresh Unraid's Docker page. The tool deliberately does not restart containers.

Every edit saves the original XML under `/config/backups/` and appears in **最近变更**. Click **回滚** to restore the saved template; refresh Unraid's Docker page afterwards.

## Development

```bash
npm ci
npm run dev
npm run check
```

Set the locations in `.env.example` for a local test server. The production image targets `linux/amd64` and `linux/arm64`.

## Publishing

Push a tag such as `v0.1.0` to publish these Docker Hub tags through GitHub Actions:

- `waning/unraid-icon-manager:latest`
- `waning/unraid-icon-manager:v0.1.0`
- `waning/unraid-icon-manager:v0.1`

The repository owner must configure `DOCKERHUB_USERNAME=waning` and a `DOCKERHUB_TOKEN` GitHub Actions secret. Credentials are not stored in this repository.

## Security

See [SECURITY.md](SECURITY.md). Please report vulnerabilities privately and never upload diagnostics that contain private URLs, paths, mounts, or secrets.

## License

[MIT](LICENSE)
