import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";

export type ProblemCode = "invalid-token" | "invalid-json" | "invalid-body" | "not-found" | "conflict" | "payload-too-large" | "internal-error";

export class RiskError extends Error {
  readonly status: number;
  readonly code: ProblemCode;
  constructor(status: number, code: ProblemCode, detail: string) {
    super(detail);
    this.status = status;
    this.code = code;
  }
}

export const CATEGORIES = ["strategic", "operational", "security", "compliance", "vendor", "other"] as const;
export const STATUSES = ["identified", "assessing", "treating", "accepted", "closed"] as const;
export const TREATMENTS = ["mitigate", "transfer", "accept", "avoid"] as const;
export const BANDS = ["low", "medium", "high", "critical"] as const;
export const LINK_KINDS = ["control", "finding", "incident", "vendor", "other"] as const;
export const DATA_CLASSES = ["personal", "financial", "health", "credentials", "public", "internal"] as const;
export const CRITICALITIES = BANDS;
export const VENDOR_STATUSES = ["onboarding", "active", "offboarding"] as const;
export const QUESTIONNAIRES = ["not-sent", "sent", "received", "reviewed"] as const;
export const RATINGS = ["low", "medium", "high"] as const;
export type Category = (typeof CATEGORIES)[number];
export type Status = (typeof STATUSES)[number];
export type Band = (typeof BANDS)[number];
/** `review-due` is not stored: it is what an accepted risk becomes when its acceptance runs out. */
export type EffectiveStatus = Status | "review-due";

const PRODUCT = /^[a-z][a-z0-9-]{0,39}$/;
const MAX_LINKS = 50;
const MAX_ACCEPT_DAYS = 366;
const DAY = 86_400_000;

/** Likelihood times impact: 1 to 4 is low, 5 to 9 medium, 10 to 16 high, 17 to 25 critical. */
export function bandOf(score: number): Band {
  return score >= 17 ? "critical" : score >= 10 ? "high" : score >= 5 ? "medium" : "low";
}

const bad = (detail: string) => new RiskError(422, "invalid-body", detail);
const notFound = (what: string) => new RiskError(404, "not-found", `${what} does not exist.`);

export interface Page<T> {
  items: T[];
  /** Opaque; pass it back as `cursor` for the next page. Absent on the last page (ADR 0024). */
  nextCursor?: string;
}

const encodeCursor = (offset: number) => Buffer.from(JSON.stringify({ o: offset })).toString("base64url");
function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const o = (JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { o?: unknown }).o;
    if (typeof o === "number" && Number.isSafeInteger(o) && o >= 0) return o;
  } catch {
    // fall through
  }
  throw bad("cursor is not one this API returned.");
}

export function parseLimit(value: string | null, max = 500, fallback = 100): number {
  if (value === null) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) throw bad(`limit must be between 1 and ${max}.`);
  return n;
}

const str = (v: unknown, name: string, min: number, max: number): string => {
  if (typeof v !== "string" || v.trim().length < min || v.trim().length > max) throw bad(`${name} must be ${min === 0 ? "at most" : `${min} to`} ${max} characters.`);
  return v.trim();
};
const optStr = (v: unknown, name: string, max: number): string | null => (v === undefined || v === null || v === "" ? null : str(v, name, 1, max));
const oneOf = <T extends string>(v: unknown, name: string, list: readonly T[]): T => {
  if (typeof v !== "string" || !list.includes(v as T)) throw bad(`${name} must be one of ${list.join(", ")}.`);
  return v as T;
};
const score = (v: unknown, name: string): number => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 5) throw bad(`${name} must be a whole number from 1 to 5.`);
  return v;
};
const days = (v: unknown, name: string): number => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 7 || v > 1095) throw bad(`${name} must be a whole number of days from 7 to 1095.`);
  return v;
};
function webUrl(v: unknown): string {
  const u = typeof v === "string" ? URL.parse(v.trim()) : null;
  if (!u || (u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password) throw bad("url must be a web address starting with http:// or https://, without credentials.");
  return u.href;
}
function tagList(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > 12 || v.some((t) => typeof t !== "string" || !/^[a-z0-9][a-z0-9 ._-]{0,29}$/i.test(t))) throw bad("tags is a list of at most 12 short labels.");
  return [...new Set((v as string[]).map((t) => t.toLowerCase()))];
}
function exact(body: Record<string, unknown>, allowed: string[]) {
  const extra = Object.keys(body).filter((k) => !allowed.includes(k));
  if (extra.length) throw bad(`Unknown fields: ${extra.join(", ")}. Expected ${allowed.join(", ")}.`);
}
function external(v: unknown): { source: string; reference: string } {
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw bad("external is { source, reference }.");
  const { source, reference, ...rest } = v as Record<string, unknown>;
  exact(rest, []);
  if (typeof source !== "string" || !PRODUCT.test(source)) throw bad("external.source is a product id such as siem.");
  return { source, reference: str(reference, "external.reference", 1, 200) };
}

export interface RiskFilter {
  /** `active` is everything not closed. */
  status?: EffectiveStatus | "active";
  band?: Band[];
  category?: Category;
  owner?: string;
  overdue?: boolean;
  q?: string;
}

export interface VendorFilter {
  status?: (typeof VENDOR_STATUSES)[number];
  criticality?: Band[];
  rating?: (typeof RATINGS)[number];
  overdue?: boolean;
  q?: string;
}

export interface RiskOptions {
  /** The clock; tests move it. */
  now?: () => Date;
}

const RISK_FIELDS = ["title", "description", "category", "likelihood", "impact", "residualLikelihood", "residualImpact", "owner", "status", "treatment", "plan", "reviewIntervalDays", "tags"];
const VENDOR_FIELDS = ["name", "service", "dataClasses", "criticality", "contact", "status", "questionnaire", "rating", "reviewIntervalDays", "notes", "risks"];

export function createRisk(db: DatabaseSync, { now: clock = () => new Date() }: RiskOptions = {}) {
  const now = () => clock().toISOString();
  const today = () => now().slice(0, 10);
  const inDays = (n: number) => new Date(clock().getTime() + n * DAY).toISOString().slice(0, 10);

  function note(kind: "risk" | "vendor", id: string, who: string, field: string, from: unknown, to: unknown) {
    const text = (v: unknown) => (v === null || v === undefined ? null : typeof v === "string" ? v : JSON.stringify(v));
    db.prepare("INSERT INTO history (subject_kind, subject_id, at, who, field, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?, ?)").run(kind, id, now(), who, field, text(from), text(to));
  }
  const history = (kind: "risk" | "vendor", id: string) =>
    (db.prepare("SELECT at, who, field, old_value, new_value FROM history WHERE subject_kind = ? AND subject_id = ? ORDER BY id DESC LIMIT 500").all(kind, id) as Array<Record<string, any>>).map((h) => ({
      at: h.at as string,
      who: h.who as string,
      field: h.field as string,
      from: (h.old_value as string | null) ?? null,
      to: (h.new_value as string | null) ?? null,
    }));

  // ---------------------------------------------------------------- Risks
  const riskRow = (idOrKey: string) => {
    const m = /^R-(\d{1,9})$/i.exec(idOrKey);
    const r = (m ? db.prepare("SELECT * FROM risks WHERE number = ?").get(Number(m[1])) : db.prepare("SELECT * FROM risks WHERE id = ?").get(idOrKey)) as Record<string, any> | undefined;
    if (!r) throw notFound("The risk");
    return r;
  };
  const expired = (r: Record<string, any>) => r.status === "accepted" && !!r.accepted_until && r.accepted_until <= now();
  const effective = (r: Record<string, any>): EffectiveStatus => (expired(r) ? "review-due" : (r.status as Status));
  const overdue = (r: Record<string, any>) => r.status !== "closed" && (expired(r) || r.next_review <= today());

  function presentRisk(r: Record<string, any>, withLinks = false) {
    const inherent = r.likelihood * r.impact;
    const hasResidual = r.residual_likelihood !== null && r.residual_impact !== null;
    const residual = hasResidual ? r.residual_likelihood * r.residual_impact : null;
    const out = {
      id: r.id as string,
      key: `R-${r.number}`,
      number: r.number as number,
      title: r.title as string,
      description: r.description as string,
      category: r.category as Category,
      likelihood: r.likelihood as number,
      impact: r.impact as number,
      score: inherent,
      band: bandOf(inherent),
      residual: hasResidual ? { likelihood: r.residual_likelihood as number, impact: r.residual_impact as number, score: residual!, band: bandOf(residual!) } : null,
      owner: (r.owner as string | null) ?? null,
      status: effective(r),
      treatment: (r.treatment as string | null) ?? null,
      plan: r.plan as string,
      reviewIntervalDays: r.review_interval_days as number,
      nextReview: r.next_review as string,
      lastReview: (r.last_review as string | null) ?? null,
      overdue: overdue(r),
      acceptance: r.status === "accepted" ? { reason: r.accepted_reason as string, approver: r.accepted_by as string, until: r.accepted_until as string, expired: expired(r) } : null,
      tags: JSON.parse(r.tags) as string[],
      external: r.ext_source ? { source: r.ext_source as string, reference: r.ext_ref as string } : null,
      linkCount: (db.prepare("SELECT COUNT(*) AS n FROM risk_links WHERE risk_id = ?").get(r.id) as { n: number }).n,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
      closedAt: (r.closed_at as string | null) ?? null,
    };
    return withLinks ? { ...out, links: links(r.id) } : out;
  }
  const links = (riskId: string) =>
    (db.prepare("SELECT * FROM risk_links WHERE risk_id = ? ORDER BY created_at, id").all(riskId) as Array<Record<string, any>>).map((l) => ({
      id: l.id as string,
      kind: l.kind as (typeof LINK_KINDS)[number],
      product: (l.product as string) || null,
      reference: l.reference as string,
      url: (l.url as string | null) ?? null,
      createdAt: l.created_at as string,
    }));

  function newLink(riskId: string, body: Record<string, unknown>, who: string) {
    exact(body, ["kind", "product", "reference", "url"]);
    const kind = oneOf(body.kind, "kind", LINK_KINDS);
    const product = body.product === undefined || body.product === null || body.product === "" ? "" : str(body.product, "product", 1, 40);
    if (product && !PRODUCT.test(product)) throw bad("product is a product id such as siem.");
    const reference = str(body.reference, "reference", 1, 200);
    const url = body.url === undefined || body.url === null || body.url === "" ? null : webUrl(body.url);
    if ((db.prepare("SELECT COUNT(*) AS n FROM risk_links WHERE risk_id = ?").get(riskId) as { n: number }).n >= MAX_LINKS) throw bad(`A risk has at most ${MAX_LINKS} links.`);
    if (db.prepare("SELECT 1 FROM risk_links WHERE risk_id = ? AND kind = ? AND product = ? AND reference = ?").get(riskId, kind, product, reference)) throw new RiskError(409, "conflict", "This link exists.");
    const id = randomUUID();
    db.prepare("INSERT INTO risk_links (id, risk_id, kind, product, reference, url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, riskId, kind, product, reference, url, now());
    note("risk", riskId, who, "link added", null, `${kind}${product ? ` ${product}` : ""}: ${reference}`);
    return id;
  }

  function createRiskRecord(body: Record<string, unknown>, who: string) {
    exact(body, ["title", "description", "category", "likelihood", "impact", "residualLikelihood", "residualImpact", "owner", "treatment", "plan", "reviewIntervalDays", "tags", "links", "external"]);
    const ext = body.external === undefined ? null : external(body.external);
    if (ext) {
      const dup = db.prepare("SELECT * FROM risks WHERE ext_source = ? AND ext_ref = ?").get(ext.source, ext.reference) as Record<string, any> | undefined;
      if (dup) {
        // The product that opened it saw the same thing again: one risk, one more line in its history.
        note("risk", dup.id, who, "seen again", null, `${ext.source}: ${ext.reference}`);
        db.prepare("UPDATE risks SET updated_at = ? WHERE id = ?").run(now(), dup.id);
        return { created: false, risk: presentRisk(riskRow(dup.id), true) };
      }
    }
    const interval = body.reviewIntervalDays === undefined ? 90 : days(body.reviewIntervalDays, "reviewIntervalDays");
    const rl = body.residualLikelihood === undefined || body.residualLikelihood === null ? null : score(body.residualLikelihood, "residualLikelihood");
    const ri = body.residualImpact === undefined || body.residualImpact === null ? null : score(body.residualImpact, "residualImpact");
    if ((rl === null) !== (ri === null)) throw bad("residualLikelihood and residualImpact come together.");
    const linkList = body.links === undefined ? [] : body.links;
    if (!Array.isArray(linkList) || linkList.length > MAX_LINKS) throw bad(`links is a list of at most ${MAX_LINKS} links.`);
    const id = randomUUID();
    const t = now();
    db.exec("BEGIN IMMEDIATE");
    try {
      const number = ((db.prepare("SELECT COALESCE(MAX(number), 0) AS n FROM risks").get() as { n: number }).n ?? 0) + 1;
      db.prepare(
        `INSERT INTO risks (id, number, title, description, category, likelihood, impact, residual_likelihood, residual_impact, owner, status, treatment, plan, review_interval_days, next_review, tags, ext_source, ext_ref, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'identified', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, number, str(body.title, "title", 3, 200), body.description === undefined ? "" : str(body.description, "description", 0, 4000), oneOf(body.category, "category", CATEGORIES),
        score(body.likelihood, "likelihood"), score(body.impact, "impact"), rl, ri, optStr(body.owner, "owner", 100),
        body.treatment === undefined || body.treatment === null ? null : oneOf(body.treatment, "treatment", TREATMENTS), body.plan === undefined ? "" : str(body.plan, "plan", 0, 4000),
        interval, inDays(interval), JSON.stringify(body.tags === undefined ? [] : tagList(body.tags)), ext?.source ?? null, ext?.reference ?? null, t, t,
      );
      note("risk", id, who, "created", null, `R-${number}`);
      for (const l of linkList) {
        if (l === null || typeof l !== "object" || Array.isArray(l)) throw bad("Each link is { kind, product?, reference, url? }.");
        newLink(id, l as Record<string, unknown>, who);
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    return { created: true, risk: presentRisk(riskRow(id), true) };
  }

  function updateRisk(idOrKey: string, body: Record<string, unknown>, who: string) {
    const r = riskRow(idOrKey);
    exact(body, RISK_FIELDS);
    if (!Object.keys(body).length) throw bad(`Send at least one of ${RISK_FIELDS.join(", ")}.`);
    const set: Record<string, SQLInputValue> = {};
    const changes: Array<[string, unknown, unknown]> = [];
    const change = (field: string, column: string, from: unknown, to: unknown) => {
      if (JSON.stringify(from) === JSON.stringify(to)) return;
      set[column] = typeof to === "object" && to !== null ? JSON.stringify(to) : (to as SQLInputValue);
      changes.push([field, from, to]);
    };
    if ("title" in body) change("title", "title", r.title, str(body.title, "title", 3, 200));
    if ("description" in body) change("description", "description", r.description, str(body.description, "description", 0, 4000));
    if ("category" in body) change("category", "category", r.category, oneOf(body.category, "category", CATEGORIES));
    if ("likelihood" in body) change("likelihood", "likelihood", r.likelihood, score(body.likelihood, "likelihood"));
    if ("impact" in body) change("impact", "impact", r.impact, score(body.impact, "impact"));
    if ("owner" in body) change("owner", "owner", r.owner, optStr(body.owner, "owner", 100));
    if ("treatment" in body) change("treatment", "treatment", r.treatment, body.treatment === null ? null : oneOf(body.treatment, "treatment", TREATMENTS));
    if ("plan" in body) change("plan", "plan", r.plan, str(body.plan, "plan", 0, 4000));
    if ("tags" in body) change("tags", "tags", JSON.parse(r.tags), tagList(body.tags));
    const rl = "residualLikelihood" in body ? (body.residualLikelihood === null ? null : score(body.residualLikelihood, "residualLikelihood")) : r.residual_likelihood;
    const ri = "residualImpact" in body ? (body.residualImpact === null ? null : score(body.residualImpact, "residualImpact")) : r.residual_impact;
    if ((rl === null) !== (ri === null)) throw bad("residualLikelihood and residualImpact come together.");
    change("residual likelihood", "residual_likelihood", r.residual_likelihood, rl);
    change("residual impact", "residual_impact", r.residual_impact, ri);
    if ("status" in body) {
      const status = oneOf(body.status, "status", STATUSES);
      // Accepting a risk is a decision somebody answers for: it has its own call (ADR 0049).
      if (status === "accepted" && r.status !== "accepted") throw bad("Use POST /risks/{id}/accept to accept a risk: it needs a reason, an approver and an end date.");
      if (status !== r.status) {
        change("status", "status", r.status, status);
        if (r.status === "accepted") {
          set.accepted_reason = null;
          set.accepted_by = null;
          set.accepted_until = null;
          changes.push(["acceptance", `${r.accepted_by} until ${r.accepted_until}`, null]);
        }
        set.closed_at = status === "closed" ? now() : null;
      }
    }
    if ("reviewIntervalDays" in body) {
      const interval = days(body.reviewIntervalDays, "reviewIntervalDays");
      change("review interval", "review_interval_days", r.review_interval_days, interval);
      if (interval !== r.review_interval_days) {
        const base = Date.parse(`${r.last_review ?? r.created_at.slice(0, 10)}T00:00:00Z`);
        const next = new Date(base + interval * DAY).toISOString().slice(0, 10);
        change("next review", "next_review", r.next_review, next);
      }
    }
    if (changes.length) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const cols = Object.keys(set);
        db.prepare(`UPDATE risks SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(...cols.map((c) => set[c]!), now(), r.id);
        for (const [field, from, to] of changes) note("risk", r.id, who, field, from, to);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    }
    return presentRisk(riskRow(r.id), true);
  }

  function accept(idOrKey: string, body: Record<string, unknown>, who: string) {
    const r = riskRow(idOrKey);
    exact(body, ["reason", "approver", "expiresAt"]);
    if (r.status === "closed") throw new RiskError(409, "conflict", "A closed risk is not accepted: open it again first.");
    const reason = str(body.reason, "reason", 3, 500);
    const approver = str(body.approver, "approver", 2, 100);
    const t = typeof body.expiresAt === "string" ? Date.parse(body.expiresAt) : NaN;
    if (Number.isNaN(t) || t <= clock().getTime()) throw bad("expiresAt must be a date in the future.");
    if (t > clock().getTime() + MAX_ACCEPT_DAYS * DAY) throw bad(`expiresAt must be within ${MAX_ACCEPT_DAYS} days.`);
    const until = new Date(t).toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE risks SET status = 'accepted', treatment = 'accept', accepted_reason = ?, accepted_by = ?, accepted_until = ?, closed_at = NULL, updated_at = ? WHERE id = ?").run(reason, approver, until, now(), r.id);
      if (r.status !== "accepted") note("risk", r.id, who, "status", r.status, "accepted");
      if (r.treatment !== "accept") note("risk", r.id, who, "treatment", r.treatment, "accept");
      note("risk", r.id, who, "acceptance", r.status === "accepted" ? `${r.accepted_by} until ${r.accepted_until}` : null, `${approver} until ${until}: ${reason}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    return presentRisk(riskRow(r.id), true);
  }

  function reviewRisk(idOrKey: string, who: string) {
    const r = riskRow(idOrKey);
    if (r.status === "closed") throw new RiskError(409, "conflict", "A closed risk is not reviewed.");
    if (expired(r)) throw new RiskError(409, "conflict", "The acceptance has run out: accept the risk again or change its status, then review it.");
    const next = inDays(r.review_interval_days);
    db.prepare("UPDATE risks SET last_review = ?, next_review = ?, updated_at = ? WHERE id = ?").run(today(), next, now(), r.id);
    note("risk", r.id, who, "reviewed", r.last_review, today());
    return presentRisk(riskRow(r.id), true);
  }

  function listRisks(f: RiskFilter, cursor: string | undefined, limit: number): Page<ReturnType<typeof presentRisk>> {
    const where: string[] = [];
    const args: SQLInputValue[] = [];
    const t = now();
    const expiredSql = "(status = 'accepted' AND accepted_until <= ?)";
    if (f.status === "active") where.push("status <> 'closed'");
    else if (f.status === "review-due") (where.push(expiredSql), args.push(t));
    else if (f.status === "accepted") (where.push("status = 'accepted' AND accepted_until > ?"), args.push(t));
    else if (f.status) (where.push("status = ?"), args.push(f.status));
    if (f.band?.length) {
      const range = { low: "(likelihood * impact) <= 4", medium: "(likelihood * impact) BETWEEN 5 AND 9", high: "(likelihood * impact) BETWEEN 10 AND 16", critical: "(likelihood * impact) >= 17" };
      where.push(`(${f.band.map((b) => range[b]).join(" OR ")})`);
    }
    if (f.category) (where.push("category = ?"), args.push(f.category));
    if (f.owner) (where.push("owner = ?"), args.push(f.owner));
    if (f.overdue !== undefined) {
      const cond = `(status <> 'closed' AND (next_review <= ? OR ${expiredSql}))`;
      if (f.overdue) (where.push(cond), args.push(today(), t));
      else (where.push(`NOT ${cond}`), args.push(today(), t));
    }
    if (f.q) {
      const like = `%${f.q.replace(/[\\%_]/g, "\\$&")}%`;
      where.push("(title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR owner LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')");
      args.push(like, like, like, like);
    }
    const offset = decodeCursor(cursor);
    const rows = db
      .prepare(`SELECT * FROM risks ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY (likelihood * impact) DESC, number LIMIT ? OFFSET ?`)
      .all(...args, limit + 1, offset) as Array<Record<string, any>>;
    return { items: rows.slice(0, limit).map((r) => presentRisk(r)), ...(rows.length > limit && { nextCursor: encodeCursor(offset + limit) }) };
  }

  // ---------------------------------------------------------------- Vendors
  const vendorRow = (id: string) => {
    const v = db.prepare("SELECT * FROM vendors WHERE id = ?").get(id) as Record<string, any> | undefined;
    if (!v) throw notFound("The vendor");
    return v;
  };
  const vendorOverdue = (v: Record<string, any>) => v.status !== "offboarding" && v.next_review <= today();

  function presentVendor(v: Record<string, any>) {
    const linked = db
      .prepare("SELECT r.* FROM risks r JOIN vendor_risks vr ON vr.risk_id = r.id WHERE vr.vendor_id = ? ORDER BY r.number")
      .all(v.id) as Array<Record<string, any>>;
    return {
      id: v.id as string,
      name: v.name as string,
      service: v.service as string,
      dataClasses: JSON.parse(v.data_classes) as string[],
      criticality: v.criticality as Band,
      contact: (v.contact as string | null) ?? null,
      status: v.status as (typeof VENDOR_STATUSES)[number],
      questionnaire: v.questionnaire as (typeof QUESTIONNAIRES)[number],
      rating: (v.rating as (typeof RATINGS)[number] | null) ?? null,
      reviewIntervalDays: v.review_interval_days as number,
      nextReview: v.next_review as string,
      lastReview: (v.last_review as string | null) ?? null,
      overdue: vendorOverdue(v),
      notes: v.notes as string,
      risks: linked.map((r) => ({ id: r.id as string, key: `R-${r.number}`, title: r.title as string, band: bandOf(r.likelihood * r.impact) })),
      documents: (db.prepare("SELECT * FROM vendor_documents WHERE vendor_id = ? ORDER BY created_at, id").all(v.id) as Array<Record<string, any>>).map((d) => ({ id: d.id as string, title: d.title as string, url: d.url as string, createdAt: d.created_at as string })),
      createdAt: v.created_at as string,
      updatedAt: v.updated_at as string,
    };
  }

  function classes(v: unknown): string[] {
    if (!Array.isArray(v) || v.length > DATA_CLASSES.length || v.some((c) => !DATA_CLASSES.includes(c as never))) throw bad(`dataClasses is a list of ${DATA_CLASSES.join(", ")}.`);
    return [...new Set(v as string[])];
  }
  function riskIds(v: unknown): string[] {
    if (!Array.isArray(v) || v.length > 100 || v.some((k) => typeof k !== "string")) throw bad("risks is a list of risk keys such as R-3.");
    return [...new Set((v as string[]).map((k) => {
      try {
        return riskRow(k).id as string;
      } catch {
        throw bad(`${k} is not a risk on the register.`);
      }
    }))];
  }

  function createVendor(body: Record<string, unknown>, who: string) {
    exact(body, ["name", "service", "dataClasses", "criticality", "contact", "status", "questionnaire", "rating", "reviewIntervalDays", "notes", "risks"]);
    const name = str(body.name, "name", 2, 120);
    if (db.prepare("SELECT 1 FROM vendors WHERE name = ?").get(name)) throw new RiskError(409, "conflict", "A vendor with this name exists.");
    const interval = body.reviewIntervalDays === undefined ? 365 : days(body.reviewIntervalDays, "reviewIntervalDays");
    const id = randomUUID();
    const t = now();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "INSERT INTO vendors (id, name, service, data_classes, criticality, contact, status, questionnaire, rating, review_interval_days, next_review, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        id, name, body.service === undefined ? "" : str(body.service, "service", 0, 300), JSON.stringify(body.dataClasses === undefined ? [] : classes(body.dataClasses)), oneOf(body.criticality, "criticality", CRITICALITIES),
        optStr(body.contact, "contact", 200), body.status === undefined ? "onboarding" : oneOf(body.status, "status", VENDOR_STATUSES), body.questionnaire === undefined ? "not-sent" : oneOf(body.questionnaire, "questionnaire", QUESTIONNAIRES),
        body.rating === undefined || body.rating === null ? null : oneOf(body.rating, "rating", RATINGS), interval, inDays(interval), body.notes === undefined ? "" : str(body.notes, "notes", 0, 4000), t, t,
      );
      for (const rid of body.risks === undefined ? [] : riskIds(body.risks)) db.prepare("INSERT INTO vendor_risks (vendor_id, risk_id) VALUES (?, ?)").run(id, rid);
      note("vendor", id, who, "created", null, name);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    return presentVendor(vendorRow(id));
  }

  function updateVendor(id: string, body: Record<string, unknown>, who: string) {
    const v = vendorRow(id);
    exact(body, VENDOR_FIELDS);
    if (!Object.keys(body).length) throw bad(`Send at least one of ${VENDOR_FIELDS.join(", ")}.`);
    const set: Record<string, SQLInputValue> = {};
    const changes: Array<[string, unknown, unknown]> = [];
    const change = (field: string, column: string, from: unknown, to: unknown) => {
      if (JSON.stringify(from) === JSON.stringify(to)) return;
      set[column] = typeof to === "object" && to !== null ? JSON.stringify(to) : (to as SQLInputValue);
      changes.push([field, from, to]);
    };
    if ("name" in body) {
      const name = str(body.name, "name", 2, 120);
      if (name !== v.name && db.prepare("SELECT 1 FROM vendors WHERE name = ?").get(name)) throw new RiskError(409, "conflict", "A vendor with this name exists.");
      change("name", "name", v.name, name);
    }
    if ("service" in body) change("service", "service", v.service, str(body.service, "service", 0, 300));
    if ("dataClasses" in body) change("data classes", "data_classes", JSON.parse(v.data_classes), classes(body.dataClasses));
    if ("criticality" in body) change("criticality", "criticality", v.criticality, oneOf(body.criticality, "criticality", CRITICALITIES));
    if ("contact" in body) change("contact", "contact", v.contact, optStr(body.contact, "contact", 200));
    if ("status" in body) change("status", "status", v.status, oneOf(body.status, "status", VENDOR_STATUSES));
    if ("questionnaire" in body) change("questionnaire", "questionnaire", v.questionnaire, oneOf(body.questionnaire, "questionnaire", QUESTIONNAIRES));
    if ("rating" in body) change("rating", "rating", v.rating, body.rating === null ? null : oneOf(body.rating, "rating", RATINGS));
    if ("notes" in body) change("notes", "notes", v.notes, str(body.notes, "notes", 0, 4000));
    if ("reviewIntervalDays" in body) {
      const interval = days(body.reviewIntervalDays, "reviewIntervalDays");
      change("review interval", "review_interval_days", v.review_interval_days, interval);
      if (interval !== v.review_interval_days) {
        const base = Date.parse(`${v.last_review ?? v.created_at.slice(0, 10)}T00:00:00Z`);
        change("next review", "next_review", v.next_review, new Date(base + interval * DAY).toISOString().slice(0, 10));
      }
    }
    const linked = "risks" in body ? riskIds(body.risks) : null;
    const before = (db.prepare("SELECT risk_id FROM vendor_risks WHERE vendor_id = ? ORDER BY risk_id").all(id) as Array<{ risk_id: string }>).map((x) => x.risk_id);
    const keyOf = (ids: string[]) => ids.map((i) => `R-${(db.prepare("SELECT number FROM risks WHERE id = ?").get(i) as { number: number }).number}`).sort();
    db.exec("BEGIN IMMEDIATE");
    try {
      const cols = Object.keys(set);
      if (cols.length) db.prepare(`UPDATE vendors SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(...cols.map((c) => set[c]!), now(), id);
      for (const [field, from, to] of changes) note("vendor", id, who, field, from, to);
      if (linked && JSON.stringify([...linked].sort()) !== JSON.stringify(before)) {
        db.prepare("DELETE FROM vendor_risks WHERE vendor_id = ?").run(id);
        for (const rid of linked) db.prepare("INSERT INTO vendor_risks (vendor_id, risk_id) VALUES (?, ?)").run(id, rid);
        db.prepare("UPDATE vendors SET updated_at = ? WHERE id = ?").run(now(), id);
        note("vendor", id, who, "risks", keyOf(before), keyOf(linked));
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    return presentVendor(vendorRow(id));
  }

  function listVendors(f: VendorFilter, cursor: string | undefined, limit: number): Page<ReturnType<typeof presentVendor>> {
    const where: string[] = [];
    const args: SQLInputValue[] = [];
    if (f.status) (where.push("status = ?"), args.push(f.status));
    if (f.criticality?.length) (where.push(`criticality IN (${f.criticality.map(() => "?").join(",")})`), args.push(...f.criticality));
    if (f.rating) (where.push("rating = ?"), args.push(f.rating));
    if (f.overdue !== undefined) {
      const cond = "(status <> 'offboarding' AND next_review <= ?)";
      where.push(f.overdue ? cond : `NOT ${cond}`);
      args.push(today());
    }
    if (f.q) {
      const like = `%${f.q.replace(/[\\%_]/g, "\\$&")}%`;
      where.push("(name LIKE ? ESCAPE '\\' OR service LIKE ? ESCAPE '\\')");
      args.push(like, like);
    }
    const offset = decodeCursor(cursor);
    const rows = db
      .prepare(`SELECT * FROM vendors ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY CASE criticality WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC, name LIMIT ? OFFSET ?`)
      .all(...args, limit + 1, offset) as Array<Record<string, any>>;
    return { items: rows.slice(0, limit).map(presentVendor), ...(rows.length > limit && { nextCursor: encodeCursor(offset + limit) }) };
  }

  // ---------------------------------------------------------------- Overviews
  function heatmap(view: "inherent" | "residual") {
    const rows = db.prepare("SELECT * FROM risks WHERE status <> 'closed' ORDER BY number").all() as Array<Record<string, any>>;
    const cells = new Map<string, { count: number; keys: string[] }>();
    for (const r of rows) {
      // A risk nobody has treated yet keeps its inherent place on the residual map.
      const l = view === "residual" && r.residual_likelihood !== null ? r.residual_likelihood : r.likelihood;
      const i = view === "residual" && r.residual_impact !== null ? r.residual_impact : r.impact;
      const c = cells.get(`${l}-${i}`) ?? { count: 0, keys: [] };
      c.count++;
      if (c.keys.length < 5) c.keys.push(`R-${r.number}`);
      cells.set(`${l}-${i}`, c);
    }
    const out = [];
    for (let l = 5; l >= 1; l--) for (let i = 1; i <= 5; i++) out.push({ likelihood: l, impact: i, score: l * i, band: bandOf(l * i), count: cells.get(`${l}-${i}`)?.count ?? 0, keys: cells.get(`${l}-${i}`)?.keys ?? [] });
    return { view, cells: out };
  }

  function reviews() {
    const rs = db.prepare("SELECT * FROM risks WHERE status <> 'closed' ORDER BY next_review, number").all() as Array<Record<string, any>>;
    const vs = db.prepare("SELECT * FROM vendors ORDER BY next_review, name").all() as Array<Record<string, any>>;
    return { risks: rs.filter(overdue).map((r) => presentRisk(r)), vendors: vs.filter(vendorOverdue).map(presentVendor) };
  }

  function summary() {
    const rs = db.prepare("SELECT * FROM risks").all() as Array<Record<string, any>>;
    const open = rs.filter((r) => r.status !== "closed");
    const byBand: Record<Band, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const r of open) byBand[bandOf(r.likelihood * r.impact)]++;
    const count = <K extends string>(key: (r: Record<string, any>) => K | null) => {
      const m = new Map<K | null, number>();
      for (const r of open) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
      return [...m].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
    };
    const vs = db.prepare("SELECT * FROM vendors").all() as Array<Record<string, any>>;
    const byRating = { low: 0, medium: 0, high: 0, unrated: 0 };
    for (const v of vs) byRating[(v.rating ?? "unrated") as keyof typeof byRating]++;
    return {
      risks: {
        open: open.length,
        closed: rs.length - open.length,
        byBand,
        overdue: open.filter(overdue).length,
        reviewDue: open.filter(expired).length,
        accepted: open.filter((r) => r.status === "accepted" && !expired(r)).length,
      },
      vendors: { total: vs.length, overdue: vs.filter(vendorOverdue).length, byRating },
      byOwner: count((r) => r.owner).map(([owner, n]) => ({ owner, count: n })),
      byCategory: count((r) => r.category as Category).map(([category, n]) => ({ category: category as Category, count: n })),
    };
  }

  return {
    summary,
    heatmap,
    reviews,
    createRisk: createRiskRecord,
    listRisks,
    risk: (idOrKey: string) => presentRisk(riskRow(idOrKey), true),
    updateRisk,
    accept,
    reviewRisk,
    riskHistory: (idOrKey: string) => history("risk", riskRow(idOrKey).id),
    addLink(idOrKey: string, body: Record<string, unknown>, who: string) {
      const r = riskRow(idOrKey);
      const id = newLink(r.id, body, who);
      return links(r.id).find((l) => l.id === id)!;
    },
    deleteLink(idOrKey: string, linkId: string, who: string) {
      const r = riskRow(idOrKey);
      const l = db.prepare("SELECT * FROM risk_links WHERE id = ? AND risk_id = ?").get(linkId, r.id) as Record<string, any> | undefined;
      if (!l) throw notFound("The link");
      db.prepare("DELETE FROM risk_links WHERE id = ?").run(linkId);
      note("risk", r.id, who, "link removed", `${l.kind}${l.product ? ` ${l.product}` : ""}: ${l.reference}`, null);
    },
    deleteRisk(idOrKey: string) {
      const r = riskRow(idOrKey);
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM risks WHERE id = ?").run(r.id);
        db.prepare("DELETE FROM history WHERE subject_kind = 'risk' AND subject_id = ?").run(r.id);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
    createVendor,
    listVendors,
    vendor: (id: string) => presentVendor(vendorRow(id)),
    updateVendor,
    reviewVendor(id: string, who: string) {
      const v = vendorRow(id);
      db.prepare("UPDATE vendors SET last_review = ?, next_review = ?, updated_at = ? WHERE id = ?").run(today(), inDays(v.review_interval_days), now(), id);
      note("vendor", id, who, "reviewed", v.last_review, today());
      return presentVendor(vendorRow(id));
    },
    vendorHistory: (id: string) => history("vendor", vendorRow(id).id),
    addDocument(id: string, body: Record<string, unknown>, who: string) {
      const v = vendorRow(id);
      exact(body, ["title", "url"]);
      if ((db.prepare("SELECT COUNT(*) AS n FROM vendor_documents WHERE vendor_id = ?").get(id) as { n: number }).n >= 30) throw bad("A vendor has at most 30 documents.");
      const doc = { id: randomUUID(), title: str(body.title, "title", 1, 200), url: webUrl(body.url), createdAt: now() };
      db.prepare("INSERT INTO vendor_documents (id, vendor_id, title, url, created_at) VALUES (?, ?, ?, ?, ?)").run(doc.id, v.id, doc.title, doc.url, doc.createdAt);
      note("vendor", id, who, "document added", null, doc.title);
      return doc;
    },
    deleteDocument(id: string, docId: string, who: string) {
      const d = db.prepare("SELECT * FROM vendor_documents WHERE id = ? AND vendor_id = ?").get(docId, vendorRow(id).id) as Record<string, any> | undefined;
      if (!d) throw notFound("The document");
      db.prepare("DELETE FROM vendor_documents WHERE id = ?").run(docId);
      note("vendor", id, who, "document removed", d.title, null);
    },
    deleteVendor(id: string) {
      const v = vendorRow(id);
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM vendors WHERE id = ?").run(v.id);
        db.prepare("DELETE FROM history WHERE subject_kind = 'vendor' AND subject_id = ?").run(v.id);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
  };
}

export type Risk = ReturnType<typeof createRisk>;
