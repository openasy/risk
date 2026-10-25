import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Forward-only migrations (ADR 0010): append new entries, never edit or remove old ones.
const MIGRATIONS = [
  `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   -- The register. Scores are never stored: they follow from likelihood and impact, so a change cannot leave one stale.
   CREATE TABLE risks (
     id TEXT PRIMARY KEY,
     number INTEGER NOT NULL UNIQUE,
     title TEXT NOT NULL,
     description TEXT NOT NULL DEFAULT '',
     category TEXT NOT NULL CHECK (category IN ('strategic', 'operational', 'security', 'compliance', 'vendor', 'other')),
     likelihood INTEGER NOT NULL CHECK (likelihood BETWEEN 1 AND 5),
     impact INTEGER NOT NULL CHECK (impact BETWEEN 1 AND 5),
     residual_likelihood INTEGER CHECK (residual_likelihood BETWEEN 1 AND 5),
     residual_impact INTEGER CHECK (residual_impact BETWEEN 1 AND 5),
     owner TEXT,
     status TEXT NOT NULL CHECK (status IN ('identified', 'assessing', 'treating', 'accepted', 'closed')),
     treatment TEXT CHECK (treatment IN ('mitigate', 'transfer', 'accept', 'avoid')),
     plan TEXT NOT NULL DEFAULT '',
     review_interval_days INTEGER NOT NULL,
     next_review TEXT NOT NULL,
     last_review TEXT,
     tags TEXT NOT NULL DEFAULT '[]',
     ext_source TEXT,
     ext_ref TEXT,
     accepted_reason TEXT,
     accepted_by TEXT,
     accepted_until TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     closed_at TEXT
   );
   CREATE UNIQUE INDEX risks_external ON risks (ext_source, ext_ref) WHERE ext_source IS NOT NULL;
   -- References to other products' controls, findings and incidents. Nothing is fetched from them.
   CREATE TABLE risk_links (
     id TEXT PRIMARY KEY,
     risk_id TEXT NOT NULL REFERENCES risks (id) ON DELETE CASCADE,
     kind TEXT NOT NULL CHECK (kind IN ('control', 'finding', 'incident', 'vendor', 'other')),
     product TEXT NOT NULL DEFAULT '',
     reference TEXT NOT NULL,
     url TEXT,
     created_at TEXT NOT NULL,
     UNIQUE (risk_id, kind, product, reference)
   );
   CREATE TABLE vendors (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL UNIQUE,
     service TEXT NOT NULL DEFAULT '',
     data_classes TEXT NOT NULL DEFAULT '[]',
     criticality TEXT NOT NULL CHECK (criticality IN ('low', 'medium', 'high', 'critical')),
     contact TEXT,
     status TEXT NOT NULL CHECK (status IN ('onboarding', 'active', 'offboarding')),
     questionnaire TEXT NOT NULL CHECK (questionnaire IN ('not-sent', 'sent', 'received', 'reviewed')),
     rating TEXT CHECK (rating IN ('low', 'medium', 'high')),
     review_interval_days INTEGER NOT NULL,
     next_review TEXT NOT NULL,
     last_review TEXT,
     notes TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE vendor_documents (
     id TEXT PRIMARY KEY,
     vendor_id TEXT NOT NULL REFERENCES vendors (id) ON DELETE CASCADE,
     title TEXT NOT NULL,
     url TEXT NOT NULL,
     created_at TEXT NOT NULL
   );
   CREATE TABLE vendor_risks (
     vendor_id TEXT NOT NULL REFERENCES vendors (id) ON DELETE CASCADE,
     risk_id TEXT NOT NULL REFERENCES risks (id) ON DELETE CASCADE,
     PRIMARY KEY (vendor_id, risk_id)
   );
   -- Who changed what, for risks and vendors. Nobody edits it: the database itself refuses an update, and a delete
   -- unless the risk or vendor it is about is gone (ADR 0049).
   CREATE TABLE history (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     subject_kind TEXT NOT NULL CHECK (subject_kind IN ('risk', 'vendor')),
     subject_id TEXT NOT NULL,
     at TEXT NOT NULL,
     who TEXT NOT NULL,
     field TEXT NOT NULL,
     old_value TEXT,
     new_value TEXT
   );
   CREATE INDEX history_subject ON history (subject_kind, subject_id, id DESC);
   CREATE TRIGGER history_no_update BEFORE UPDATE ON history BEGIN SELECT RAISE(ABORT, 'history cannot be changed'); END;
   CREATE TRIGGER history_delete_only_with_subject BEFORE DELETE ON history
     WHEN (OLD.subject_kind = 'risk' AND EXISTS (SELECT 1 FROM risks WHERE id = OLD.subject_id))
       OR (OLD.subject_kind = 'vendor' AND EXISTS (SELECT 1 FROM vendors WHERE id = OLD.subject_id))
     BEGIN SELECT RAISE(ABORT, 'history cannot be deleted'); END`,
  `-- The controls of a framework (ISO 27001, SOC 2) that treat a risk; the catalog is in server/frameworks.ts.
   CREATE TABLE risk_controls (
     risk_id TEXT NOT NULL REFERENCES risks (id) ON DELETE CASCADE,
     framework TEXT NOT NULL,
     control TEXT NOT NULL,
     created_at TEXT NOT NULL,
     PRIMARY KEY (risk_id, framework, control)
   );
   CREATE INDEX risk_controls_control ON risk_controls (framework, control)`,
];

/** Opens the product's single SQLite file in WAL mode (ADR 0011) and migrates it forward. */
export function openDb(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const row = db.prepare("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations").get() as { v: number };
  for (let v = row.v; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]!);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(v + 1, new Date().toISOString());
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
  return db;
}
