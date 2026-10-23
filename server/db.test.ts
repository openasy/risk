import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "./db.ts";

describe("openDb", () => {
  it("uses WAL and migrates once", () => {
    const path = join(mkdtempSync(join(tmpdir(), "risk-")), "nested", "risk.db");
    const first = openDb(path);
    expect(first.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    first.close();

    const second = openDb(path);
    expect(second.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get()).toEqual({ n: 1 });
    second.close();
  });

  it("refuses to change or delete history while its risk exists, and lets it go with the risk", () => {
    const db = openDb(":memory:");
    db.exec(`INSERT INTO risks (id, number, title, category, likelihood, impact, status, review_interval_days, next_review, created_at, updated_at)
      VALUES ('r', 1, 'Backups untested', 'operational', 3, 4, 'identified', 90, '2027-01-20', 'now', 'now');
      INSERT INTO history (subject_kind, subject_id, at, who, field, new_value) VALUES ('risk', 'r', 'now', 'ada', 'created', 'R-1')`);
    expect(() => db.exec("UPDATE history SET who = 'mallory'")).toThrow(/cannot be changed/);
    expect(() => db.exec("DELETE FROM history")).toThrow(/cannot be deleted/);
    db.exec("DELETE FROM risks WHERE id = 'r'");
    db.exec("DELETE FROM history WHERE subject_id = 'r'");
    expect(db.prepare("SELECT COUNT(*) AS n FROM history").get()).toEqual({ n: 0 });
  });

  it("rejects values outside the model", () => {
    const db = openDb(":memory:");
    const risk =
      (l: number, c = "security") =>
      () =>
        db.exec(
          `INSERT INTO risks (id, number, title, category, likelihood, impact, status, review_interval_days, next_review, created_at, updated_at) VALUES ('${Math.random()}', ${Math.floor(Math.random() * 1e6)}, 't', '${c}', ${l}, 3, 'identified', 90, 'd', 'n', 'n')`,
        );
    expect(risk(6)).toThrow();
    expect(risk(0)).toThrow();
    expect(risk(3, "weather")).toThrow();
    expect(risk(3)).not.toThrow();
  });
});
