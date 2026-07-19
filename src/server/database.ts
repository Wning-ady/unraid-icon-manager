import Database from "better-sqlite3";
import { join } from "node:path";
import type { AppConfig, AuditRecord, Group } from "./types.js";

export class AppDatabase {
  private readonly database: Database.Database;

  constructor(config: AppConfig) {
    this.database = new Database(join(config.configDir, "unraid-icon-manager.sqlite"));
    this.database.pragma("journal_mode = WAL");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS groups (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, container_names TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audits (id INTEGER PRIMARY KEY, container_name TEXT NOT NULL, template_file TEXT NOT NULL, old_icon TEXT, new_icon TEXT, backup_file TEXT NOT NULL, created_at TEXT NOT NULL, result TEXT NOT NULL CHECK(result IN ('applied', 'restored')));
    `);
    const auditColumns = this.database.prepare("PRAGMA table_info(audits)").all() as Array<{ name: string }>;
    if (!auditColumns.some((column) => column.name === "template_created")) {
      this.database.exec("ALTER TABLE audits ADD COLUMN template_created INTEGER NOT NULL DEFAULT 0");
    }
  }

  listGroups(): Group[] {
    return this.database.prepare("SELECT * FROM groups ORDER BY name").all().map((row: any) => ({
      id: row.id, name: row.name, containerNames: JSON.parse(row.container_names), createdAt: row.created_at, updatedAt: row.updated_at
    }));
  }

  saveGroup(name: string, containerNames: string[]): Group {
    if (!name.trim() || name.length > 100) throw new Error("Group name must be 1-100 characters");
    const uniqueNames = [...new Set(containerNames)].sort();
    const now = new Date().toISOString();
    this.database.prepare(`INSERT INTO groups (name, container_names, created_at, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET container_names = excluded.container_names, updated_at = excluded.updated_at`)
      .run(name.trim(), JSON.stringify(uniqueNames), now, now);
    const row = this.database.prepare("SELECT * FROM groups WHERE name = ?").get(name.trim()) as any;
    return { id: row.id, name: row.name, containerNames: JSON.parse(row.container_names), createdAt: row.created_at, updatedAt: row.updated_at };
  }

  deleteGroup(id: number): void { this.database.prepare("DELETE FROM groups WHERE id = ?").run(id); }

  addAudit(record: Omit<AuditRecord, "id">): AuditRecord {
    const result = this.database.prepare(`INSERT INTO audits (container_name, template_file, old_icon, new_icon, backup_file, template_created, created_at, result) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(record.containerName, record.templateFile, record.oldIcon, record.newIcon, record.backupFile, record.templateCreated ? 1 : 0, record.createdAt, record.result);
    return { id: Number(result.lastInsertRowid), ...record };
  }

  listAudits(limit = 100): AuditRecord[] {
    return this.database.prepare("SELECT * FROM audits ORDER BY id DESC LIMIT ?").all(limit).map((row: any) => ({
      id: row.id, containerName: row.container_name, templateFile: row.template_file, oldIcon: row.old_icon,
      newIcon: row.new_icon, backupFile: row.backup_file, templateCreated: Boolean(row.template_created), createdAt: row.created_at, result: row.result
    }));
  }

  getAudit(id: number): AuditRecord | undefined {
    return this.listAudits(10000).find((record) => record.id === id);
  }

  close(): void { this.database.close(); }
}
