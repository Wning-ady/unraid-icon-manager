# Unraid Icon Manager（中文说明）

[English](README.md) · 中文

<p align="center"><img src="docs/screenshot.svg" alt="Unraid Icon Manager 管理界面预览" width="760"></p>

通过轻量级、自托管 Web 管理界面批量管理**当前已部署** Unraid Docker 容器的图标。它只修改 Docker Manager 的图标元数据，绝不会停止、重启、重建或以其他方式修改应用容器。

> [!WARNING]
> 本服务只能放在可信局域网。它对 Docker Manager 模板与图标缓存拥有精确范围内的写权限，并通过 Docker socket 读取容器清单。即使挂载为 `:ro`，Docker socket 仍属高敏感权限；不要把服务端口、反向代理或未认证入口暴露到公网。

## 功能

- 以当前已部署 Docker 容器为列表来源，而非历史模板文件。
- 直接显示 Unraid 当前 RAM/持久缓存或明确 `net.unraid.docker.icon` 标签中的实际图标，包括图标不在用户模板内的 Compose 容器。本地标签路径通过配置的 Unraid WebGUI 地址显示，不需要挂载 Compose 项目目录。
- 每个当前容器都可设置图标：已有匹配模板时更新模板；没有模板时，自动生成带清晰标记和审计记录的专用图标元数据模板，匹配实际容器名与镜像，并避免与现有 `my-*.xml` 文件冲突。
- 不修改 Compose 文件、不调用 Docker 变更 API，也不重建 Compose、第三方或 Docker Manager 容器。
- 支持搜索、多选，并可直接点击任意容器卡片打开单容器图标编辑器。
- 每次上传都会按内容去重后持久保存到图标图库，可在编辑器中直接从图库选择。
- 可从明确的 Docker Compose/容器标签及本地镜像元数据发现图标候选；不会读取 Compose 文件、拉取镜像，也不会由服务端下载候选 URL。
- 支持 HTTP(S) 图标 URL 与 PNG/SVG/WebP 上传。上传会规范化为稳定 PNG，并以 `PUBLIC_BASE_URL` 下的 HTTP(S) URL 写入模板，供 Unraid 拉取。
- 每次修改都会创建带时间戳的模板备份与审计记录；可单项回滚。回滚只会删除本工具创建且仍匹配的生成模板。
- 本工具上传的 PNG 会直接写入目标容器的 RAM 与持久图标缓存；外部 URL 只做定向缓存失效，再由 Unraid 获取。两份旧缓存都会进入审计备份，可原样回滚。
- 通过 `UNRAID_DOCKER_URL` 提供**刷新 Docker 页面**操作。
- 提供参考 Docker Copilot 信息层级的管理界面，并在“关于”页展示可选的维护者支持二维码。

程序通过 socket 读取正在运行或已部署的 Docker 容器名、镜像和状态，再寻找容器 `<Name>` 与镜像 `<Repository>` 都匹配的 Unraid 模板。历史遗留模板不会出现在列表中。生成模板只是 Docker Manager 的图标元数据，不会变成运行中容器的配置来源，也不会修改 Compose。

## 在 Unraid 安装

### Docker Hub 镜像

```bash
docker pull waning/unraid-icon-manager:latest
```

在 Unraid **Docker** 标签页中新建容器，并配置以下映射：

| Unraid 主机路径 | 容器路径 | 权限 | 用途 |
| --- | --- | --- | --- |
| `/mnt/user/appdata/unraid-icon-manager` | `/config` | 读写 | 数据库、上传图标、审计记录与备份 |
| `/boot/config/plugins/dockerMan/templates-user` | `/unraid/templates-user` | 读写 | 现有与本工具生成的 Docker Manager 图标元数据 |
| `/var/lib/docker/unraid/images` | `/unraid/icon-cache` | 读写 | 只备份和更新发生变更的持久 Docker Manager 图标文件 |
| `/usr/local/emhttp/state/plugins/dynamix.docker.manager/images` | `/unraid/icon-cache-ram` | 读写 | 只备份和更新发生变更的 RAM 图标文件 |
| `/var/run/docker.sock` | `/var/run/docker.sock` | 只读 | 当前容器名称、镜像与运行状态 |

将 TCP `8787` 映射到空闲主机端口。然后在高级变量中填写**实际主机侧 URL**：

| 变量 | 示例 | 用途 |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | `http://192.168.1.10:8787` | Unraid 主机通过该 HTTP(S) URL 下载上传的 PNG 图标；必须使用映射后的主机端口，并能被 Unraid 主机访问。 |
| `UNRAID_DOCKER_URL` | `http://192.168.1.10/Docker` | 点击**刷新 Docker 页面**时打开的地址；如果 WebGUI 使用自定义端口，请一并填写。 |
| `ICON_HOST_ROOT` | `/mnt/user/appdata/unraid-icon-manager/icons` | 对应 `/config/icons` 的主机路径；移动 appdata 时一同修改。 |

启动后访问 `http://你的_UNRAID_IP:8787`。也可将 [`unraid/template.xml`](unraid/template.xml) 复制到 `/boot/config/plugins/dockerMan/templates-user/`，在 **Add Container** 中选择 **unraid-icon-manager**，并在应用前填写两个 URL 变量。

### Docker Compose 示例

仓库中的 [`docker-compose.yml`](docker-compose.yml) 包含相同挂载。复制环境变量示例，将两个 URL 占位符改为服务器真实地址后启动：

```bash
cp .env.example .env
docker compose up -d
```

Compose 文件会强制要求 `PUBLIC_BASE_URL`。除非 Unraid 主机确实能访问对应地址与端口，否则不要使用仅容器可见的地址，例如 `http://localhost:8787`。若移动 `/config`，请同时更新 bind mount 与 `ICON_HOST_ROOT`。

## 使用与恢复

1. 选择一个或多个当前容器，或点击单个可编辑容器。
2. 粘贴 HTTP(S) 图标 URL，或上传图片。
3. 应用图标；没有匹配模板时，本工具会先创建带标记的图标元数据模板。
4. 保存后点击**刷新 Docker 页面**。上传的 PNG 已直接写入缓存；外部 URL 会在页面打开时由 Unraid 获取。应用容器不会被重启。

每次更新都会把原始 XML 备份到 `/config/backups/`，并以紧凑的修改前/修改后历史快照记录在**最近变更**；展开记录可查看完整图标地址。只有最新且仍与当前模板一致的修改会显示**回滚**，回滚会同时恢复模板与两级 Unraid 图标缓存。若该审计记录创建了模板，只有在模板仍未被外部修改时才会删除该生成模板。完成后刷新 Docker 页面。

## 升级与回滚

- 升级时保留 `/config` 映射；其中包含图标图库、审计记录与备份。
- 拉取新镜像后，只需在 Unraid Docker 页面更新本工具容器；应用容器不会被重建。
- 从**最近变更**回滚单项图标。如需回退本工具版本，选择旧镜像标签，同时保留 `/config` 和全部五项挂载。

## 本地开发与测试

```bash
npm ci
npm run dev
npm run check
```

请在 `.env.example` 配置本地路径与可访问 URL。生产镜像支持 `linux/amd64` 与 `linux/arm64`。

## 发布

推送例如 `v0.1.10` 的标签后，GitHub Actions 会发布以下 Docker Hub 标签：

- `waning/unraid-icon-manager:latest`
- `waning/unraid-icon-manager:v0.1.10`
- `waning/unraid-icon-manager:v0.1`

仓库维护者需要配置 `DOCKERHUB_USERNAME=waning` 与 `DOCKERHUB_TOKEN` 两个 GitHub Actions Secret。凭据不会保存在仓库中。

## 安全

请阅读 [SECURITY.md](SECURITY.md)。Docker socket、模板挂载与两个缓存挂载都属于特权主机访问。不要增加宽泛的 `/boot`、`/var/lib/docker` 或 Compose 项目读写挂载；本文给出的路径是本工具精确行为所需的最小范围。请私下报告漏洞，且不要上传包含私有 URL、路径、挂载或密钥的诊断信息。

## 许可证

[MIT](LICENSE)
