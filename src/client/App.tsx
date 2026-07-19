import { ChangeEvent, useEffect, useMemo, useState } from "react";

interface Container {
  name: string; id: string; fileName: string | null; icon: string | null; image: string; state: string; status: string; editable: boolean; templateMatch: "name" | "file" | null; uneditableReason: "no-template" | "compose" | null;
}
interface Group { id: number; name: string; containerNames: string[]; }
interface Audit { id: number; containerName: string; oldIcon: string | null; newIcon: string | null; createdAt: string; result: string; }

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
  const toggle = (container: Container) => {
    if (!container.editable || !container.fileName) return;
    setSelected((old) => {
    const next = new Set(old);
    if (next.has(container.fileName!)) next.delete(container.fileName!); else next.add(container.fileName!);
    return next;
    });
  };
  const selectAll = () => setSelected(new Set(filtered.filter((container) => container.editable && container.fileName).map((container) => container.fileName!)));

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    setBusy(true);
    try {
      const contentBase64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
      const result = await request<{ icon: string }>("/api/icons/upload", { method: "POST", body: JSON.stringify({ contentBase64 }) });
      setIcon(result.icon); setNotice("上传完成，已转换为 PNG；选择容器后点击应用。");
    } catch (error) { setNotice(`上传失败：${error instanceof Error ? error.message : "未知错误"}`); } finally { setBusy(false); }
  }

  async function apply() {
    setBusy(true);
    try {
      const result = await request<{ notice: string }>("/api/icons/apply", { method: "POST", body: JSON.stringify({ templateFiles: [...selected], icon }) });
      setNotice(result.notice); await refresh();
    } catch (error) { setNotice(`应用失败：${error instanceof Error ? error.message : "未知错误"}`); } finally { setBusy(false); }
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
    <header><div><p className="eyebrow">UNRAID · DOCKER MANAGER</p><h1>Icon Manager</h1><p className="subtle">批量整理容器图标，不重启业务容器。</p></div><button className="secondary" onClick={() => void refresh()}>刷新</button></header>
    <p className="notice" role="status">{notice}</p>
    <section className="toolbar">
      <input aria-label="搜索容器" placeholder="搜索容器或镜像…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <button onClick={selectAll}>全选当前结果</button><button className="secondary" onClick={() => setSelected(new Set())}>清空选择</button>
      <span>{selected.size} 个已选</span>
    </section>
    <section className="editor">
      <div><h2>设置图标</h2><label>图标 URL 或上传后的本地路径<input value={icon} placeholder="https://… 或 /mnt/user/appdata/…" onChange={(e) => setIcon(e.target.value)} /></label><label className="upload">上传 PNG / SVG / WebP<input type="file" accept="image/png,image/svg+xml,image/webp" onChange={upload} disabled={busy} /></label><button className="primary" disabled={busy || !selected.size || !icon.trim()} onClick={() => void apply()}>应用到 {selected.size} 个容器</button></div>
      <div className="preview"><h2>预览</h2>{icon ? <img src={icon.startsWith("/") ? "" : icon} alt="图标预览" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} /> : <span>尚未选择图标</span>}<small>本地上传路径由 Unraid Docker 页面读取。</small></div>
    </section>
    <section><div className="section-title"><h2>当前 Docker 容器</h2><span>没有关联 Unraid 模板的容器会保留在列表中，但不可编辑</span></div><div className="container-grid">{filtered.map((container) => <article className={`${selected.has(container.fileName ?? "") ? "card selected" : "card"}${container.editable ? "" : " disabled"}`} key={container.id} onClick={() => toggle(container)}><input type="checkbox" disabled={!container.editable} checked={Boolean(container.fileName && selected.has(container.fileName))} onChange={() => toggle(container)} onClick={(event) => event.stopPropagation()} /><div className="icon">{container.icon?.startsWith("http") ? <img src={container.icon} alt="" /> : "▣"}</div><div><strong>{container.name}</strong><p>{container.image}</p><span className={`state ${container.state}`}>{container.state}</span>{!container.editable && <small className="uneditable">{container.uneditableReason === "compose" ? "Compose 容器不支持修改模板图标" : "无匹配 Unraid 模板，无法持久化图标"}</small>}</div></article>)}</div></section>
    <section className="split"><div><h2>分组</h2><div className="inline"><input placeholder="例如：媒体服务" value={groupName} onChange={(e) => setGroupName(e.target.value)} /><button disabled={!groupName || !selected.size} onClick={() => void saveGroup()}>保存当前选择</button></div>{groups.map((group) => <div className="row" key={group.id}><button className="link" onClick={() => setSelected(new Set(containers.filter((container) => container.editable && container.fileName && group.containerNames.includes(container.name)).map((container) => container.fileName!)))}>{group.name} · {group.containerNames.length}</button><button className="danger" onClick={() => void request(`/api/groups/${group.id}`, { method: "DELETE" }).then(refresh)}>删除</button></div>)}</div>
      <div><h2>最近变更</h2>{audits.slice(0, 6).map((audit) => <div className="row audit" key={audit.id}><span><strong>{audit.containerName}</strong><small>{new Date(audit.createdAt).toLocaleString()}</small></span>{audit.result === "applied" && <button onClick={() => void restore(audit.id)}>回滚</button>}</div>)}</div></section>
  </main>;
}
