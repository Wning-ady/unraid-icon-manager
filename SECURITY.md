# Security policy

This application runs as root inside its container so it can access Unraid-owned Docker template XML files, the two narrowly scoped Docker Manager icon-cache directories, and the Docker socket. Its application code reads Docker metadata only and deletes only validated `<container>-icon.png` cache targets, but Docker socket and host write mounts are privileged by nature. It is intended for a trusted local network only. Do not expose it directly to the internet.

Do not replace the documented mounts with broad `/boot`, `/var/lib/docker`, or `/usr/local/emhttp` mounts. The service does not need Compose project access and must not be granted it.

External icon and wallpaper URLs are downloaded by the service before they enter a gallery. The importer accepts only HTTP(S), limits DNS/connection/total time, redirects and bytes, rejects credentials, remote SVG and non-image responses, and blocks loopback, private, link-local, metadata and reserved network addresses. Public custom ports remain supported because many self-hosted public icon repositories use them; only validated raster image bytes are retained. Local/private image sources should be uploaded through the Web UI instead. Do not weaken these checks on a service that has Docker and Unraid host access.

Report vulnerabilities privately to the repository owner rather than opening a public issue. Do not attach diagnostics containing container labels, mount paths, WebUI URLs, or credentials.
