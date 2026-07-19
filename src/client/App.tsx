import { ChangeEvent, useEffect, useMemo, useState } from "react";

interface Container {
  name: string;
  id: string;
  fileName: string | null;
  icon: string | null;
  image: string;
  state: string;
  status: string;
  composeManaged: boolean;
  templateState: "linked" | "will-create" | "generated";
}
interface Group { id: number; name: string; containerNames: string[]; }
interface Audit { id: number; containerName: string; oldIcon: string | null; newIcon: string | null; createdAt: string; result: string; }

function iconPreviewSource(value: string): string | null {
  if (/^https?:\/\//i.test(value)) return value;
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

function stateLabel(state: string): string {
  const labels: Record<string, string> = { running: "运行中", exited: "已停止", created: "已创建", paused: "已暂停", restarting: "重启中", dead: "已失效" };
  return labels[state.toLowerCase()] ?? state;
}

function templateNote(container: Container): string {
  const template = container.templateState === "linked" ? "已关联 Unraid 模板" : container.templateState === "generated" ? "使用本工具生成的图标元数据模板" : "首次保存将创建 Unraid 模板";
  return container.composeManaged ? `Compose 容器 · ${template}；不会修改 Compose 文件或重建容器` : template;
}

function ContainerCardBody({ container }: { container: Container }) {
  const source = iconPreviewSource(container.icon ?? "");
  return <><div className="icon">{source ? <img src={source} alt="" /> : "▣"}</div><div className="card-content"><div className="card-topline"><strong>{container.name}</strong><span className={`state ${container.state}`} title={container.status}>{stateLabel(container.state)}</span></div><p className="image-name">{container.image}</p><p className={`template-note ${container.templateState === "will-create" ? "will-create" : "editable"}`}>{templateNote(container)}</p></div></>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, ...init });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.message ?? `Request failed (${response.status})`); }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export function App() {
  const [containers, setContainers] = useState<Container[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [icon, setIcon] = useState("");
  const [groupName, setGroupName] = useState("");
  const [notice, setNotice] = useState("正在加载…");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Container | null>(null);
  const [modalIcon, setModalIcon] = useState("");
  const [modalError, setModalError] = useState("");
  const [lastAppliedIds, setLastAppliedIds] = useState<string[]>([]);
  const [refreshingUnraid, setRefreshingUnraid] = useState(false);
  const [page, setPage] = useState<"dashboard" | "about">("dashboard");
  const [dockerAvailable, setDockerAvailable] = useState<boolean | null>(null);

  const refresh = async () => {
    try {
      const [containerData, groupData, auditData] = await Promise.all([
        request<{ containers: Container[]; dockerAvailable: boolean }>("/api/containers"), request<Group[]>("/api/groups"), request<Audit[]>("/api/audits")
      ]);
      setContainers(containerData.containers); setGroups(groupData); setAudits(auditData);
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
  const toggle = (container: Container) => setSelected((old) => {
    const next = new Set(old);
    if (next.has(container.id)) next.delete(container.id); else next.add(container.id);
    return next;
  });
  const selectAll = () => setSelected(new Set(filtered.map((container) => container.id)));
  const closeEditor = () => { if (!busy) { setEditing(null); setModalError(""); } };
  const openEditor = (container: Container) => { setEditing(container); setModalIcon(container.icon ?? ""); setModalError(""); };

  async function uploadFile(file: File): Promise<string> {
    const contentBase64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
    const result = await request<{ icon: string }>("/api/icons/upload", { method: "POST", body: JSON.stringify({ contentBase64 }) });
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
      const result = await request<{ notice: string }>("/api/icons/apply", { method: "POST", body: JSON.stringify({ containerIds, icon: nextIcon }) });
      setLastAppliedIds(containerIds); setNotice(result.notice || "图标已保存；容器未重启。"); onSuccess?.(); await refresh();
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
    const unraidWindow = window.open("about:blank", "_blank");
    try {
      const result = await request<{ url: string }>("/api/unraid/refresh", { method: "POST", body: JSON.stringify({ containerIds: lastAppliedIds }) });
      if (unraidWindow) unraidWindow.location.href = result.url;
      else window.open(result.url, "_blank", "noopener,noreferrer");
      setNotice("已打开新的 Unraid Docker 页面；页面加载时会显示新图标。");
    } catch (error) { unraidWindow?.close(); setNotice(`刷新 Unraid Docker 图标失败：${error instanceof Error ? error.message : "未知错误"}`); }
    finally { setRefreshingUnraid(false); }
  }

  async function saveGroup() {
    try { await request<Group>("/api/groups", { method: "POST", body: JSON.stringify({ name: groupName, containerNames: containers.filter((c) => selected.has(c.id)).map((c) => c.name) }) }); setGroupName(""); await refresh(); }
    catch (error) { setNotice(`保存分组失败：${error instanceof Error ? error.message : "未知错误"}`); }
  }

  async function restore(id: number) {
    if (!confirm("恢复该次修改前的模板？这不会重启容器。")) return;
    try {
      await request(`/api/audits/${id}/restore`, { method: "POST", body: "{}" });
      const audit = audits.find((entry) => entry.id === id);
      if (audit) setLastAppliedIds(containers.filter((container) => container.name === audit.containerName).map((container) => container.id));
      setNotice("已回滚图标并清除缓存；请点击刷新按钮查看。"); await refresh();
    }
    catch (error) { setNotice(`恢复失败：${error instanceof Error ? error.message : "未知错误"}`); }
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => setPage("dashboard")} aria-label="回到容器总览"><span className="brand-mark">◇</span><span><b>Icon Manager</b><small>for Unraid</small></span></button>
      <nav aria-label="主导航"><button className={page === "dashboard" ? "nav-item active" : "nav-item"} onClick={() => setPage("dashboard")}><span>▦</span> 容器图标</button><button className="nav-item" onClick={() => { setPage("dashboard"); window.setTimeout(() => document.getElementById("groups-and-audits")?.scrollIntoView({ behavior: "smooth" }), 0); }}><span>≡</span> 分组与记录</button><button className={page === "about" ? "nav-item active" : "nav-item"} onClick={() => setPage("about")}><span>♡</span> 关于项目</button></nav>
      <div className="sidebar-footer"><span className={dockerAvailable === false ? "online-dot offline" : "online-dot"} /> {dockerAvailable === null ? "正在连接 Docker Manager" : dockerAvailable ? "Docker Manager 已连接" : "Docker Manager 未连接"}<br /><small>v0.1.6 · 图标写入不会重启容器</small></div>
    </aside>
    <main className="workspace">
      <header className="topbar"><div><p className="eyebrow">{page === "dashboard" ? "DOCKER MANAGEMENT" : "UNRAID ICON MANAGER"}</p><h1>{page === "dashboard" ? "容器图标总览" : "关于项目"}</h1></div>{page === "dashboard" && <div className="topbar-actions"><span className="summary"><b>{linkedCount}</b> 个已有模板</span><button className="secondary" onClick={() => void refresh()}>↻ 刷新列表</button></div>}</header>
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
    <section className="split" id="groups-and-audits"><div><h2>分组</h2><div className="inline"><input placeholder="例如：媒体服务" value={groupName} onChange={(e) => setGroupName(e.target.value)} /><button disabled={!groupName || !selected.size} onClick={() => void saveGroup()}>保存当前选择</button></div>{groups.map((group) => <div className="row" key={group.id}><button className="link" onClick={() => setSelected(new Set(containers.filter((container) => group.containerNames.includes(container.name)).map((container) => container.id)))}>{group.name} · {group.containerNames.length}</button><button className="danger" onClick={() => void request(`/api/groups/${group.id}`, { method: "DELETE" }).then(refresh)}>删除</button></div>)}</div>
      <div><h2>最近变更</h2>{audits.slice(0, 6).map((audit) => <div className="row audit" key={audit.id}><span><strong>{audit.containerName}</strong><small>{new Date(audit.createdAt).toLocaleString()}</small></span>{audit.result === "applied" && <button onClick={() => void restore(audit.id)}>回滚</button>}</div>)}</div></section>
      </>}
      {page === "about" && <section className="about-page">
        <div className="about-intro"><p className="eyebrow">OPEN SOURCE · SELF HOSTED</p><h2>最后的最后</h2><p>如果您觉得 Unraid Icon Manager 对您有帮助，可以请我喝一瓶快乐水。您的支持是我持续维护和更新项目的最大动力！</p><p className="about-muted">感谢每一位使用、反馈和分享这个项目的朋友。</p></div>
        <div className="donation-grid"><figure><div className="qr-frame"><img src="/donate/alipay.jpg" alt="支付宝赞赏二维码" /></div><figcaption><strong>支付宝</strong><span>扫码请我喝快乐水</span></figcaption></figure><figure><div className="qr-frame"><img src="/donate/wechat.jpg" alt="微信赞赏二维码" /></div><figcaption><strong>微信</strong><span>扫码支持持续维护</span></figcaption></figure></div>
      </section>}
      {editing && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor(); }}><section className="icon-modal" role="dialog" aria-modal="true" aria-labelledby="icon-modal-title"><div className="modal-header"><div><p className="eyebrow">单容器图标</p><h2 id="icon-modal-title">{editing.name}</h2><small>{stateLabel(editing.state)} · {editing.image}</small></div><button className="modal-close secondary" aria-label="关闭更换图标弹窗" disabled={busy} onClick={closeEditor}>×</button></div><div className="modal-body"><div className="modal-preview"><IconPreview value={modalIcon} alt={`${editing.name} 图标预览`} /></div><div><label>图标 URL 或上传后的地址<input autoFocus value={modalIcon} placeholder="https://…" onChange={(event) => { setModalIcon(event.target.value); setModalError(""); }} /></label><label className="upload">上传 PNG / SVG / WebP<input type="file" accept="image/png,image/svg+xml,image/webp" onChange={uploadForModal} disabled={busy} /></label><p className="modal-hint">{templateNote(editing)}。不会修改 Compose，也不会重启容器。</p>{modalError && <p className="modal-error" role="alert">{modalError}</p>}</div></div><div className="modal-actions"><button className="secondary" disabled={busy} onClick={closeEditor}>取消</button><button disabled={busy || !modalIcon.trim()} onClick={() => void applyOne()}>{busy ? "处理中…" : `仅应用到 ${editing.name}`}</button></div></section></div>}
    </main>
  </div>;
}
