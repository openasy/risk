import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { createGunzip } from "node:zlib";
import { AuthError, identityOrigin, mergeOpenApi, sendProblem, type Auth, type Role } from "@openasy/auth";
import { log } from "./log.ts";
import { countRequest, renderMetrics } from "./metrics.ts";
import type { ProductLink } from "./products.ts";
import {
  BANDS,
  CATEGORIES,
  RATINGS,
  RiskError,
  STATUSES,
  VENDOR_STATUSES,
  parseLimit,
  type Band,
  type Category,
  type ProblemCode,
  type Risk,
  type RiskFilter,
  type VendorFilter,
} from "./risk.ts";

export interface AppOptions {
  db: DatabaseSync;
  risk: Risk;
  version: string;
  /** Sign-in, sessions, members and API tokens (ADR 0002, 0003). */
  auth: Auth;
  /** For tests and local scripts: one shared token with the admin role. main.ts never sets it. */
  adminToken?: string;
  /** Built web UI; omit to run headless (ADR 0018). */
  webDir?: string;
  /** Built API reference (Swagger UI), served at /api/docs. */
  docsDir?: string;
  /** The OpenAPI description, served at /api/openapi.json with this release's version. */
  openapi?: Record<string, unknown>;
  /** false when /metrics is served on its own port instead (ADR 0026). */
  serveMetrics?: boolean;
  /** The install's OpenAsy products and their addresses, from OPENASY_PRODUCTS, for the product switcher. */
  products?: ProductLink[];
}

function metricsText(risk: Risk, version: string) {
  const s = risk.summary();
  return renderMetrics(version, {
    open: s.risks.byBand,
    overdue: s.risks.overdue,
    reviewDue: s.risks.reviewDue,
    accepted: s.risks.accepted,
    vendors: s.vendors.total,
    vendorsOverdue: s.vendors.overdue,
  });
}

/** Serves only /metrics, for a port that is not exposed with the rest (RISK_METRICS_PORT). */
export function createMetricsHandler(risk: Risk, version: string) {
  return (req: IncomingMessage, res: ServerResponse) => {
    if (new URL(req.url ?? "/", "http://localhost").pathname !== "/metrics") return problem(res, 404, "not-found");
    send(res, 200, metricsText(risk, version), "text/plain; version=0.0.4");
  };
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

// Identity keeps people's theme and language when they sign in through it; the pages read them there (ADR 0033).
const IDENTITY = identityOrigin(process.env);

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "content-security-policy": `default-src 'self'; connect-src 'self'${IDENTITY ? ` ${IDENTITY}` : ""}; img-src 'self' data:; style-src 'self' 'unsafe-inline'`,
};

function send(res: ServerResponse, status: number, body: string | Buffer, type = "application/json", headers: Record<string, string> = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers, "content-type": type, "content-length": Buffer.byteLength(body) });
  res.end(body);
}

const json = (res: ServerResponse, status: number, data: unknown, headers?: Record<string, string>) =>
  send(res, status, JSON.stringify(data), "application/json", headers);

const TITLES: Record<ProblemCode, string> = {
  "invalid-token": "Invalid token",
  "invalid-json": "Invalid JSON",
  "invalid-body": "Invalid request body",
  "not-found": "Not found",
  conflict: "Conflict",
  "payload-too-large": "Payload too large",
  "internal-error": "Internal error",
};

/** RFC 9457 Problem Details (ADR 0024). `code` is the stable part clients match on. */
function problem(res: ServerResponse, status: number, code: ProblemCode, detail?: string) {
  const body = { type: `https://openasy.github.io/problems/${code}`, title: TITLES[code], status, code, ...(detail && { detail }) };
  send(res, status, JSON.stringify(body), "application/problem+json");
}

/** Serves a file from dir, or returns false when the path is outside it or missing. */
async function serveFile(res: ServerResponse, dir: string, relative: string): Promise<boolean> {
  const file = normalize(join(dir, relative));
  if (!file.startsWith(normalize(dir)) || !extname(file)) return false;
  try {
    send(res, 200, await readFile(file), TYPES[extname(file)] ?? "application/octet-stream");
    return true;
  } catch {
    return false;
  }
}

/** Reads the whole body, gunzipping it when sent with `Content-Encoding: gzip`, up to limit bytes. */
async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const encoding = req.headers["content-encoding"];
  if (encoding && encoding !== "gzip" && encoding !== "identity") throw new RiskError(400, "invalid-body", "Content-Encoding must be gzip or absent.");
  const source = encoding === "gzip" ? req.pipe(createGunzip()) : req;
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of source as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > limit) throw new RiskError(413, "payload-too-large", `The body must be at most ${Math.round(limit / 1024 / 1024)} MiB.`);
      chunks.push(chunk);
    }
  } catch (err) {
    if (err instanceof RiskError) throw err;
    throw new RiskError(400, "invalid-body", "The gzip body could not be read.");
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage, limit = 64 * 1024): Promise<Record<string, unknown>> {
  const raw = await readBody(req, limit).catch((err: unknown) => {
    if (err instanceof RiskError && err.code === "payload-too-large")
      throw new RiskError(400, "invalid-json", `The body must be JSON, at most ${Math.round(limit / 1024)} KiB.`);
    throw err;
  });
  try {
    const body = JSON.parse(raw.toString("utf8")) as unknown;
    if (body === null || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
    return body as Record<string, unknown>;
  } catch {
    throw new RiskError(400, "invalid-json", "The body must be a JSON object.");
  }
}

function tokenMatches(header: string | undefined, expected: string | undefined): boolean {
  if (!expected || !header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The role a route needs (ADR 0003). */
type Access = "none" | Role;
interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: string[];
  body: () => Promise<Record<string, unknown>>;
  /** Who made the request, for the audit trail of a decision. */
  actor: () => string;
}
interface Route {
  method: string;
  /** Path pattern; each `:name` matches one segment. */
  path: string;
  auth: Access;
  handle: (ctx: Ctx) => unknown;
}

const bool = (url: URL, name: string) => {
  const v = url.searchParams.get(name);
  if (v === null) return undefined;
  if (v !== "true" && v !== "false") throw new RiskError(422, "invalid-body", `${name} must be true or false.`);
  return v === "true";
};
const bands = (url: URL, name: string): Band[] | undefined => {
  const list = url.searchParams.get(name)?.split(",").filter(Boolean) as Band[] | undefined;
  if (list?.some((b) => !BANDS.includes(b))) throw new RiskError(422, "invalid-body", `${name} is a comma-separated list of ${BANDS.join(", ")}.`);
  return list;
};
function query(url: URL) {
  const q = url.searchParams.get("q")?.trim();
  if (q && q.length > 128) throw new RiskError(422, "invalid-body", "q must be at most 128 characters.");
  return q || undefined;
}

function riskFilter(url: URL): RiskFilter {
  const status = url.searchParams.get("status") ?? undefined;
  if (status !== undefined && status !== "active" && status !== "review-due" && !STATUSES.includes(status as never))
    throw new RiskError(422, "invalid-body", `status must be active, review-due or one of ${STATUSES.join(", ")}.`);
  const category = url.searchParams.get("category") ?? undefined;
  if (category !== undefined && !CATEGORIES.includes(category as Category))
    throw new RiskError(422, "invalid-body", `category must be one of ${CATEGORIES.join(", ")}.`);
  const owner = url.searchParams.get("owner") ?? undefined;
  if (owner && owner.length > 100) throw new RiskError(422, "invalid-body", "owner must be at most 100 characters.");
  return {
    status: status as RiskFilter["status"],
    band: bands(url, "band"),
    category: category as Category | undefined,
    owner,
    overdue: bool(url, "overdue"),
    q: query(url),
    control: url.searchParams.get("control") ?? undefined,
  };
}

function vendorFilter(url: URL): VendorFilter {
  const status = url.searchParams.get("status") ?? undefined;
  if (status !== undefined && !VENDOR_STATUSES.includes(status as never))
    throw new RiskError(422, "invalid-body", `status must be one of ${VENDOR_STATUSES.join(", ")}.`);
  const rating = url.searchParams.get("rating") ?? undefined;
  if (rating !== undefined && !RATINGS.includes(rating as never)) throw new RiskError(422, "invalid-body", `rating must be one of ${RATINGS.join(", ")}.`);
  return {
    status: status as VendorFilter["status"],
    criticality: bands(url, "criticality"),
    rating: rating as VendorFilter["rating"],
    overdue: bool(url, "overdue"),
    q: query(url),
  };
}

export function createApp({ db, risk, version, auth, adminToken, webDir, docsDir, openapi, serveMetrics = true, products = [] }: AppOptions) {
  // The served description includes /api/v1/auth from @openasy/auth, so the API reference documents sign-in too.
  const spec = openapi && JSON.stringify({ ...mergeOpenApi(openapi), info: { ...(openapi.info as object), version } });
  const noContent = (res: ServerResponse) => {
    res.writeHead(204, SECURITY_HEADERS).end();
  };
  const cursor = (url: URL) => url.searchParams.get("cursor") ?? undefined;
  const limit = (url: URL) => parseLimit(url.searchParams.get("limit"));
  const page = <K extends string, T>(key: K, p: { items: T[]; nextCursor?: string }) =>
    ({ [key]: p.items, ...(p.nextCursor && { nextCursor: p.nextCursor }) }) as Record<K, T[]> & { nextCursor?: string };

  const routes: Route[] = [
    { method: "GET", path: "/api/v1/version", auth: "none", handle: () => ({ product: "risk", version }) },
    { method: "GET", path: "/api/v1/products", auth: "viewer", handle: () => ({ products }) },
    { method: "GET", path: "/api/v1/summary", auth: "viewer", handle: () => risk.summary() },
    { method: "GET", path: "/api/v1/overview", auth: "viewer", handle: () => risk.overview() },
    {
      method: "GET",
      path: "/api/v1/heatmap",
      auth: "viewer",
      handle: ({ url }) => {
        const view = url.searchParams.get("view") ?? "inherent";
        if (view !== "inherent" && view !== "residual") throw new RiskError(422, "invalid-body", "view must be inherent or residual.");
        return risk.heatmap(view);
      },
    },
    { method: "GET", path: "/api/v1/reviews", auth: "viewer", handle: () => risk.reviews() },

    {
      // Other products open a risk from a finding with an API token (ADR 0023). The same external source and reference
      // opens one risk; asking again adds a line to its history and answers 200.
      method: "POST",
      path: "/api/v1/risks",
      auth: "editor",
      handle: async ({ res, body, actor }) => {
        const { created, risk: r } = risk.createRisk(await body(), actor());
        json(res, created ? 201 : 200, r, { location: `/api/v1/risks/${r.id}` });
      },
    },
    { method: "GET", path: "/api/v1/risks", auth: "viewer", handle: ({ url }) => page("risks", risk.listRisks(riskFilter(url), cursor(url), limit(url))) },
    { method: "GET", path: "/api/v1/risks/:id", auth: "viewer", handle: ({ params }) => risk.risk(params[0]!) },
    {
      method: "PATCH",
      path: "/api/v1/risks/:id",
      auth: "editor",
      handle: async ({ params, body, actor }) => risk.updateRisk(params[0]!, await body(), actor()),
    },
    { method: "DELETE", path: "/api/v1/risks/:id", auth: "admin", handle: ({ res, params }) => (risk.deleteRisk(params[0]!), noContent(res)) },
    // Accepting a risk is a decision somebody answers for, so it is an admin's (ADR 0049).
    {
      method: "POST",
      path: "/api/v1/risks/:id/accept",
      auth: "admin",
      handle: async ({ params, body, actor }) => risk.accept(params[0]!, await body(), actor()),
    },
    { method: "POST", path: "/api/v1/risks/:id/review", auth: "editor", handle: ({ params, actor }) => risk.reviewRisk(params[0]!, actor()) },
    { method: "GET", path: "/api/v1/risks/:id/history", auth: "viewer", handle: ({ params }) => ({ history: risk.riskHistory(params[0]!) }) },
    // The controls of ISO 27001 and SOC 2 that treat a risk, chosen from GET /api/v1/frameworks.
    {
      method: "PUT",
      path: "/api/v1/risks/:id/controls",
      auth: "editor",
      handle: async ({ params, body, actor }) => ({ controls: risk.setControls(params[0]!, await body(), actor()) }),
    },
    { method: "GET", path: "/api/v1/frameworks", auth: "viewer", handle: () => ({ frameworks: risk.frameworks() }) },
    { method: "GET", path: "/api/v1/frameworks/:id", auth: "viewer", handle: ({ params }) => risk.framework(params[0]!) },
    {
      method: "POST",
      path: "/api/v1/risks/:id/links",
      auth: "editor",
      handle: async ({ res, params, body, actor }) => json(res, 201, risk.addLink(params[0]!, await body(), actor())),
    },
    {
      method: "DELETE",
      path: "/api/v1/risks/:id/links/:linkId",
      auth: "editor",
      handle: ({ res, params, actor }) => (risk.deleteLink(params[0]!, params[1]!, actor()), noContent(res)),
    },

    {
      method: "POST",
      path: "/api/v1/vendors",
      auth: "editor",
      handle: async ({ res, body, actor }) => json(res, 201, risk.createVendor(await body(), actor())),
    },
    {
      method: "GET",
      path: "/api/v1/vendors",
      auth: "viewer",
      handle: ({ url }) => page("vendors", risk.listVendors(vendorFilter(url), cursor(url), limit(url))),
    },
    { method: "GET", path: "/api/v1/vendors/:id", auth: "viewer", handle: ({ params }) => risk.vendor(params[0]!) },
    {
      method: "PATCH",
      path: "/api/v1/vendors/:id",
      auth: "editor",
      handle: async ({ params, body, actor }) => risk.updateVendor(params[0]!, await body(), actor()),
    },
    { method: "DELETE", path: "/api/v1/vendors/:id", auth: "admin", handle: ({ res, params }) => (risk.deleteVendor(params[0]!), noContent(res)) },
    { method: "POST", path: "/api/v1/vendors/:id/review", auth: "editor", handle: ({ params, actor }) => risk.reviewVendor(params[0]!, actor()) },
    { method: "GET", path: "/api/v1/vendors/:id/history", auth: "viewer", handle: ({ params }) => ({ history: risk.vendorHistory(params[0]!) }) },
    {
      method: "POST",
      path: "/api/v1/vendors/:id/documents",
      auth: "editor",
      handle: async ({ res, params, body, actor }) => json(res, 201, risk.addDocument(params[0]!, await body(), actor())),
    },
    {
      method: "DELETE",
      path: "/api/v1/vendors/:id/documents/:docId",
      auth: "editor",
      handle: ({ res, params, actor }) => (risk.deleteDocument(params[0]!, params[1]!, actor()), noContent(res)),
    },
  ];

  const compiled = routes.map((r) => ({ ...r, re: new RegExp(`^${r.path.replace(/:[A-Za-z]+/g, "([^/]+)")}$`) }));

  /** Returns who is calling: a person, or the API token another product sends. */
  function authorize(req: IncomingMessage, access: Access): string {
    if (access === "none") return "anonymous";
    if (tokenMatches(req.headers.authorization, adminToken)) return "admin token";
    const p = auth.authorize(req, access);
    return p.kind === "session" ? p.user.name : `API token ${p.name}`;
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<string> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (path === "/healthz") return (json(res, 200, { status: "ok" }), "/healthz");

    if (path === "/readyz") {
      // Ready as long as the database answers.
      try {
        db.prepare("SELECT 1").get();
        json(res, 200, { status: "ready" });
      } catch {
        json(res, 503, { status: "database unavailable" });
      }
      return "/readyz";
    }

    if (path === "/metrics") {
      // Not even the web UI's fallback answers here when metrics have their own port.
      if (serveMetrics) send(res, 200, metricsText(risk, version), "text/plain; version=0.0.4");
      else problem(res, 404, "not-found");
      return "/metrics";
    }

    if (path === "/api/openapi.json" && spec) return (send(res, 200, spec), "/api/openapi.json");

    if (docsDir && (path === "/api/docs" || path.startsWith("/api/docs/"))) {
      if (path === "/api/docs") {
        res.writeHead(301, { ...SECURITY_HEADERS, location: "/api/docs/" }).end();
        return "/api/docs";
      }
      const relative = path.slice("/api/docs/".length) || "index.html";
      if (!(await serveFile(res, docsDir, relative))) problem(res, 404, "not-found");
      return "/api/docs";
    }

    if (await auth.handle(req, res)) return auth.routeName(req) ?? "/api/v1/auth/*";

    for (const r of compiled) {
      const m = path.match(r.re);
      if (!m || r.method !== req.method) continue;
      try {
        const who = authorize(req, r.auth);
        const params = m.slice(1).map(decodeURIComponent);
        const result = await r.handle({ req, res, url, params, body: () => readJson(req), actor: () => who });
        if (!res.headersSent && result !== undefined) json(res, 200, result);
      } catch (err) {
        if (err instanceof AuthError) {
          sendProblem(res, err);
          if (!req.complete) req.resume();
          return r.path;
        }
        if (!(err instanceof RiskError)) throw err;
        problem(res, err.status, err.code, err.message);
        // Unread request bodies would otherwise hold the connection.
        if (!req.complete) req.resume();
      }
      return r.path;
    }

    if (path.startsWith("/api/")) return (problem(res, 404, "not-found"), "/api/*");

    if (webDir && (req.method === "GET" || req.method === "HEAD")) {
      // Unknown paths fall back to the single-page app.
      if (!(await serveFile(res, webDir, path === "/" ? "index.html" : path))) send(res, 200, await readFile(join(webDir, "index.html")), TYPES[".html"]);
      return "/web";
    }

    problem(res, 404, "not-found");
    return "unmatched";
  }

  return async (req: IncomingMessage, res: ServerResponse) => {
    const started = performance.now();
    let routeName = "error";
    try {
      routeName = await route(req, res);
    } catch (err) {
      log("error", "request failed", { error: String(err), path: req.url });
      if (!res.headersSent) problem(res, 500, "internal-error");
    }
    countRequest(req.method ?? "GET", routeName, res.statusCode);
    if (routeName !== "/healthz" && routeName !== "/metrics") {
      log("info", "request", { method: req.method, path: url(req), status: res.statusCode, ms: Math.round(performance.now() - started) });
    }
  };
}

/** The path without the query string, which may name hosts and images. */
const url = (req: IncomingMessage) => (req.url ?? "/").split("?")[0];
