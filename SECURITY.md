# Security policy

This application runs as root inside its container so it can access Unraid-owned Docker template XML files and Docker socket. Its application code reads Docker metadata only, but Docker socket access is privileged by nature. It is intended for a trusted local network only. Do not expose it directly to the internet.

Report vulnerabilities privately to the repository owner rather than opening a public issue. Do not attach diagnostics containing container labels, mount paths, WebUI URLs, or credentials.
