import { ChangeEvent, useEffect, useMemo, useState } from "react";

interface Container {
  name: string; id: string; fileName: string | null; icon: string | null; image: string; state: string; status: string; editable: boolean; templateMatch: "name" | "file" | null; uneditableReason: "no-template" | "compose" | null;
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
  if (failed) return <span className="preview-message error">图标无法加载，请检查 URL</span>;
  if (!source) return <span className="preview-message">本地图标路径将由 Unraid Docker 页面读取</span>;
  return <img src={source} alt={alt} onError={() => setFailed(true)} />;
}

function ContainerCardBody({ container }: { container: Container }) {
  const source = iconPreviewSource(container.icon ?? "");
  return <><div className="icon">{source ? <img src={source} alt="" /> : "▣"}</div><div className="card-content"><div className="card-topline"><strong>{container.name}</strong><span className={`state ${container.state}`} title={container.status}>{container.state}</span></div><p className="image-name">{container.image}</p>{container.editable ? <p className="template-note editable">点击更换图标 · 已关联 Unraid 模板</p> : <p className="template-note readonly-note">{container.uneditableReason === "compose" ? "Compose 容器 · 模板图标只读" : "没有匹配 Unraid 模板 · 无法持久化图标"}</p>}</div></>;
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

  const refresh = async () => {
    try {
      const [containerData, groupData, auditData] = await Promise.all([
        request<{ containers: Container[]; dockerAvailable: boolean }>("/api/containers"), request<Group[]>("/api/groups"), request<Audit[]>("/api/audits")
      ]);
      setContainers(containerData.containers); setGroups(groupData); setAudits(auditData);
      setSelected((previous) => new Set(containerData.containers.filter((container) => container.editable && container.fileName && previous.has(container.fileName)).map((container) => container.fileName!)));
      setNotice(containerData.dockerAvailable ? `已读取 ${containerData.containers.length} 个当前 Docker 容器；仅关联 Unraid 模板的容器可编辑。` : "Docker socket 不可用，因此无法读取当前已部署容器。");
    } catch (error) { setNotice(`加载失败：${error instanceof Error ? error.message : "未知错误"}`); }
  };
  useEffect(() => { void refresh(); }, []);

  const filtered = useMemo(() => containers.filter((container) => `${container.name} ${container.image ?? ""}`.toLowerCase().includes(query.toLowerCase())), [containers, query]);
  const editableCount = containers.filter((container) => container.editable).length;
  const toggle = (container: Container) => {
    if (!container.editable || !container.fileName) return;
    setSelected((old) => {
    const next = new Set(old);
    if (next.has(container.fileName!)) next.delete(container.fileName!); else next.add(container.fileName!);
    return next;
    });
  };
  const selectAll = () => setSelected(new Set(filtered.filter((container) => container.editable && container.fileName).map((container) => container.fileName!)));

  const openEditor = (container: Container) => {
    if (!container.editable || !container.fileName) return;
    setEditing(container);
    setModalIcon(container.icon ?? "");
  };

  async function uploadFile(file: File): Promise<string> {
    const contentBase64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
    const result = await request<{ icon: string }>("/api/icons/upload", { method: "POST", body: JSON.stringify({ contentBase64 }) });
    return result.icon;
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    setBusy(true);
    try {
      setIcon(await uploadFile(file)); setNotice("上传完成，已转换为 PNG；选择容器后点击应用。");
    } catch (error) { setNotice(`上传失败：${error instanceof Error ? error.message : "未知错误"}`); } finally { setBusy(false); }
  }

  async function uploadForModal(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    setBusy(true);
    try { setModalIcon(await uploadFile(file)); setNotice("图标已上传并转换为 PNG，可在弹窗中应用。"); }
    catch (error) { setNotice(`上传失败：${error instanceof Error ? error.message : "未知错误"}`); }
    finally { setBusy(false); }
  }

  async function apply() {
    setBusy(true);
    try {
      const result = await request<{ notice: string }>("/api/icons/apply", { method: "POST", body: JSON.stringify({ templateFiles: [...selected], icon }) });
      setNotice(result.notice); await refresh();
    } catch (error) { setNotice(`应用失败：${error instanceof Error ? error.message : "未知错误"}`); } finally { setBusy(false); }
  }

  async function applyOne() {
    if (!editing?.fileName) return;
    setBusy(true);
    try {
      const result = await request<{ notice: string }>("/api/icons/apply", { method: "POST", body: JSON.stringify({ templateFiles: [editing.fileName], icon: modalIcon }) });
      setNotice(result.notice); setEditing(null); await refresh();
    } catch (error) { setNotice(`应用失败：${error instanceof Error ? error.message : "未知错误"}`); }
    finally { setBusy(false); }
  }

  async function saveGroup() {
    try { await request<Group>("/api/groups", { method: "POST", body: JSON.stringify({ name: groupName, containerNames: containers.filter((c) => c.fileName && selected.has(c.fileName)).map((c) => c.name) }) }); setGroupName(""); await refresh(); }
    catch (error) { setNotice(`保存分组失败：${error instanceof Error ? error.message : "未知错误"}`); }
  }

  async function restore(id: number) {
    if (!confirm("恢复该次修改前的模板？这不会重启容器。")) return;
    try { await request(`/api/audits/${id}/restore`, { method: "POST", body: "{}" }); setNotice("已恢复模板，请刷新 Unraid Docker 页面。"); await refresh(); }
    catch (error) { setNotice(`恢复失败：${error instanceof Error ? error.message : "未知错误"}`); }
  }

  return <main>
    <header className="hero"><div><p className="eyebrow">UNRAID · DOCKER MANAGER</p><h1>Icon Manager</h1><p className="subtle">管理当前已部署容器的模板图标，不重启业务容器。</p></div><div className="hero-actions"><span className="summary"><b>{editableCount}</b> 个可编辑</span><button className="secondary" onClick={() => void refresh()}>刷新列表</button></div></header>
    <p className="notice" role="status">{notice}</p>
    <section className="toolbar">
      <input aria-label="搜索容器" placeholder="搜索容器或镜像…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <button onClick={selectAll}>全选可编辑结果</button><button className="secondary" onClick={() => setSelected(new Set())}>清空选择</button>
      <span className="selection-count">已选 {selected.size} 个</span>
    </section>
    <section className="editor">
      <div><h2>设置图标</h2><label>图标 URL 或上传后的本地路径<input value={icon} placeholder="https://… 或 /mnt/user/appdata/…" onChange={(e) => setIcon(e.target.value)} /></label><label className="upload">上传 PNG / SVG / WebP<input type="file" accept="image/png,image/svg+xml,image/webp" onChange={upload} disabled={busy} /></label><button className="primary" disabled={busy || !selected.size || !icon.trim()} onClick={() => void apply()}>应用到 {selected.size} 个容器</button></div>
      <div className="preview"><h2>预览</h2><IconPreview value={icon} alt="图标预览" /><small>本地上传路径由 Unraid Docker 页面读取。</small></div>
    </section>
    <section><div className="section-title"><div><h2>当前 Docker 容器</h2><span>点击可编辑容器直接换图标；复选框用于批量选择</span></div><span className="result-count">{filtered.length} 个结果</span></div><div className="container-grid">{filtered.map((container) => <article className={`${selected.has(container.fileName ?? "") ? "card selected" : "card"}${container.editable ? "" : " readonly"}`} key={container.id}><label className="card-select"><input aria-label={`批量选择 ${container.name}`} type="checkbox" disabled={!container.editable} checked={Boolean(container.fileName && selected.has(container.fileName))} onChange={() => toggle(container)} /></label>{container.editable ? <button className="card-open" aria-label={`更换 ${container.name} 的图标`} onClick={() => openEditor(container)}><ContainerCardBody container={container} /></button> : <div className="card-open card-static"><ContainerCardBody container={container} /></div>}</article>)}</div></section>
    <section className="split"><div><h2>分组</h2><div className="inline"><input placeholder="例如：媒体服务" value={groupName} onChange={(e) => setGroupName(e.target.value)} /><button disabled={!groupName || !selected.size} onClick={() => void saveGroup()}>保存当前选择</button></div>{groups.map((group) => <div className="row" key={group.id}><button className="link" onClick={() => setSelected(new Set(containers.filter((container) => container.editable && container.fileName && group.containerNames.includes(container.name)).map((container) => container.fileName!)))}>{group.name} · {group.containerNames.length}</button><button className="danger" onClick={() => void request(`/api/groups/${group.id}`, { method: "DELETE" }).then(refresh)}>删除</button></div>)}</div>
      <div><h2>最近变更</h2>{audits.slice(0, 6).map((audit) => <div className="row audit" key={audit.id}><span><strong>{audit.containerName}</strong><small>{new Date(audit.createdAt).toLocaleString()}</small></span>{audit.result === "applied" && <button onClick={() => void restore(audit.id)}>回滚</button>}</div>)}</div></section>
    {editing && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setEditing(null); }}><section className="icon-modal" role="dialog" aria-modal="true" aria-labelledby="icon-modal-title"><div className="modal-header"><div><p className="eyebrow">单容器图标</p><h2 id="icon-modal-title">{editing.name}</h2><small>{editing.image}</small></div><button className="modal-close secondary" aria-label="关闭更换图标弹窗" disabled={busy} onClick={() => setEditing(null)}>×</button></div><div className="modal-body"><div className="modal-preview"><IconPreview value={modalIcon} alt={`${editing.name} 图标预览`} /></div><div><label>图标 URL 或上传后的本地路径<input autoFocus value={modalIcon} placeholder="https://…" onChange={(event) => setModalIcon(event.target.value)} /></label><label className="upload">上传 PNG / SVG / WebP<input type="file" accept="image/png,image/svg+xml,image/webp" onChange={uploadForModal} disabled={busy} /></label><p className="modal-hint">只更新 <code>{editing.fileName}</code> 的图标字段，不会重启容器。</p></div></div><div className="modal-actions"><button className="secondary" disabled={busy} onClick={() => setEditing(null)}>取消</button><button disabled={busy || !modalIcon.trim()} onClick={() => void applyOne()}>{busy ? "处理中…" : `仅应用到 ${editing.name}`}</button></div></section></div>}
  </main>;
}
