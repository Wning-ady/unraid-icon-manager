import Database from "better-sqlite3";
import { join } from "node:path";
import type { AppConfig, AuditRecord, WallpaperGroup } from "./types.js";

export class AppDatabase {
  private readonly database: Database.Database;

  constructor(config: AppConfig) {
    this.database = new Database(join(config.configDir, "unraid-icon-manager.sqlite"));
    this.database.pragma("journal_mode = WAL");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS audits (id INTEGER PRIMARY KEY, container_name TEXT NOT NULL, template_file TEXT NOT NULL, old_icon TEXT, new_icon TEXT, backup_file TEXT NOT NULL, created_at TEXT NOT NULL, result TEXT NOT NULL CHECK(result IN ('applied', 'restored')));
      CREATE TABLE IF NOT EXISTS wallpaper_groups (id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS wallpaper_assets (file_name TEXT PRIMARY KEY, group_id INTEGER REFERENCES wallpaper_groups(id) ON DELETE SET NULL);
    `);
    const auditColumns = this.database.prepare("PRAGMA table_info(audits)").all() as Array<{ name: string }>;
    if (!auditColumns.some((column) => column.name === "template_created")) {
      this.database.exec("ALTER TABLE audits ADD COLUMN template_created INTEGER NOT NULL DEFAULT 0");
    }
    if (!auditColumns.some((column) => column.name === "cache_backup")) {
      this.database.exec("ALTER TABLE audits ADD COLUMN cache_backup TEXT");
    }
    if (!auditColumns.some((column) => column.name === "reverts_audit_id")) {
      this.database.exec("ALTER TABLE audits ADD COLUMN reverts_audit_id INTEGER");
    }
  }

  addAudit(record: Omit<AuditRecord, "id">): AuditRecord {
    const result = this.database.prepare(`INSERT INTO audits (container_name, template_file, old_icon, new_icon, backup_file, template_created, cache_backup, reverts_audit_id, created_at, result) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(record.containerName, record.templateFile, record.oldIcon, record.newIcon, record.backupFile, record.templateCreated ? 1 : 0,
        record.cacheBackup ? JSON.stringify(record.cacheBackup) : null, record.revertsAuditId, record.createdAt, record.result);
    return { id: Number(result.lastInsertRowid), ...record };
  }

  listAudits(limit = 100): AuditRecord[] {
    const records = this.database.prepare("SELECT * FROM audits ORDER BY id DESC LIMIT ?").all(limit).map((row: any) => ({
      id: row.id, containerName: row.container_name, templateFile: row.template_file, oldIcon: row.old_icon,
      newIcon: row.new_icon, backupFile: row.backup_file, templateCreated: Boolean(row.template_created),
      cacheBackup: row.cache_backup ? JSON.parse(row.cache_backup) : null, revertsAuditId: row.reverts_audit_id ?? null,
      revertedByAuditId: null, createdAt: row.created_at, result: row.result
    }));
    const byId = new Map(records.map((record) => [record.id, record]));
    for (const record of records) {
      if (record.revertsAuditId) {
        const reverted = byId.get(record.revertsAuditId);
        if (reverted) reverted.revertedByAuditId = record.id;
      }
    }
    return records;
  }

  countIconReferences(fileName: string): number {
    const row = this.database.prepare("SELECT COUNT(*) AS count FROM audits WHERE instr(COALESCE(old_icon, ''), ?) > 0 OR instr(COALESCE(new_icon, ''), ?) > 0").get(fileName, fileName) as { count: number };
    return row.count;
  }

  listWallpaperGroups(): WallpaperGroup[] {
    return (this.database.prepare("SELECT * FROM wallpaper_groups ORDER BY name COLLATE NOCASE").all() as Array<{ id: number; name: string; created_at: string }>)
      .map((row) => ({ id: row.id, name: row.name, createdAt: row.created_at }));
  }

  addWallpaperGroup(name: string): WallpaperGroup {
    const clean = name.trim();
    if (!clean || clean.length > 40) throw new Error("分组名称必须为 1 到 40 个字符");
    const createdAt = new Date().toISOString();
    try {
      const result = this.database.prepare("INSERT INTO wallpaper_groups (name, created_at) VALUES (?, ?)").run(clean, createdAt);
      return { id: Number(result.lastInsertRowid), name: clean, createdAt };
    } catch (error: any) {
      if (error?.code === "SQLITE_CONSTRAINT_UNIQUE") throw new Error("已经存在同名壁纸分组");
      throw error;
    }
  }

  setWallpaperGroup(fileName: string, groupId: number | null): void {
    if (groupId !== null && !this.database.prepare("SELECT 1 FROM wallpaper_groups WHERE id = ?").get(groupId)) throw new Error("壁纸分组不存在");
    this.database.prepare("INSERT INTO wallpaper_assets (file_name, group_id) VALUES (?, ?) ON CONFLICT(file_name) DO UPDATE SET group_id = excluded.group_id").run(fileName, groupId);
  }

  wallpaperGroupMap(): Map<string, number | null> {
    return new Map((this.database.prepare("SELECT file_name, group_id FROM wallpaper_assets").all() as Array<{ file_name: string; group_id: number | null }>)
      .map((row) => [row.file_name, row.group_id]));
  }

  removeWallpaper(fileName: string): void { this.database.prepare("DELETE FROM wallpaper_assets WHERE file_name = ?").run(fileName); }

  getAudit(id: number): AuditRecord | undefined {
    return this.listAudits(10000).find((record) => record.id === id);
  }

  close(): void { this.database.close(); }
}
