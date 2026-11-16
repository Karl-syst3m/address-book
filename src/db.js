import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = path.resolve(__dirname, '..', 'data');
export const DB_PATH = path.join(DATA_DIR, 'address_book.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

/**
 * 单连接 SQLite。node:sqlite 是 Node 22.5+ 内置模块，无需任何原生编译依赖。
 */
export const db = new DatabaseSync(DB_PATH);

// 外键必须显式开启；WAL 提升并发读性能；busy_timeout 避免偶发写的 SQLITE_BUSY。
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
`);

// 幂等建表：每次启动都可安全执行。
db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    company TEXT DEFAULT '',
    note TEXT DEFAULT '',
    bookmarked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS contact_methods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    label TEXT DEFAULT '',
    is_primary INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(name);
  CREATE INDEX IF NOT EXISTS idx_contacts_bookmarked ON contacts(bookmarked);
  CREATE INDEX IF NOT EXISTS idx_contacts_updated_at ON contacts(updated_at);
  CREATE INDEX IF NOT EXISTS idx_methods_contact_id ON contact_methods(contact_id);
  CREATE INDEX IF NOT EXISTS idx_methods_value ON contact_methods(value);
`);

/**
 * 简易事务封装（node:sqlite 没有 better-sqlite3 的 transaction() helper）。
 * 只支持同步函数；出现异常时回滚并原样抛出。
 */
export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // 回滚失败时保留原始异常
    }
    throw error;
  }
}

export function nowIso() {
  return new Date().toISOString();
}
