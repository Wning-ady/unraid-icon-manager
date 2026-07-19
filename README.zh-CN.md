# Unraid Icon Manager（中文说明）

[English](README.md) · 中文

<p align="center"><img src="docs/screenshot.svg" alt="Unraid Icon Manager 管理界面预览" width="760"></p>

通过轻量级、自托管 Web 管理界面批量管理 **Unraid Docker Manager** 容器图标。它仅更新已保存 Docker 模板 XML 中的 `<Icon>` 元素，**不会**停止、重启、重建或以其他方式修改您的应用容器。

> [!WARNING]
> 本工具仅可在可信局域网中使用。容器以内置 root 用户运行，以访问 Unraid 管理的 Docker socket 与模板文件；它拥有模板写入权限和 Docker 元数据读取权限。绝对不要将它直接暴露到互联网。

## 功能

- 以当前已部署 Docker 容器为列表来源，而非历史模板文件。
- 搜索并多选可编辑的 Docker Manager 容器。
- 上传 PNG、SVG、WebP 图标；上传文件将规范化为稳定的 PNG 文件。
- 使用现有的 HTTP(S) 图标 URL。
- 保存并复用容器分组。
- 一次为多个模板应用同一图标，并自动创建带时间戳的备份。
- 查看审计历史，并单独回滚每项变更。
- 仅通过 Docker socket 读取容器名称、镜像与运行状态，不会调用 Docker 变更接口。

程序先读取当前 Docker 容器，再按模板的 `<Name>` 或 `my-容器名.xml` 文件名关联 Unraid 模板。Unraid `templates-user` 中没有对应模板文件的容器仍会显示，但会明确标为只读，因为没有安全的 Docker Manager 图标持久化位置；不存在当前 Docker 容器的历史模板不会显示。v1 有意不处理 Compose 管理的容器，也不会修改 Compose 文件。

## 在 Unraid 安装

### Docker Hub 镜像

```bash
docker pull waning/unraid-icon-manager:latest
```

在 Unraid 的 **Docker** 标签页中新建容器，并配置以下三项映射：

| Unraid 主机路径 | 容器路径 | 权限 | 用途 |
| --- | --- | --- | --- |
| `/mnt/user/appdata/unraid-icon-manager` | `/config` | 读写 | 数据库、上传图标、审计记录与备份 |
| `/boot/config/plugins/dockerMan/templates-user` | `/unraid/templates-user` | 读写 | 已保存的 Docker Manager 模板 XML |
| `/var/run/docker.sock` | `/var/run/docker.sock` | 只读 | 容器名称、镜像与运行状态 |

将容器的 TCP `8787` 端口映射到一个空闲主机端口，随后打开 `http://你的_UNRAID_IP:8787`。

也可将 [`unraid/template.xml`](unraid/template.xml) 复制到 `/boot/config/plugins/dockerMan/templates-user/`，再从 Unraid **Add Container** 的模板列表选择 **unraid-icon-manager**。

### Docker Compose

仓库中的 [`docker-compose.yml`](docker-compose.yml) 使用相同的可信局域网配置：

```bash
docker compose up -d
```

若 `/config` 的主机位置不同，请设置 `ICON_HOST_ROOT`。它必须是宿主机 `icons` 目录的**绝对路径**，因为 Unraid 会把该路径写入模板的 `<Icon>` 字段。

## 使用与恢复

1. 选择一个或多个容器。
2. 粘贴 HTTPS 图标 URL，或上传一张图片。
3. 点击 **应用到 N 个容器**。
4. 刷新 Unraid 的 Docker 页面；本工具不会重启容器。

每次编辑都会在 `/config/backups/` 保存原始 XML，并出现在 **最近变更** 中。点击 **回滚** 即可恢复该模板；完成后请刷新 Unraid Docker 页面。

## 升级与回滚

- 升级前保留 `/config` 映射；它包含图标、分组、审计记录和模板备份。
- 拉取新镜像后，在 Unraid Docker 页面更新容器即可；应用容器不会被本工具重建。
- 若需要撤销单项图标更新，请从 **最近变更** 直接回滚；如需撤回工具版本，可在 Unraid 选择上一镜像标签并保持同一 `/config` 目录。

## 本地开发与测试

```bash
npm ci
npm run dev
npm run check
```

本地测试服务器路径请配置在 `.env.example` 中。生产镜像支持 `linux/amd64` 与 `linux/arm64`。

## 发布

推送例如 `v0.1.0` 的标签后，GitHub Actions 会发布以下 Docker Hub 标签：

- `waning/unraid-icon-manager:latest`
- `waning/unraid-icon-manager:v0.1.0`
- `waning/unraid-icon-manager:v0.1`

仓库维护者需要配置 `DOCKERHUB_USERNAME=waning` 与 `DOCKERHUB_TOKEN` 这两个 GitHub Actions Secret。凭据不会保存在仓库中。

## 安全

请阅读 [SECURITY.md](SECURITY.md)。请私下报告安全问题，且不要上传包含私有 URL、路径、挂载或密钥的诊断信息。

## 许可证

[MIT](LICENSE)
