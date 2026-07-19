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
interface AboutMeta { version: string; githubUrl: string; }

function iconPreviewSource(value: string): string | null {
  if (/^https?:\/\//i.test(value)) return value;
  if (/^\/api\/containers\/icon-cache\/[A-Za-z0-9_.%-]+$/.test(value)) return value;
  const fileName = value.split("/").pop() ?? "";
  return /^[a-f0-9]{64}\.png$/.test(fileName) ? `/api/icons/file/${fileName}` : null;
}

function IconPreview({ value, alt }: { value: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [value]);
  const source = iconPreviewSource(value);
  if (!value) return <span className="preview-message">尚未选择图标</span>;
  if (failed) return <span className="preview-message error">远程图标无法预览，请检查 URL；仍可保存。</span>;
  if (!source) return <span className="preview-message">本地图标已上传，将由 Unraid Docker 页面读取</span>;
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
  return container.composeManaged ? `Compose 容器 · ${template}；不会修改 Compose 文件或重建容器` : template;
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
  const [about, setAbout] = useState<AboutMeta>({ version: "…", githubUrl: "https://github.com/Wning-ady/unraid-icon-manager" });
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
  const [page, setPage] = useState<"dashboard" | "gallery" | "about">("dashboard");
  const [dockerAvailable, setDockerAvailable] = useState<boolean | null>(null);

  const refresh = async () => {
    try {
      const [containerData, auditData, galleryData, aboutData] = await Promise.all([
        request<{ containers: Container[]; dockerAvailable: boolean }>("/api/containers"), request<Audit[]>("/api/audits"),
        request<StoredIcon[]>("/api/icons"), request<AboutMeta>("/api/about")
      ]);
      setContainers(containerData.containers); setAudits(auditData);
      setGallery(galleryData); setAbout(aboutData);
      setDockerAvailable(containerData.dockerAvailable);
      setSelected((previous) => new Set(containerData.containers.filter((container) => previous.has(container.id)).map((container) => container.id)));
      setNotice(containerData.dockerAvailable ? `已读取 ${containerData.containers.length} 个当前 Docker 容器；点击任意容器即可设置图标。` : "Docker socket 不可用，因此无法读取当前已部署容器。");
    } catch (error) { setNotice(`加载失败：${error instanceof Error ? error.message : "未知错误"}`); }
  };
  useEffect(() => { void refresh(); }, []);

  const filtered = useMemo(() => containers.filter((container) => `${container.name} ${container.image ?? ""}`.toLowerCase().includes(query.toLowerCase())), [containers, query]);
  const linkedCount = containers.filter((container) => container.templateState !== "will-create").length;
  const runningCount = containers.filter((container) => container.state.toLowerCase() === "running").length;
  const stoppedCount = containers.filter((container) => container.state.toLowerCase() === "exited").length;
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
      const result = await request<{ notice: string; refreshUrl: string }>("/api/icons/apply", { method: "POST", body: JSON.stringify({ containerIds, icon: nextIcon }) });
      setLastAppliedIds(containerIds); setLastRefreshUrl(result.refreshUrl); setLastRefreshNeedsSync(true); setNotice(result.notice || "图标已保存；容器未重启。"); onSuccess?.(); await refresh();
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
        const result = await request<{ url: string }>("/api/unraid/refresh", { method: "POST", body: JSON.stringify({ containerIds: lastAppliedIds }) });
        if (unraidWindow) unraidWindow.location.href = result.url;
        else window.open(result.url, "_blank", "noopener,noreferrer");
        setLastRefreshUrl(result.url); setLastRefreshNeedsSync(false);
      } else if (!unraidWindow) window.open(lastRefreshUrl, "_blank", "noopener,noreferrer");
      setNotice("已打开新的 Unraid Docker 页面；页面加载时会显示新图标。");
    } catch (error) { unraidWindow?.close(); setNotice(`刷新 Unraid Docker 图标失败：${error instanceof Error ? error.message : "未知错误"}`); }
    finally { setRefreshingUnraid(false); }
  }

  async function restore(id: number) {
    if (!confirm("恢复该次修改前的模板？这不会重启容器。")) return;
    try {
      const result = await request<{ refreshUrl: string }>(`/api/audits/${id}/restore`, { method: "POST", body: "{}" });
      const audit = audits.find((entry) => entry.id === id);
      if (audit) setLastAppliedIds(containers.filter((container) => container.name === audit.containerName).map((container) => container.id));
      setLastRefreshUrl(result.refreshUrl); setLastRefreshNeedsSync(false); setNotice("已回滚模板与修改前的图标缓存；请点击刷新按钮查看。"); await refresh();
    }
    catch (error) { setNotice(`恢复失败：${error instanceof Error ? error.message : "未知错误"}`); }
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => setPage("dashboard")} aria-label="回到容器总览"><span className="brand-mark">◇</span><span><b>Icon Manager</b><small>for Unraid</small></span></button>
      <nav aria-label="主导航"><button className={page === "dashboard" ? "nav-item active" : "nav-item"} onClick={() => setPage("dashboard")}><span>▦</span> 容器图标</button><button className={page === "gallery" ? "nav-item active" : "nav-item"} onClick={() => setPage("gallery")}><span>▧</span> 图标图库</button><button className="nav-item" onClick={() => { setPage("dashboard"); window.setTimeout(() => document.getElementById("audit-history")?.scrollIntoView({ behavior: "smooth" }), 0); }}><span>≡</span> 变更记录</button><button className={page === "about" ? "nav-item active" : "nav-item"} onClick={() => setPage("about")}><span>♡</span> 关于项目</button></nav>
      <div className="sidebar-footer"><span className={dockerAvailable === false ? "online-dot offline" : "online-dot"} /> {dockerAvailable === null ? "正在连接 Docker Manager" : dockerAvailable ? "Docker Manager 已连接" : "Docker Manager 未连接"}<br /><small>v{about.version} · 图标写入不会重启容器</small></div>
    </aside>
    <main className="workspace">
      <header className="topbar"><div><p className="eyebrow">{page === "dashboard" ? "DOCKER MANAGEMENT" : "UNRAID ICON MANAGER"}</p><h1>{page === "dashboard" ? "容器图标总览" : page === "gallery" ? "图标图库" : "关于项目"}</h1></div>{page === "dashboard" && <div className="topbar-actions"><span className="summary"><b>{linkedCount}</b> 个已有模板</span><button className="secondary" onClick={() => void refresh()}>↻ 刷新列表</button></div>}</header>
      {page === "dashboard" && <>
        <p className="notice" role="status">{notice}</p>
        <section className="stats-strip" aria-label="容器统计"><div><span>总容器</span><strong>{containers.length}</strong></div><div><span>运行中</span><strong className="success">{runningCount}</strong></div><div><span>已停止</span><strong className="muted">{stoppedCount}</strong></div><div><span>已有模板</span><strong className="accent">{linkedCount}</strong></div></section>
    {lastAppliedIds.length > 0 && <section className="unraid-refresh" aria-label="刷新 Unraid Docker 图标"><div><strong>图标已保存</strong><span>容器未重启。打开 Docker 页面后刷新，即可查看新图标。</span></div><button disabled={refreshingUnraid} onClick={() => void refreshUnraid()}>{refreshingUnraid ? "正在打开…" : "刷新 Unraid Docker 页面"}</button></section>}
    <section className="toolbar">
      <input aria-label="搜索容器" placeholder="搜索容器或镜像…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <button onClick={selectAll}>全选当前结果</button><button className="secondary" onClick={() => setSelected(new Set())}>清空选择</button>
      <span className="selection-count">已选 {selected.size} 个</span>
    </section>
    <section className="editor">
      <div><h2>批量设置图标</h2><label>图标 URL 或上传后的地址<input value={icon} placeholder="https://…" onChange={(e) => setIcon(e.target.value)} /></label><label className="upload">上传 PNG / SVG / WebP<input type="file" accept="image/png,image/svg+xml,image/webp" onChange={upload} disabled={busy} /></label><button className="primary" disabled={busy || !selected.size || !icon.trim()} onClick={() => void apply()}>应用到 {selected.size} 个容器</button></div>
      <div className="preview"><h2>预览</h2><IconPreview value={icon} alt="图标预览" /><small>上传图标通过本工具的 HTTP 地址提供给 Unraid，避免本地路径无法下载。</small></div>
    </section>
    <section><div className="section-title"><div><h2>当前 Docker 容器</h2><span>点击任意容器直接换图标；复选框用于批量选择</span></div><span className="result-count">{filtered.length} 个结果</span></div><div className="container-grid">{filtered.map((container) => <article className={`${selected.has(container.id) ? "card selected" : "card"}`} key={container.id}><label className="card-select"><input aria-label={`批量选择 ${container.name}`} type="checkbox" checked={selected.has(container.id)} onChange={() => toggle(container)} /></label><button className="card-open" aria-label={`更换 ${container.name} 的图标`} onClick={() => openEditor(container)}><ContainerCardBody container={container} /></button></article>)}</div></section>
    <section className="audit-history" id="audit-history"><div className="section-title"><div><h2>最近变更</h2><span>这里显示每次操作的历史快照；只有当前仍生效的最新记录可以回滚</span></div><span className="result-count">{audits.length} 条</span></div><div className="audit-list">{audits.length ? audits.slice(0, 20).map((audit) => { const canRestore = actionableAuditIds.has(audit.id); const wasReverted = Boolean(audit.revertedByAuditId); return <article className="audit-detail" key={audit.id}><header><div><strong>{audit.containerName}</strong><span className={audit.result === "applied" && !wasReverted ? "audit-result applied" : "audit-result restored"}>{audit.result === "restored" ? "回滚事件" : wasReverted ? "已被回滚" : "已应用"}</span></div><div className="audit-header-actions"><time>{new Date(audit.createdAt).toLocaleString()}</time>{canRestore && <button className="secondary" onClick={() => void restore(audit.id)}>回滚</button>}</div></header><div className="audit-change"><AuditIcon value={audit.oldIcon} label="本次变更前" /><span className="audit-arrow">→</span><AuditIcon value={audit.newIcon} label="本次变更后" /></div><details className="audit-paths"><summary>查看完整图标地址</summary><div><span>本次变更前</span><code>{audit.oldIcon ?? "无图标"}</code><span>本次变更后</span><code>{audit.newIcon ?? "无图标"}</code></div></details></article>; }) : <div className="empty-gallery">还没有图标变更记录。</div>}</div></section>
      </>}
      {page === "gallery" && <section className="gallery-page"><div className="gallery-heading"><div><h2>已保存图标</h2><p>上传过的图片按内容去重并永久保存在 <code>/config/icons</code>，重启和升级后仍可使用。</p></div><label className="upload gallery-upload">上传新图标<input type="file" accept="image/png,image/svg+xml,image/webp" onChange={upload} disabled={busy} /></label></div>{gallery.length ? <div className="gallery-grid">{gallery.map((asset) => <article className="gallery-item" key={asset.fileName}><img src={asset.previewUrl} alt="图库图标" /><div><span>{new Date(asset.createdAt).toLocaleString()}</span><small>{Math.max(1, Math.round(asset.bytes / 1024))} KB</small></div><button onClick={() => { setIcon(asset.icon); setPage("dashboard"); setNotice("已从图库选择图标，请选择容器后应用。"); }}>用于批量设置</button></article>)}</div> : <div className="empty-gallery">还没有图标。上传一次后，它会自动出现在这里。</div>}</section>}
      {page === "about" && <section className="about-page">
        <div className="about-intro"><p className="eyebrow">OPEN SOURCE · SELF HOSTED</p><h2>最后的最后</h2><p>如果您觉得 Unraid Icon Manager 对您有帮助，可以请我喝一瓶快乐水。您的支持是我持续维护和更新项目的最大动力！</p><div className="project-meta"><span>当前版本 <b>v{about.version}</b></span><a href={about.githubUrl} target="_blank" rel="noreferrer">在 GitHub 查看项目 ↗</a></div><p className="about-muted">感谢每一位使用、反馈和分享这个项目的朋友。</p></div>
        <div className="donation-grid"><figure><div className="qr-frame"><img src="/donate/alipay.jpg" alt="支付宝赞赏二维码" /></div><figcaption><strong>支付宝</strong><span>扫码请我喝快乐水</span></figcaption></figure><figure><div className="qr-frame"><img src="/donate/wechat.jpg" alt="微信赞赏二维码" /></div><figcaption><strong>微信</strong><span>扫码支持持续维护</span></figcaption></figure></div>
      </section>}
      {editing && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor(); }}><section className="icon-modal" role="dialog" aria-modal="true" aria-labelledby="icon-modal-title"><div className="modal-header"><div><p className="eyebrow">单容器图标</p><h2 id="icon-modal-title">{editing.name}</h2><small>{stateLabel(editing.state)} · {editing.image}</small></div><button className="modal-close secondary" aria-label="关闭更换图标弹窗" disabled={busy} onClick={closeEditor}>×</button></div><div className="modal-body"><div className="modal-preview"><IconPreview value={modalIcon || editing.displayIcon || ""} alt={`${editing.name} 图标预览`} /></div><div><label>图标 URL 或上传后的地址<input autoFocus value={modalIcon} placeholder="https://…" onChange={(event) => { setModalIcon(event.target.value); setModalError(""); }} /></label><div className="icon-source-actions"><label className="upload">上传 PNG / SVG / WebP<input type="file" accept="image/png,image/svg+xml,image/webp" onChange={uploadForModal} disabled={busy} /></label><button className="secondary" type="button" onClick={() => setShowModalGallery((value) => !value)}>从图库中选择</button></div>{!editing.icon && editing.iconCandidates.length > 0 && <div className="discovered-icons"><strong>发现 {editing.iconCandidates.length} 个图标候选</strong>{editing.iconCandidates.map((candidate) => <button className="secondary" key={`${candidate.source}-${candidate.value}`} onClick={() => setModalIcon(candidate.value)}>{candidate.source === "container-label" ? "Compose / 容器标签" : candidate.source === "image-label" ? "本地镜像标签" : "同镜像 Unraid 模板"}：{candidate.labelKey}</button>)}</div>}<p className="modal-hint">{editing.displayIconSource !== "template" && editing.displayIcon && !editing.icon ? "左侧显示的是 Unraid 当前实际图标；请选择候选、图库或上传后再保存。" : ""}{templateNote(editing)}。不会修改 Compose，也不会重启容器。</p>{modalError && <p className="modal-error" role="alert">{modalError}</p>}</div></div>{showModalGallery && <div className="modal-gallery">{gallery.length ? gallery.map((asset) => <button key={asset.fileName} className={modalIcon === asset.icon ? "chosen" : ""} onClick={() => { setModalIcon(asset.icon); setShowModalGallery(false); }}><img src={asset.previewUrl} alt="选择图库图标" /></button>) : <span>图库为空，请先上传一个图标。</span>}</div>}<div className="modal-actions"><button className="secondary" disabled={busy} onClick={closeEditor}>取消</button><button disabled={busy || !modalIcon.trim()} onClick={() => void applyOne()}>{busy ? "处理中…" : `仅应用到 ${editing.name}`}</button></div></section></div>}
    </main>
  </div>;
}
