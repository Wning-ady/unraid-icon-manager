<div align="center">

# Unraid Icon Manager

**统一管理 Unraid Docker、Compose Manager 与虚拟机图标。**

[![GitHub](https://img.shields.io/badge/GitHub-Wning--ady%2Funraid--icon--manager-181717?logo=github)](https://github.com/Wning-ady/unraid-icon-manager)
[![Release](https://img.shields.io/github/v/release/Wning-ady/unraid-icon-manager?label=Release)](https://github.com/Wning-ady/unraid-icon-manager/releases/latest)
[![Docker Pulls](https://img.shields.io/docker/pulls/waning/unraid-icon-manager?logo=docker)](https://hub.docker.com/r/waning/unraid-icon-manager)

</div>

> **纯 AI 项目**：作者本人不会编程，只是有点强迫症，看到 Unraid 里有些容器没有图标就难受，于是借助 AI 一点一点做出了这个工具。代码、测试、文档和发布流程均由 AI 协助完成。

## 项目简介

Unraid Icon Manager 是一个面向 Unraid 的自托管 Web 图标管理器。

- 点击容器或虚拟机即可更换图标
- 支持图片上传、外部 URL 和图库选择
- 外部图标自动下载、校验、转换为稳定 PNG 并保存到图库
- 图标与壁纸图库支持分组、搜索、筛选、下载和路径复制
- 更新 Docker Manager 模板与两级图标缓存
- Compose Manager 图标写入 `docker-compose.override.yml`
- 仅在用户明确点击同步时重建所选容器
- VM 图标通过 libvirt metadata 更新，无需重启虚拟机
- 保存备份与审计记录，支持单项回滚
- `/config` 持久保存数据库、图库、设置、审计与备份

## 安全警告

> **只能部署在可信局域网、管理 VLAN 或 VPN 内，绝不能直接暴露到公网。**

本服务需要访问 Docker socket；启用 VM 功能时还会访问 libvirt socket。即使 Docker socket 使用 `:ro` 挂载，也不会限制 Docker API 的高权限操作。libvirt socket 等同完整虚拟机管理权限。

从 `v0.1.22` 开始必须设置至少 24 位的 `ADMIN_TOKEN`，并可通过 `TRUSTED_NETWORKS` 限制允许访问的网段。登录保护不能代替网络隔离。

## 拉取镜像

```bash
docker pull waning/unraid-icon-manager:latest
docker pull waning/unraid-icon-manager:v0.1.22
```

镜像支持 `linux/amd64` 与 `linux/arm64`。

## 完整 Docker Compose

无需 `.env`。使用前必须完成以下修改：

1. 把 `ADMIN_TOKEN` 改成至少 24 位的随机字符串；
2. 把三处 `192.168.1.10` 改成你的 Unraid IP；
3. 如果 Compose Manager 的项目目录不是 `/mnt/user/docker`，同时修改挂载与 `COMPOSE_HOST_ROOT`。

```yaml
services:
  unraid-icon-manager:
    image: waning/unraid-icon-manager:v0.1.22
    container_name: unraid-icon-manager

    ports:
      - "8787:8787"

    environment:
      - TZ=Asia/Shanghai
      # 必填：替换为至少 24 位的随机字符串；不要保留示例值。
      - ADMIN_TOKEN=CHANGE_ME_USE_A_RANDOM_32_CHARACTER_TOKEN
      # 建议缩小为你的实际 LAN，例如 192.168.2.0/24。
      - TRUSTED_NETWORKS=127.0.0.1/32,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16
      - ICON_HOST_ROOT=/mnt/user/appdata/unraid-icon-manager/icons
      - WALLPAPER_HOST_ROOT=/mnt/user/appdata/unraid-icon-manager/wallpapers
      - ICON_CACHE_DIR=/unraid/icon-cache
      - ICON_CACHE_RAM_DIR=/unraid/icon-cache-ram
      - COMPOSE_PROJECTS_DIR=/unraid/compose-projects
      - COMPOSE_HOST_ROOT=/mnt/user/docker
      - MAX_UPLOAD_BYTES=5242880
      - MAX_WALLPAPER_BYTES=31457280
      - MAX_ICON_GALLERY_BYTES=524288000
      - MAX_WALLPAPER_GALLERY_BYTES=2147483648
      - MAX_MUTATION_QUEUE=20
      # 改成 Unraid 主机可访问的本工具地址，不能填写 localhost。
      - PUBLIC_BASE_URL=http://192.168.1.10:8787
      # 如果 Unraid WebGUI 不是 5000 端口，请直接修改。
      - UNRAID_DOCKER_URL=http://192.168.1.10:5000/Docker
      - UNRAID_VM_URL=http://192.168.1.10:5000/VMs
      - VM_ICONS_DIR=/unraid/vm-icons
      - LIBVIRT_URI=qemu+unix:///system?socket=/var/run/libvirt/libvirt-sock

    volumes:
      # 数据库、图库、审计记录和备份。
      - /mnt/user/appdata/unraid-icon-manager:/config
      # Unraid Docker Manager 用户模板。
      - /boot/config/plugins/dockerMan/templates-user:/unraid/templates-user
      # Unraid 持久图标缓存与内存图标缓存。
      - /var/lib/docker/unraid/images:/unraid/icon-cache
      - /usr/local/emhttp/state/plugins/dynamix.docker.manager/images:/unraid/icon-cache-ram
      # Compose Manager 项目；仅更新所选服务的 override 图标标签。
      - /mnt/user/docker:/unraid/compose-projects
      # :ro 不会限制 Docker API 权限。
      - /var/run/docker.sock:/var/run/docker.sock:ro
      # 可选 VM 图标功能；仅在 VM Manager 已启用时取消注释。
      # libvirt socket 具有完整 VM 管理权限。
      # - /usr/local/emhttp/plugins/dynamix.vm.manager/templates/images:/unraid/vm-icons
      # - /var/run/libvirt/libvirt-sock:/var/run/libvirt/libvirt-sock

    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    read_only: true
    tmpfs:
      - /tmp:rw,noexec,nosuid,nodev,size=64m
    pids_limit: 256
    mem_limit: 512m
    cpus: 1.0

    networks:
      - icon-manager

    restart: unless-stopped

networks:
  icon-manager:
    driver: bridge
```

生成随机管理员令牌：

```bash
openssl rand -base64 36
```

检查并启动：

```bash
docker compose config
docker compose pull
docker compose up -d
```

启动后访问 `http://你的_UNRAID_IP:8787`。

## 关键参数

| 参数 | 说明 |
| --- | --- |
| `ADMIN_TOKEN` | 必填，至少 24 位；用于 Web UI 登录，不写入数据库或日志 |
| `TRUSTED_NETWORKS` | 允许访问服务的 CIDR 列表；建议缩小为实际管理网段 |
| `PUBLIC_BASE_URL` | Unraid 主机可访问的工具地址；不能填写 `localhost` |
| `UNRAID_DOCKER_URL` | 点击刷新后打开的 Unraid Docker 页面 |
| `UNRAID_VM_URL` | 修改 VM 图标后打开的 Unraid VM 页面 |
| `COMPOSE_HOST_ROOT` | Compose Manager 的 `PROJECTS_FOLDER` 宿主机路径 |
| `MAX_ICON_GALLERY_BYTES` | 图标图库总配额，默认 500 MiB |
| `MAX_WALLPAPER_GALLERY_BYTES` | 壁纸图库总配额，默认 2 GiB |
| `MAX_MUTATION_QUEUE` | 图标写入和同步队列上限，默认 20 |

## 升级

升级前建议备份 `/mnt/user/appdata/unraid-icon-manager`，然后只更新本工具：

```bash
docker compose pull unraid-icon-manager
docker compose up -d --no-deps unraid-icon-manager
```

## 项目链接

- [GitHub 仓库](https://github.com/Wning-ady/unraid-icon-manager)
- [最新发行版](https://github.com/Wning-ady/unraid-icon-manager/releases/latest)
- [完整中文文档](https://github.com/Wning-ady/unraid-icon-manager#readme)
- [安全说明](https://github.com/Wning-ady/unraid-icon-manager/blob/main/SECURITY.md)
- [问题反馈](https://github.com/Wning-ady/unraid-icon-manager/issues)
- [Unraid XML 模板](https://raw.githubusercontent.com/Wning-ady/unraid-icon-manager/main/unraid/template.xml)

