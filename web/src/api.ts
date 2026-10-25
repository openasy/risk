// The UI is an ordinary client of the public API (ADR 0014, 0018). Types follow openapi.json.

export type Band = "low" | "medium" | "high" | "critical";
export type Category = "strategic" | "operational" | "security" | "compliance" | "vendor" | "other";
export type RiskStatus = "identified" | "assessing" | "treating" | "accepted" | "closed" | "review-due";
export type Treatment = "mitigate" | "transfer" | "accept" | "avoid";
export type LinkKind = "control" | "finding" | "incident" | "vendor" | "other";

/** Another OpenAsy product of this install, from OPENASY_PRODUCTS. */
export interface ProductLink {
  id: string;
  url: string;
}

export interface Summary {
  risks: { open: number; closed: number; byBand: Record<Band, number>; overdue: number; reviewDue: number; accepted: number };
  vendors: { total: number; overdue: number; byRating: { low: number; medium: number; high: number; unrated: number } };
  byOwner: Array<{ owner: string | null; count: number }>;
  byCategory: Array<{ category: Category; count: number }>;
}

export interface Link {
  id: string;
  kind: LinkKind;
  product: string | null;
  reference: string;
  url: string | null;
  createdAt: string;
}

export interface Risk {
  id: string;
  key: string;
  number: number;
  title: string;
  description: string;
  category: Category;
  likelihood: number;
  impact: number;
  score: number;
  band: Band;
  residual: { likelihood: number; impact: number; score: number; band: Band } | null;
  owner: string | null;
  status: RiskStatus;
  treatment: Treatment | null;
  plan: string;
  reviewIntervalDays: number;
  nextReview: string;
  lastReview: string | null;
  overdue: boolean;
  acceptance: { reason: string; approver: string; until: string; expired: boolean } | null;
  tags: string[];
  external: { source: string; reference: string } | null;
  linkCount: number;
  controlCount: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  links?: Link[];
  /** Only when one risk is asked for. */
  controls?: ControlRef[];
}

export interface HistoryEntry {
  at: string;
  who: string;
  field: string;
  from: string | null;
  to: string | null;
}

export interface HeatCell {
  likelihood: number;
  impact: number;
  score: number;
  band: Band;
  count: number;
  keys: string[];
}

export interface Vendor {
  id: string;
  name: string;
  service: string;
  dataClasses: string[];
  criticality: Band;
  contact: string | null;
  status: "onboarding" | "active" | "offboarding";
  questionnaire: "not-sent" | "sent" | "received" | "reviewed";
  rating: "low" | "medium" | "high" | null;
  reviewIntervalDays: number;
  nextReview: string;
  lastReview: string | null;
  overdue: boolean;
  notes: string;
  risks: Array<{ id: string; key: string; title: string; band: Band }>;
  documents: Array<{ id: string; title: string; url: string; createdAt: string }>;
  createdAt: string;
  updatedAt: string;
}

export class Unauthorized extends Error {}
/** The signed-in owner or admin has no second factor yet; the sign-in gate asks for one. */
export class MfaSetupRequired extends Error {}
export class ApiError extends Error {}

// The session is an HttpOnly cookie set by sign-in (@openasy/auth); the browser sends it, nothing is stored here.
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
  });
  if (!res.ok) {
    const problem = (await res.json().catch(() => ({}))) as { code?: string; detail?: string };
    if (res.status === 401) throw new Unauthorized(problem.detail);
    if (problem.code === "mfa-setup-required") throw new MfaSetupRequired(problem.detail);
    throw new ApiError(problem.detail ?? `${path}: ${res.status}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export interface ControlRef {
  framework: string;
  id: string;
  title: string | null;
}

export interface FrameworkSummary {
  id: string;
  name: string;
  short: string;
  controls: number;
}

export interface FrameworkControl {
  id: string;
  title: string;
  group: string;
  /** OpenAsy products that keep evidence for it. */
  products: string[];
  risks: Array<{ id: string; key: string; title: string; band: Band; residualBand: Band | null; status: string }>;
}

export interface Framework {
  id: string;
  name: string;
  short: string;
  covered: number;
  controls: FrameworkControl[];
}

/** What the overview draws besides the summary (GET /api/v1/overview). Counts are of risks not closed. */
export interface Overview {
  byStatus: Record<"identified" | "assessing" | "treating" | "accepted" | "review-due" | "closed", number>;
  /** By band before and after treatment; a risk not treated yet keeps its inherent score. */
  inherent: Record<Band, number>;
  residual: Record<Band, number>;
  controls: { with: number; without: number };
  /** Risks opened and closed in each of the last 12 weeks, oldest first. */
  weeks: Array<{ week: string; opened: number; closed: number }>;
  reviews: Array<{ id: string; number: number; title: string; owner: string | null; band: Band; nextReview: string; overdue: boolean }>;
}
