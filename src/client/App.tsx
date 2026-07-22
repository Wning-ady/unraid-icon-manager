import { ChangeEvent, useEffect, useMemo, useState } from "react";

interface Container {
  name: string;
  id: string;
  fileName: string | null;
  icon: string | null;
  displayIcon: string | null;
  displayIconSource: "unraid-cache" | "unraid-label" | "template" | null;
  image: string;
  state: string;
  status: string;
  composeManaged: boolean;
  templateState: "linked" | "will-create" | "generated";
  iconCandidates: Array<{ value: string; source: "container-label" | "image-label" | "unraid-template"; labelKey: string }>;
}
interface Audit { id: number; containerName: string; oldIcon: string | null; newIcon: string | null; createdAt: string; result: string; revertsAuditId: number | null; revertedByAuditId: number | null; }
interface StoredIcon { fileName: string; previewUrl: string; icon: string; bytes: number; createdAt: string; }
interface WallpaperGroup { id: number; name: string; createdAt: string; }
interface StoredWallpaper { fileName: string; previewUrl: string; downloadUrl: string; url: string; bytes: number; width: number; height: number; mimeType: string; groupId: number | null; createdAt: string; }
interface AboutMeta { version: string; githubUrl: string; iconHostRoot: string; iconContainerRoot: string; wallpaperHostRoot: string; wallpaperContainerRoot: string; }
interface UiSettings { theme: "light" | "dark"; wallpaperFileName: string | null; glassBlur: number; }

function iconPreviewSource(value: string): string | null {
  if (/^https?:\/\//i.test(value)) return value;
  if (/^\/api\/containers\/icon-cache\/[A-Za-z0-9_.%-]+$/.test(value)) return value;
  const fileName = value.split("/").pop() ?? "";
  return /^[a-f0-9]{64}\.png$/.test(fileName) ? `/api/icons/file/${fileName}` : null;
}

function IconPreview({ value, alt }: { value: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [value]);
  const source = (() => { const fileName = value.split("/").pop() ?? ""; return /^[a-f0-9]{64}\.png$/.test(fileName) ? `/api/icons/file/${fileName}` : null; })();
  if (!value) return <span className="preview-message">尚未选择图标</span>;
  if (failed) return <span className="preview-message error">图库图标无法预览，请重新选择。</span>;
  if (!source) return <span className="preview-message">保存时会先下载、校验并自动加入图标图库</span>;
  return <img src={source} alt={alt} onError={() => setFailed(true)} />;
}

function ContainerIcon({ value }: { value: string | null }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [value]);
  const source = iconPreviewSource(value ?? "");
  return <div className="icon">{source && !failed ? <img src={source} alt="" onError={() => setFailed(true)} /> : "▣"}</div>;
}

function AuditIcon({ value, label }: { value: string | null; label: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [value]);
  const source = iconPreviewSource(value ?? "");
  return <div className="audit-icon"><div className="audit-thumb">{source && !failed ? <img src={source} alt={label} onError={() => setFailed(true)} /> : <b>—</b>}</div><div className="audit-icon-copy"><span>{label}</span><small title={value ?? "无图标"}>{value ?? "无图标"}</small></div></div>;
}

function stateLabel(state: string): string {
  const labels: Record<string, string> = { running: "运行中", exited: "已停止", created: "已创建", paused: "已暂停", restarting: "重启中", dead: "已失效" };
  return labels[state.toLowerCase()] ?? state;
}

function templateNote(container: Container): string {
  const template = container.templateState === "linked" ? "已关联 Unraid 模板" : container.templateState === "generated" ? "使用本工具生成的图标元数据模板" : "首次保存将创建 Unraid 模板";
  return container.composeManaged ? `Compose Manager 容器 · ${template}；保存后同步会更新 override，并只重建此容器` : template;
}

function ContainerCardBody({ container }: { container: Container }) {
  return <><ContainerIcon value={container.displayIcon} /><div className="card-content"><div className="card-topline"><strong>{container.name}</strong><span className={`state ${container.state}`} title={container.status}>{stateLabel(container.state)}</span></div><p className="image-name">{container.image}</p><p className={`template-note ${container.templateState === "will-create" ? "will-create" : "editable"}`}>{templateNote(container)}</p></div></>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, ...init });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.message ?? `Request failed (${response.status})`); }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export function App() {
  const [containers, setContainers] = useState<Container[]>([]);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [gallery, setGallery] = useState<StoredIcon[]>([]);
  const [wallpapers, setWallpapers] = useState<StoredWallpaper[]>([]);
  const [wallpaperGroups, setWallpaperGroups] = useState<WallpaperGroup[]>([]);
  const [about, setAbout] = useState<AboutMeta>({ version: "…", githubUrl: "https://github.com/Wning-ady/unraid-icon-manager", iconHostRoot: "", iconContainerRoot: "/config/icons", wallpaperHostRoot: "", wallpaperContainerRoot: "/config/wallpapers" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [icon, setIcon] = useState("");
  const [notice, setNotice] = useState("正在加载…");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Container | null>(null);
  const [modalIcon, setModalIcon] = useState("");
  const [modalError, setModalError] = useState("");
  const [showModalGallery, setShowModalGallery] = useState(false);
  const [lastAppliedIds, setLastAppliedIds] = useState<string[]>([]);
  const [lastRefreshUrl, setLastRefreshUrl] = useState("");
  const [lastRefreshNeedsSync, setLastRefreshNeedsSync] = useState(false);
  const [refreshingUnraid, setRefreshingUnraid] = useState(false);
  const [page, setPage] = useState<"dashboard" | "gallery" | "wallpapers" | "about">("dashboard");
  const [dockerAvailable, setDockerAvailable] = useState<boolean | null>(null);
  const [pendingIconDelete, setPendingIconDelete] = useState("");
  const [pendingWallpaperDelete, setPendingWallpaperDelete] = useState("");
  const [wallpaperUrl, setWallpaperUrl] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [selectedWallpaperGroup, setSelectedWallpaperGroup] = useState<number | "all" | "none">("all");
  const [theme, setTheme] = useState<UiSettings["theme"]>("dark");
  const [activeWallpaperFileName, setActiveWallpaperFileName] = useState<string | null>(null);
  const [glassBlur, setGlassBlur] = useState(12);

  const refresh = async (message?: string) => {
    try {
      const [containerData, auditData, galleryData, aboutData, wallpaperData, groupData, uiSettings] = await Promise.all([
        request<{ containers: Container[]; dockerAvailable: boolean }>("/api/containers"), request<Audit[]>("/api/audits"),
        request<StoredIcon[]>("/api/icons"), request<AboutMeta>("/api/about"), request<StoredWallpaper[]>("/api/wallpapers"), request<WallpaperGroup[]>("/api/wallpaper-groups"), request<UiSettings>("/api/ui-settings")
      ]);
      setContainers(containerData.containers); setAudits(auditData);
      setGallery(galleryData); setAbout(aboutData);
      setWallpapers(wallpaperData); setWallpaperGroups(groupData);
      setTheme(uiSettings.theme); setActiveWallpaperFileName(uiSettings.wallpaperFileName); setGlassBlur(uiSettings.glassBlur);
      setDockerAvailable(containerData.dockerAvailable);
      setSelected((previous) => new Set(containerData.containers.filter((container) => previous.has(container.id)).map((container) => container.id)));
      setNotice(message ?? (containerData.dockerAvailable ? `已读取 ${containerData.containers.length} 个当前 Docker 容器；点击任意容器即可设置图标。` : "Docker socket 不可用，因此无法读取当前已部署容器。"));
    } catch (error) { setNotice(`加载失败：${error instanceof Error ? error.message : "未知错误"}`); }
  };
  useEffect(() => { void refresh(); }, []);

  const activeWallpaper = wallpapers.find((asset) => asset.fileName === activeWallpaperFileName) ?? null;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.wallpaper = activeWallpaper ? "active" : "none";
    document.documentElement.style.setProperty("--app-wallpaper-image", activeWallpaper ? `url(${JSON.stringify(activeWallpaper.previewUrl)})` : "none");
    document.documentElement.style.setProperty("--glass-blur", `${glassBlur}px`);
  }, [theme, activeWallpaper, glassBlur]);

  const filtered = useMemo(() => containers.filter((container) => `${container.name} ${container.image ?? ""}`.toLowerCase().includes(query.toLowerCase())), [containers, query]);
  const linkedCount = containers.filter((container) => container.templateState !== "will-create").length;
  const runningCount = containers.filter((container) => container.state.toLowerCase() === "running").length;
  const stoppedCount = containers.filter((container) => container.state.toLowerCase() === "exited").length;
  const filteredWallpapers = wallpapers.filter((asset) => selectedWallpaperGroup === "all" || (selectedWallpaperGroup === "none" ? asset.groupId === null : asset.groupId === selectedWallpaperGroup));
  const wallpaperTargetName = typeof selectedWallpaperGroup === "number" ? wallpaperGroups.find((group) => group.id === selectedWallpaperGroup)?.name ?? "未分类" : "未分类";
  const actionableAuditIds = useMemo(() => {
    const ids = new Set<number>();
    const seenContainers = new Set<string>();
    const byName = new Map(containers.map((container) => [container.name, container]));
    for (const audit of audits) {
      if (seenContainers.has(audit.containerName)) continue;
      seenContainers.add(audit.containerName);
      const container = byName.get(audit.containerName);
      if (audit.result === "applied" && !audit.revertedByAuditId && container?.icon === audit.newIcon) ids.add(audit.id);
    }
    return ids;
  }, [audits, containers]);
  const toggle = (container: Container) => setSelected((old) => {
    const next = new Set(old);
    if (next.has(container.id)) next.delete(container.id); else next.add(container.id);
    return next;
  });
  const selectAll = () => setSelected(new Set(filtered.map((container) => container.id)));
  const closeEditor = () => { if (!busy) { setEditing(null); setModalError(""); setShowModalGallery(false); } };
  const openEditor = (container: Container) => { setEditing(container); setModalIcon(container.icon ?? ""); setModalError(""); setShowModalGallery(false); };

  async function uploadFile(file: File): Promise<string> {
    const contentBase64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
    const result = await request<{ icon: string }>("/api/icons/upload", { method: "POST", body: JSON.stringify({ contentBase64 }) });
    setGallery(await request<StoredIcon[]>("/api/icons"));
    return result.icon;
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    setBusy(true);
    try { setIcon(await uploadFile(file)); setNotice("上传完成，已转换为 PNG；选择容器后点击应用。"); }
    catch (error) { setNotice(`上传失败：${error instanceof Error ? error.message : "未知错误"}`); } finally { setBusy(false); }
  }

  async function uploadForModal(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    setBusy(true); setModalError("");
    try { setModalIcon(await uploadFile(file)); }
    catch (error) { setModalError(`上传失败：${error instanceof Error ? error.message : "未知错误"}`); }
    finally { setBusy(false); }
  }

  async function applyTo(containerIds: string[], nextIcon: string, onSuccess?: () => void) {
    setBusy(true);
    try {
      const result = await request<{ notice: string; refreshUrl: string; icon: string }>("/api/icons/apply", { method: "POST", body: JSON.stringify({ containerIds, icon: nextIcon }) });
      setIcon(result.icon); setModalIcon(result.icon); setLastAppliedIds(containerIds); setLastRefreshUrl(result.refreshUrl); setLastRefreshNeedsSync(true); onSuccess?.(); await refresh(result.notice || "图标已保存；容器未重启。");
    } finally { setBusy(false); }
  }

  async function apply() {
    try { await applyTo([...selected], icon); }
    catch (error) { setNotice(`应用失败：${error instanceof Error ? error.message : "未知错误"}`); }
  }

  async function applyOne() {
    if (!editing) return;
    try { await applyTo([editing.id], modalIcon, () => setEditing(null)); }
    catch (error) { setModalError(`保存失败：${error instanceof Error ? error.message : "未知错误"}`); }
  }

  async function refreshUnraid() {
    if (!lastAppliedIds.length) return;
    setRefreshingUnraid(true);
    const unraidWindow = window.open(lastRefreshNeedsSync || !lastRefreshUrl ? "about:blank" : lastRefreshUrl, "_blank");
    try {
      if (lastRefreshNeedsSync || !lastRefreshUrl) {
        const result = await request<{ url: string; notice: string; results: Array<{ containerId: string }> }>("/api/unraid/refresh", { method: "POST", body: JSON.stringify({ containerIds: lastAppliedIds }) });
        if (unraidWindow) unraidWindow.location.href = result.url;
        else window.open(result.url, "_blank", "noopener,noreferrer");
        setLastAppliedIds(result.results.map((entry) => entry.containerId)); setLastRefreshUrl(result.url); setLastRefreshNeedsSync(false);
        setNotice(result.notice);
      } else if (!unraidWindow) window.open(lastRefreshUrl, "_blank", "noopener,noreferrer");
      if (!lastRefreshNeedsSync) setNotice("已打开新的 Unraid Docker 页面。");
    } catch (error) { unraidWindow?.close(); setNotice(`刷新 Unraid Docker 图标失败：${error instanceof Error ? error.message : "未知错误"}`); }
    finally { setRefreshingUnraid(false); }
  }

  async function copyText(value: string, label: string) {
    if (!value) { setNotice(`${label}尚未配置`); return; }
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else { const area = document.createElement("textarea"); area.value = value; area.style.position = "fixed"; area.style.opacity = "0"; document.body.append(area); area.select(); document.execCommand("copy"); area.remove(); }
      setNotice(`${label}已复制：${value}`);
    } catch { setNotice(`复制失败，请手动复制：${value}`); }
  }

  async function removeIcon(asset: StoredIcon) {
    if (pendingIconDelete !== asset.fileName) { setPendingIconDelete(asset.fileName); return; }
    setBusy(true);
    try { await request<void>(`/api/icons/${asset.fileName}`, { method: "DELETE" }); setPendingIconDelete(""); await refresh("图标已从图库删除。"); }
    catch (error) { setNotice(`删除失败：${error instanceof Error ? error.message : "未知错误"}`); }
    finally { setBusy(false); }
  }

  async function createWallpaperGroup() {
    if (!newGroupName.trim()) return;
    setBusy(true);
    try { await request("/api/wallpaper-groups", { method: "POST", body: JSON.stringify({ name: newGroupName }) }); setNewGroupName(""); await refresh("壁纸分组已创建。"); }
    catch (error) { setNotice(`创建分组失败：${error instanceof Error ? error.message : "未知错误"}`); }
    finally { setBusy(false); }
  }

  async function uploadWallpaper(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    setBusy(true);
    try {
      const contentBase64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
      const groupId = typeof selectedWallpaperGroup === "number" ? selectedWallpaperGroup : null;
      await request("/api/wallpapers/upload", { method: "POST", body: JSON.stringify({ contentBase64, groupId }) });
      await refresh(`壁纸已上传到“${wallpaperTargetName}”分组。`);
    } catch (error) { setNotice(`上传壁纸失败：${error instanceof Error ? error.message : "未知错误"}`); }
    finally { setBusy(false); event.target.value = ""; }
  }

  async function importWallpaper() {
    if (!wallpaperUrl.trim()) return;
    setBusy(true);
    try {
      const groupId = typeof selectedWallpaperGroup === "number" ? selectedWallpaperGroup : null;
      await request("/api/wallpapers/import", { method: "POST", body: JSON.stringify({ url: wallpaperUrl, groupId }) });
      setWallpaperUrl(""); await refresh(`壁纸已从 URL 下载到“${wallpaperTargetName}”分组。`);
    } catch (error) { setNotice(`下载壁纸失败：${error instanceof Error ? error.message : "未知错误"}`); }
    finally { setBusy(false); }
  }

  async function moveWallpaper(asset: StoredWallpaper, groupId: number | null) {
    try { await request(`/api/wallpapers/${asset.fileName}`, { method: "PATCH", body: JSON.stringify({ groupId }) }); await refresh("壁纸分类已更新。"); }
    catch (error) { setNotice(`分类失败：${error instanceof Error ? error.message : "未知错误"}`); }
  }

  async function removeWallpaperAsset(asset: StoredWallpaper) {
    if (pendingWallpaperDelete !== asset.fileName) { setPendingWallpaperDelete(asset.fileName); return; }
    setBusy(true);
    try { await request<void>(`/api/wallpapers/${asset.fileName}`, { method: "DELETE" }); if (activeWallpaperFileName === asset.fileName) setActiveWallpaperFileName(null); setPendingWallpaperDelete(""); await refresh("壁纸已删除。"); }
    catch (error) { setNotice(`删除壁纸失败：${error instanceof Error ? error.message : "未知错误"}`); }
    finally { setBusy(false); }
  }

  async function updateUiSettings(patch: Partial<UiSettings>, message: string) {
    try {
      const settings = await request<UiSettings>("/api/ui-settings", { method: "PATCH", body: JSON.stringify(patch) });
      setTheme(settings.theme); setActiveWallpaperFileName(settings.wallpaperFileName); setGlassBlur(settings.glassBlur); setNotice(message);
    } catch (error) { setNotice(`外观设置失败：${error instanceof Error ? error.message : "未知错误"}`); }
  }

  async function restore(id: number) {
    if (!confirm("恢复该次修改前的模板？这不会重启容器。")) return;
    try {
      const result = await request<{ refreshUrl: string }>(`/api/audits/${id}/restore`, { method: "POST", body: "{}" });
      const audit = audits.find((entry) => entry.id === id);
      if (audit) setLastAppliedIds(containers.filter((container) => container.name === audit.containerName).map((container) => container.id));
      setLastRefreshUrl(result.refreshUrl); setLastRefreshNeedsSync(true); await refresh("已回滚模板与修改前的图标缓存；请点击同步按钮恢复运行容器标签。");
    }
    catch (error) { setNotice(`恢复失败：${error instanceof Error ? error.message : "未知错误"}`); }
  }

  return <div className="app-shell">
    <div className="wallpaper-backdrop" aria-hidden="true" />
    <aside className="sidebar">
      <button className="brand" onClick={() => setPage("dashboard")} aria-label="回到容器总览"><img className="brand-mark" src="/project-icon.png" alt="" /><span><b>Icon Manager</b><small>for Unraid</small></span></button>
      <nav aria-label="主导航"><button className={page === "dashboard" ? "nav-item active" : "nav-item"} onClick={() => setPage("dashboard")}><span>▦</span> 容器图标</button><button className={page === "gallery" ? "nav-item active" : "nav-item"} onClick={() => setPage("gallery")}><span>▧</span> 图标图库</button><button className={page === "wallpapers" ? "nav-item active" : "nav-item"} onClick={() => setPage("wallpapers")}><span>▤</span> 壁纸图库</button><button className="nav-item" onClick={() => { setPage("dashboard"); window.setTimeout(() => document.getElementById("audit-history")?.scrollIntoView({ behavior: "smooth" }), 0); }}><span>≡</span> 变更记录</button><button className={page === "about" ? "nav-item active" : "nav-item"} onClick={() => setPage("about")}><span>♡</span> 关于项目</button></nav>
      <section className="appearance-panel" aria-label="外观设置"><div className="appearance-row"><span>界面主题</span><div className="theme-switch" role="group" aria-label="日间或夜间模式"><button className={theme === "light" ? "active" : ""} aria-label="切换到日间模式" aria-pressed={theme === "light"} title="日间模式" onClick={() => void updateUiSettings({ theme: "light" }, "已切换到日间模式。")}>☀</button><button className={theme === "dark" ? "active" : ""} aria-label="切换到夜间模式" aria-pressed={theme === "dark"} title="夜间模式" onClick={() => void updateUiSettings({ theme: "dark" }, "已切换到夜间模式。")}>☾</button></div></div><label className="glass-control"><span><b>毛玻璃</b><output>{glassBlur}px</output></span><input type="range" min="0" max="30" step="1" value={glassBlur} aria-label="毛玻璃模糊强度" onChange={(event) => setGlassBlur(Number(event.target.value))} onPointerUp={(event) => void updateUiSettings({ glassBlur: Number(event.currentTarget.value) }, "毛玻璃强度已保存。") } onKeyUp={(event) => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) void updateUiSettings({ glassBlur: Number(event.currentTarget.value) }, "毛玻璃强度已保存。"); }} /></label>{activeWallpaper && <button className="clear-wallpaper" onClick={() => void updateUiSettings({ wallpaperFileName: null }, "已恢复默认背景。")}>移除当前壁纸</button>}</section>
      <div className="sidebar-footer"><span className={dockerAvailable === false ? "online-dot offline" : "online-dot"} /> {dockerAvailable === null ? "正在连接 Docker Manager" : dockerAvailable ? "Docker Manager 已连接" : "Docker Manager 未连接"}<br /><small>v{about.version} · 同步时仅重建所选容器</small></div>
    </aside>
    <main className="workspace">
      <header className="topbar"><div><p className="eyebrow">{page === "dashboard" ? "DOCKER MANAGEMENT" : "UNRAID ICON MANAGER"}</p><h1>{page === "dashboard" ? "容器图标总览" : page === "gallery" ? "图标图库" : page === "wallpapers" ? "壁纸图库" : "关于项目"}</h1></div>{page === "dashboard" && <div className="topbar-actions"><span className="summary"><b>{linkedCount}</b> 个已有模板</span><button className="secondary" onClick={() => void refresh()}>↻ 刷新列表</button></div>}</header>
      {page === "dashboard" && <>
        <p className="notice" role="status">{notice}</p>
        <section className="stats-strip" aria-label="容器统计"><div><span>总容器</span><strong>{containers.length}</strong></div><div><span>运行中</span><strong className="success">{runningCount}</strong></div><div><span>已停止</span><strong className="muted">{stoppedCount}</strong></div><div><span>已有模板</span><strong className="accent">{linkedCount}</strong></div></section>
    {lastAppliedIds.length > 0 && <section className="unraid-refresh" aria-label="同步 Unraid Docker 图标"><div><strong>{lastRefreshNeedsSync ? "需要同步运行容器标签" : "图标已经同步"}</strong><span>{lastRefreshNeedsSync ? "Docker 图标标签创建后不可修改；此操作只重建刚才选择的容器，不删除数据卷，也不影响同项目的其他服务。Compose Manager 服务会同时更新 override。" : "可以再次打开 Unraid Docker 页面查看图标。"}</span></div><button disabled={refreshingUnraid} onClick={() => void refreshUnraid()}>{refreshingUnraid ? "正在同步…" : lastRefreshNeedsSync ? "同步图标并打开 Unraid" : "打开 Unraid Docker 页面"}</button></section>}
    <section className="toolbar">
      <input aria-label="搜索容器" placeholder="搜索容器或镜像…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <button onClick={selectAll}>全选当前结果</button><button className="secondary" onClick={() => setSelected(new Set())}>清空选择</button>
      <span className="selection-count">已选 {selected.size} 个</span>
    </section>
    <section className="editor">
      <div><h2>批量设置图标</h2><label>图标 URL 或图库地址<input value={icon} placeholder="https://…" onChange={(e) => setIcon(e.target.value)} /></label><small className="field-help">外部 URL 会在保存前下载、校验并自动加入图库，不会把易失效的原地址直接写入模板。</small><label className="upload">上传 PNG / SVG / WebP<input type="file" accept="image/png,image/svg+xml,image/webp" onChange={upload} disabled={busy} /></label><button className="primary" disabled={busy || !selected.size || !icon.trim()} onClick={() => void apply()}>应用到 {selected.size} 个容器</button></div>
      <div className="preview"><h2>预览</h2><IconPreview value={icon} alt="图标预览" /><small>保存成功后一定会出现在图标图库，并使用稳定的本地地址。</small></div>
    </section>
    <section><div className="section-title"><div><h2>当前 Docker 容器</h2><span>点击任意容器直接换图标；复选框用于批量选择</span></div><span className="result-count">{filtered.length} 个结果</span></div><div className="container-grid">{filtered.map((container) => <article className={`${selected.has(container.id) ? "card selected" : "card"}`} key={container.id}><label className="card-select"><input aria-label={`批量选择 ${container.name}`} type="checkbox" checked={selected.has(container.id)} onChange={() => toggle(container)} /></label><button className="card-open" aria-label={`更换 ${container.name} 的图标`} onClick={() => openEditor(container)}><ContainerCardBody container={container} /></button></article>)}</div></section>
    <section className="audit-history" id="audit-history"><div className="section-title"><div><h2>最近变更</h2><span>这里显示每次操作的历史快照；只有当前仍生效的最新记录可以回滚</span></div><span className="result-count">{audits.length} 条</span></div><div className="audit-list">{audits.length ? audits.slice(0, 20).map((audit) => { const canRestore = actionableAuditIds.has(audit.id); const wasReverted = Boolean(audit.revertedByAuditId); return <article className="audit-detail" key={audit.id}><header><div><strong>{audit.containerName}</strong><span className={audit.result === "applied" && !wasReverted ? "audit-result applied" : "audit-result restored"}>{audit.result === "restored" ? "回滚事件" : wasReverted ? "已被回滚" : "已应用"}</span></div><div className="audit-header-actions"><time>{new Date(audit.createdAt).toLocaleString()}</time>{canRestore && <button className="secondary" onClick={() => void restore(audit.id)}>回滚</button>}</div></header><div className="audit-change"><AuditIcon value={audit.oldIcon} label="本次变更前" /><span className="audit-arrow">→</span><AuditIcon value={audit.newIcon} label="本次变更后" /></div><details className="audit-paths"><summary>查看完整图标地址</summary><div><span>本次变更前</span><code>{audit.oldIcon ?? "无图标"}</code><span>本次变更后</span><code>{audit.newIcon ?? "无图标"}</code></div></details></article>; }) : <div className="empty-gallery">还没有图标变更记录。</div>}</div></section>
      </>}
      {page === "gallery" && <section className="gallery-page"><p className="notice" role="status">{notice}</p><div className="gallery-heading"><div><h2>已保存图标</h2><p>上传或通过 URL 使用过的图片会按内容去重并保存在 <code>/config/icons</code>。</p></div><div className="gallery-heading-actions"><button className="secondary" onClick={() => void copyText(about.iconHostRoot, "图标宿主机根目录")}>复制宿主机根目录</button><button className="secondary" onClick={() => void copyText(about.iconContainerRoot, "图标容器根目录")}>复制容器根目录</button><label className="upload gallery-upload">上传新图标<input type="file" accept="image/png,image/svg+xml,image/webp" onChange={upload} disabled={busy} /></label></div></div>{gallery.length ? <div className="gallery-grid">{gallery.map((asset) => <article className="gallery-item" key={asset.fileName}><img src={asset.previewUrl} alt="图库图标" /><div><span>{new Date(asset.createdAt).toLocaleString()}</span><small>{Math.max(1, Math.round(asset.bytes / 1024))} KB</small></div><div className="gallery-item-actions"><button onClick={() => { setIcon(asset.icon); setPage("dashboard"); setNotice("已从图库选择图标，请选择容器后应用。"); }}>使用</button><button className="secondary" onClick={() => void copyText(asset.icon, "图标 HTTP 地址")}>复制 HTTP 地址</button><button className="secondary" onClick={() => void copyText(`${about.iconHostRoot.replace(/\/$/, "")}/${asset.fileName}`, "图标宿主机路径")}>复制宿主机路径</button><button className="secondary" onClick={() => void copyText(`${about.iconContainerRoot.replace(/\/$/, "")}/${asset.fileName}`, "图标容器路径")}>复制容器路径</button><button className="danger" onClick={() => void removeIcon(asset)}>{pendingIconDelete === asset.fileName ? "确认删除" : "删除"}</button>{pendingIconDelete === asset.fileName && <button className="secondary" onClick={() => setPendingIconDelete("")}>取消</button>}</div></article>)}</div> : <div className="empty-gallery">还没有图标。上传或应用一个 URL 后，它会自动出现在这里。</div>}</section>}
      {page === "wallpapers" && <section className="gallery-page wallpaper-page"><p className="notice" role="status">{notice}</p><div className="gallery-heading"><div><h2>壁纸图库</h2><p>壁纸独立保存在 <code>/config/wallpapers</code>，可上传、从公网 URL 下载并手动分类。鼠标移到壁纸上即可设为管理界面背景。</p></div><div className="gallery-heading-actions"><button className="secondary" onClick={() => void copyText(about.wallpaperHostRoot, "壁纸宿主机根目录")}>复制宿主机根目录</button><button className="secondary" onClick={() => void copyText(about.wallpaperContainerRoot, "壁纸容器根目录")}>复制容器根目录</button><label className="upload gallery-upload">上传壁纸<input type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadWallpaper} disabled={busy} /></label></div></div><div className="wallpaper-controls"><div className="group-tabs"><button className={selectedWallpaperGroup === "all" ? "active" : "secondary"} onClick={() => setSelectedWallpaperGroup("all")}>全部 ({wallpapers.length})</button><button className={selectedWallpaperGroup === "none" ? "active" : "secondary"} onClick={() => setSelectedWallpaperGroup("none")}>未分类 ({wallpapers.filter((item) => item.groupId === null).length})</button>{wallpaperGroups.map((group) => <button key={group.id} className={selectedWallpaperGroup === group.id ? "active" : "secondary"} onClick={() => setSelectedWallpaperGroup(group.id)}>{group.name} ({wallpapers.filter((item) => item.groupId === group.id).length})</button>)}</div><small className="wallpaper-target">上传和 URL 下载将保存到：<b>{wallpaperTargetName}</b></small><div className="wallpaper-tools"><input aria-label="新壁纸分组名称" value={newGroupName} placeholder="新分组名称" onChange={(event) => setNewGroupName(event.target.value)} /><button disabled={busy || !newGroupName.trim()} onClick={() => void createWallpaperGroup()}>＋ 新增分组</button><input aria-label="公网壁纸 URL" value={wallpaperUrl} placeholder="粘贴公网壁纸 URL" onChange={(event) => setWallpaperUrl(event.target.value)} /><button disabled={busy || !wallpaperUrl.trim()} onClick={() => void importWallpaper()}>下载到图库</button></div></div>{filteredWallpapers.length ? <div className="wallpaper-grid">{filteredWallpapers.map((asset) => <article className={activeWallpaperFileName === asset.fileName ? "wallpaper-item active-background" : "wallpaper-item"} key={asset.fileName}><div className="wallpaper-preview"><a href={asset.previewUrl} target="_blank" rel="noreferrer"><img src={asset.previewUrl} alt="壁纸预览" /></a><button className="set-background" onClick={() => void updateUiSettings({ wallpaperFileName: asset.fileName }, "已设置为管理界面背景。")}>{activeWallpaperFileName === asset.fileName ? "✓ 当前背景" : "设置为背景"}</button></div><div className="wallpaper-meta"><strong>{asset.width} × {asset.height}</strong><span>{Math.max(1, Math.round(asset.bytes / 1024))} KB · {new Date(asset.createdAt).toLocaleDateString()}</span><select aria-label="壁纸分组" value={asset.groupId ?? ""} onChange={(event) => void moveWallpaper(asset, event.target.value ? Number(event.target.value) : null)}><option value="">未分类</option>{wallpaperGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></div><div className="gallery-item-actions"><a className="download-button" href={asset.downloadUrl} download>下载</a><button className="secondary" onClick={() => void copyText(asset.url, "壁纸 HTTP 地址")}>复制 HTTP 地址</button><button className="secondary" onClick={() => void copyText(`${about.wallpaperHostRoot.replace(/\/$/, "")}/${asset.fileName}`, "壁纸宿主机路径")}>复制宿主机路径</button><button className="danger" onClick={() => void removeWallpaperAsset(asset)}>{pendingWallpaperDelete === asset.fileName ? "确认删除" : "删除"}</button>{pendingWallpaperDelete === asset.fileName && <button className="secondary" onClick={() => setPendingWallpaperDelete("")}>取消</button>}</div></article>)}</div> : <div className="empty-gallery">当前分类还没有壁纸。</div>}</section>}
      {page === "about" && <section className="about-page">
        <div className="about-intro"><img className="about-logo" src="/project-icon.png" alt="Unraid Icon Manager 项目图标" /><p className="eyebrow">OPEN SOURCE · SELF HOSTED</p><h2>最后的最后</h2><p>如果您觉得 Unraid Icon Manager 对您有帮助，可以请我喝一瓶快乐水。您的支持是我持续维护和更新项目的最大动力！</p><div className="project-meta"><span>当前版本 <b>v{about.version}</b></span><a href={about.githubUrl} target="_blank" rel="noreferrer">在 GitHub 查看项目 ↗</a></div><p className="about-muted">感谢每一位使用、反馈和分享这个项目的朋友。</p></div>
        <div className="donation-grid"><figure><div className="qr-frame"><img src="/donate/alipay.jpg" alt="支付宝赞赏二维码" /></div><figcaption><strong>支付宝</strong><span>扫码请我喝快乐水</span></figcaption></figure><figure><div className="qr-frame"><img src="/donate/wechat.jpg" alt="微信赞赏二维码" /></div><figcaption><strong>微信</strong><span>扫码支持持续维护</span></figcaption></figure></div>
      </section>}
      {editing && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor(); }}><section className="icon-modal" role="dialog" aria-modal="true" aria-labelledby="icon-modal-title"><div className="modal-header"><div><p className="eyebrow">单容器图标</p><h2 id="icon-modal-title">{editing.name}</h2><small>{stateLabel(editing.state)} · {editing.image}</small></div><button className="modal-close secondary" aria-label="关闭更换图标弹窗" disabled={busy} onClick={closeEditor}>×</button></div><div className="modal-body"><div className="modal-preview"><IconPreview value={modalIcon || editing.displayIcon || ""} alt={`${editing.name} 图标预览`} /></div><div><label>图标 URL 或图库地址<input autoFocus value={modalIcon} placeholder="https://…" onChange={(event) => { setModalIcon(event.target.value); setModalError(""); }} /></label><small className="field-help">外部 URL 保存时会自动下载到图库；下载或校验失败时不会修改模板。</small><div className="icon-source-actions"><label className="upload">上传 PNG / SVG / WebP<input type="file" accept="image/png,image/svg+xml,image/webp" onChange={uploadForModal} disabled={busy} /></label><button className="secondary" type="button" onClick={() => setShowModalGallery((value) => !value)}>从图库中选择</button></div>{!editing.icon && editing.iconCandidates.length > 0 && <div className="discovered-icons"><strong>发现 {editing.iconCandidates.length} 个图标候选</strong>{editing.iconCandidates.map((candidate) => <button className="secondary" key={`${candidate.source}-${candidate.value}`} onClick={() => setModalIcon(candidate.value)}>{candidate.source === "container-label" ? "Compose / 容器标签" : candidate.source === "image-label" ? "本地镜像标签" : "同镜像 Unraid 模板"}：{candidate.labelKey}</button>)}</div>}<p className="modal-hint">{editing.displayIconSource !== "template" && editing.displayIcon && !editing.icon ? "左侧显示的是 Unraid 当前实际图标；请选择候选、图库或上传后再保存。" : ""}{templateNote(editing)}。保存本身不会重建；保存后点击同步，只重建该容器并持久更新 Compose Manager override。</p>{modalError && <p className="modal-error" role="alert">{modalError}</p>}</div></div>{showModalGallery && <div className="modal-gallery">{gallery.length ? gallery.map((asset) => <button key={asset.fileName} className={modalIcon === asset.icon ? "chosen" : ""} onClick={() => { setModalIcon(asset.icon); setShowModalGallery(false); }}><img src={asset.previewUrl} alt="选择图库图标" /></button>) : <span>图库为空，请先上传一个图标。</span>}</div>}<div className="modal-actions"><button className="secondary" disabled={busy} onClick={closeEditor}>取消</button><button disabled={busy || !modalIcon.trim()} onClick={() => void applyOne()}>{busy ? "处理中…" : `仅应用到 ${editing.name}`}</button></div></section></div>}
    </main>
  </div>;
}
