import Database from "better-sqlite3";
import { join } from "node:path";
import type { AppConfig, AuditRecord } from "./types.js";

export class AppDatabase {
  private readonly database: Database.Database;

  constructor(config: AppConfig) {
    this.database = new Database(join(config.configDir, "unraid-icon-manager.sqlite"));
    this.database.pragma("journal_mode = WAL");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS audits (id INTEGER PRIMARY KEY, container_name TEXT NOT NULL, template_file TEXT NOT NULL, old_icon TEXT, new_icon TEXT, backup_file TEXT NOT NULL, created_at TEXT NOT NULL, result TEXT NOT NULL CHECK(result IN ('applied', 'restored')));
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

  getAudit(id: number): AuditRecord | undefined {
    return this.listAudits(10000).find((record) => record.id === id);
  }

  close(): void { this.database.close(); }
}
