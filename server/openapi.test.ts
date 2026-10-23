import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_TOKEN, startApp } from "./test-app.ts";

// Contract tests (ADR 0024): every response the API sends must match openapi.json.

type Spec = {
  info: { version: string };
  paths: Record<string, Record<string, { responses: Record<string, { $ref?: string; content?: Record<string, { schema: object }> }> }>>;
  components: { responses: Record<string, { content: Record<string, { schema: object }> }> };
};

const spec = JSON.parse(readFileSync(new URL("../openapi.json", import.meta.url), "utf8")) as Spec;
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

const ajv = new Ajv2020({ strict: false, validateFormats: false });
ajv.addSchema(spec, "openapi");

const docsDir = mkdtempSync(join(tmpdir(), "risk-docs-"));
writeFileSync(join(docsDir, "index.html"), "<!doctype html><title>API</title>");

let app: Awaited<ReturnType<typeof startApp>>;
let base: string;
const covered = new Set<string>();

beforeAll(async () => {
  app = await startApp({ version, openapi: spec, docsDir });
  base = app.base;
});

afterAll(() => app.close());

/** Calls the API and checks status, content type and body against the description. */
async function call(method: string, path: string, init: RequestInit = {}, concrete = path) {
  const res = await fetch(base + concrete, { ...init, method });
  const operation = spec.paths[path]?.[method.toLowerCase()];
  expect(operation, `${method} ${path} is not in openapi.json`).toBeDefined();
  covered.add(`${method} ${path}`);

  const declared = operation!.responses[String(res.status)];
  expect(declared, `${method} ${concrete} answered ${res.status}, which openapi.json does not list`).toBeDefined();
  // A response is either inline or a $ref to components/responses; build the JSON pointer to its schema either way.
  const shared = declared!.$ref?.split("/").pop();
  const response = shared ? spec.components.responses[shared]! : declared!;
  const at = shared
    ? `openapi#/components/responses/${shared}`
    : `openapi#/paths/${path.replaceAll("/", "~1")}/${method.toLowerCase()}/responses/${res.status}`;

  if (!response.content) {
    expect(res.headers.get("content-length") ?? "0", `${method} ${path} ${res.status} should have no body`).toBe("0");
    return { res, body: undefined };
  }
  const type = res.headers.get("content-type")!.split(";")[0]!;
  expect(response.content?.[type], `${method} ${path} ${res.status} sent ${type}, which openapi.json does not list`).toBeDefined();

  const body = type.endsWith("json") ? await res.json() : await res.text();
  const schema = `${at}/content/${type.replace("/", "~1")}/schema`;
  const validate = ajv.getSchema(schema)!;
  expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
  return { res, body };
}

const auth = (token: string, body?: string, type = "application/json") => ({
  headers: { authorization: `Bearer ${token}`, "content-type": type },
  ...(body !== undefined && { body }),
});
const admin = (body?: unknown) => auth(ADMIN_TOKEN, body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body));

describe("openapi.json", () => {
  it("has the version of this release", () => {
    expect(spec.info.version).toBe(version);
  });

  it("is served with the running version", async () => {
    const served = (await (await fetch(`${base}/api/openapi.json`)).json()) as Spec;
    expect(served.info.version).toBe(version);
    // risk's own operations, then sign-in from @openasy/auth (tested against its description in that package).
    expect(Object.keys(served.paths).filter((p) => !p.startsWith("/api/v1/auth/"))).toEqual(Object.keys(spec.paths));
    expect(served.paths["/api/v1/auth/login"]).toBeDefined();
  });

  it("serves the API reference at /api/docs/", async () => {
    expect((await fetch(`${base}/api/docs`, { redirect: "manual" })).headers.get("location")).toBe("/api/docs/");
    const res = await fetch(`${base}/api/docs/`);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect((await fetch(`${base}/api/docs/../../package.json`)).status).not.toBe(200);
  });
});

describe("responses match openapi.json", () => {
  let risk = "";
  let key = "";
  let linkId = "";
  let vendor = "";
  let docId = "";
  const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
  const r = (rest = "") => `/api/v1/risks/${key}${rest}`;
  const v = (rest = "") => `/api/v1/vendors/${vendor}${rest}`;
  const none = { method: "GET" };

  it("product and health", async () => {
    await call("GET", "/api/v1/version");
    await call("GET", "/api/v1/products", admin());
    await call("GET", "/api/v1/products", {});
    await call("GET", "/healthz");
    await call("GET", "/readyz");
    await call("GET", "/metrics");
  });

  it("risks: add, change, accept, review", async () => {
    const made = (
      await call(
        "POST",
        "/api/v1/risks",
        admin({
          title: "Customer data in a public bucket",
          category: "security",
          likelihood: 4,
          impact: 5,
          residualLikelihood: 2,
          residualImpact: 3,
          owner: "Ada",
          external: { source: "dast", reference: "shop/40018" },
          links: [{ kind: "finding", product: "dast", reference: "shop/40018" }],
        }),
      )
    ).body as { id: string; key: string };
    risk = made.id;
    key = made.key;
    await call(
      "POST",
      "/api/v1/risks",
      admin({
        title: "Customer data in a public bucket",
        category: "security",
        likelihood: 4,
        impact: 5,
        external: { source: "dast", reference: "shop/40018" },
      }),
    );
    await call("POST", "/api/v1/risks", admin({ title: "x", category: "security", likelihood: 4, impact: 5 }));
    await call("POST", "/api/v1/risks", admin("nope"));
    await call("POST", "/api/v1/risks", {});
    await call("GET", "/api/v1/risks/{id}", admin(), r());
    await call("GET", "/api/v1/risks/{id}", admin(), `/api/v1/risks/${risk}`);
    await call("GET", "/api/v1/risks/{id}", admin(), "/api/v1/risks/R-404");
    await call("GET", "/api/v1/risks/{id}", {}, r());
    await call("PATCH", "/api/v1/risks/{id}", admin({ likelihood: 3, status: "assessing", treatment: "mitigate", tags: ["cloud"] }), r());
    await call("PATCH", "/api/v1/risks/{id}", admin({ status: "accepted" }), r());
    await call("PATCH", "/api/v1/risks/{id}", admin({}), r());
    await call("PATCH", "/api/v1/risks/{id}", admin({ title: "Public bucket" }), "/api/v1/risks/R-404");
    await call("PATCH", "/api/v1/risks/{id}", { method: "PATCH" }, r());
    await call("POST", "/api/v1/risks/{id}/review", admin(), r("/review"));
    await call("POST", "/api/v1/risks/{id}/review", admin(), "/api/v1/risks/R-404/review");
    await call("POST", "/api/v1/risks/{id}/review", { method: "POST" }, r("/review"));
    await call("POST", "/api/v1/risks/{id}/accept", admin({ reason: "Cost is above the loss", approver: "CISO", expiresAt: inDays(30) }), r("/accept"));
    await call("POST", "/api/v1/risks/{id}/accept", admin({ reason: "x" }), r("/accept"));
    await call(
      "POST",
      "/api/v1/risks/{id}/accept",
      admin({ reason: "Cost is above the loss", approver: "CISO", expiresAt: inDays(30) }),
      "/api/v1/risks/R-404/accept",
    );
    await call("POST", "/api/v1/risks/{id}/accept", { method: "POST" }, r("/accept"));
    await call("PATCH", "/api/v1/risks/{id}", admin({ status: "closed" }), r());
    await call("POST", "/api/v1/risks/{id}/accept", admin({ reason: "Cost is above the loss", approver: "CISO", expiresAt: inDays(30) }), r("/accept"));
    await call("POST", "/api/v1/risks/{id}/review", admin(), r("/review"));
    await call("PATCH", "/api/v1/risks/{id}", admin({ status: "treating" }), r());
  });

  it("lists, history and links", async () => {
    await call("GET", "/api/v1/risks", admin());
    await call("GET", "/api/v1/risks", admin(), "/api/v1/risks?status=active&band=high,critical&category=security&owner=Ada&overdue=false&q=bucket&limit=1");
    await call("GET", "/api/v1/risks", admin(), "/api/v1/risks?band=urgent");
    await call("GET", "/api/v1/risks", {});
    await call("GET", "/api/v1/risks/{id}/history", admin(), r("/history"));
    await call("GET", "/api/v1/risks/{id}/history", admin(), "/api/v1/risks/R-404/history");
    await call("GET", "/api/v1/risks/{id}/history", {}, r("/history"));
    linkId = (
      (
        await call(
          "POST",
          "/api/v1/risks/{id}/links",
          admin({ kind: "control", product: "compliance", reference: "A.8.24", url: "https://compliance.example.com/c/1" }),
          r("/links"),
        )
      ).body as { id: string }
    ).id;
    await call("POST", "/api/v1/risks/{id}/links", admin({ kind: "control", product: "compliance", reference: "A.8.24" }), r("/links"));
    await call("POST", "/api/v1/risks/{id}/links", admin({ kind: "magic", reference: "x" }), r("/links"));
    await call("POST", "/api/v1/risks/{id}/links", admin({ kind: "other", reference: "x" }), "/api/v1/risks/R-404/links");
    await call("POST", "/api/v1/risks/{id}/links", { method: "POST" }, r("/links"));
    await call("DELETE", "/api/v1/risks/{id}/links/{linkId}", admin(), r(`/links/${linkId}`));
    await call("DELETE", "/api/v1/risks/{id}/links/{linkId}", admin(), r(`/links/${linkId}`));
    await call("DELETE", "/api/v1/risks/{id}/links/{linkId}", { method: "DELETE" }, r("/links/x"));
  });

  it("vendors", async () => {
    vendor = (
      (
        await call(
          "POST",
          "/api/v1/vendors",
          admin({ name: "Acme Payments", service: "Card processing", dataClasses: ["financial"], criticality: "critical", risks: [key] }),
        )
      ).body as { id: string }
    ).id;
    await call("POST", "/api/v1/vendors", admin({ name: "Acme Payments", criticality: "low" }));
    await call("POST", "/api/v1/vendors", admin({ name: "Other", criticality: "huge" }));
    await call("POST", "/api/v1/vendors", admin("nope"));
    await call("POST", "/api/v1/vendors", {});
    await call("GET", "/api/v1/vendors", admin());
    await call("GET", "/api/v1/vendors", admin(), "/api/v1/vendors?status=onboarding&criticality=critical&overdue=false&q=acme&limit=1");
    await call("GET", "/api/v1/vendors", admin(), "/api/v1/vendors?rating=awful");
    await call("GET", "/api/v1/vendors", {});
    await call("GET", "/api/v1/vendors/{id}", admin(), v());
    await call("GET", "/api/v1/vendors/{id}", admin(), "/api/v1/vendors/missing");
    await call("GET", "/api/v1/vendors/{id}", {}, v());
    await call("PATCH", "/api/v1/vendors/{id}", admin({ status: "active", rating: "medium", questionnaire: "received", risks: [] }), v());
    await call("PATCH", "/api/v1/vendors/{id}", admin({ criticality: "huge" }), v());
    await call("PATCH", "/api/v1/vendors/{id}", admin({}), v());
    await call("PATCH", "/api/v1/vendors/{id}", admin({ name: "Acme" }), "/api/v1/vendors/missing");
    await call("PATCH", "/api/v1/vendors/{id}", { method: "PATCH" }, v());
    await call("POST", "/api/v1/vendors/{id}/review", admin(), v("/review"));
    await call("POST", "/api/v1/vendors/{id}/review", admin(), "/api/v1/vendors/missing/review");
    await call("POST", "/api/v1/vendors/{id}/review", { method: "POST" }, v("/review"));
    await call("GET", "/api/v1/vendors/{id}/history", admin(), v("/history"));
    await call("GET", "/api/v1/vendors/{id}/history", admin(), "/api/v1/vendors/missing/history");
    await call("GET", "/api/v1/vendors/{id}/history", {}, v("/history"));
    docId = (
      (await call("POST", "/api/v1/vendors/{id}/documents", admin({ title: "SOC 2 report", url: "https://drive.example.com/soc2" }), v("/documents"))).body as {
        id: string;
      }
    ).id;
    await call("POST", "/api/v1/vendors/{id}/documents", admin({ title: "x", url: "file:///etc/passwd" }), v("/documents"));
    await call("POST", "/api/v1/vendors/{id}/documents", admin({ title: "x", url: "https://x.example.com" }), "/api/v1/vendors/missing/documents");
    await call("POST", "/api/v1/vendors/{id}/documents", { method: "POST" }, v("/documents"));
    await call("DELETE", "/api/v1/vendors/{id}/documents/{docId}", admin(), v(`/documents/${docId}`));
    await call("DELETE", "/api/v1/vendors/{id}/documents/{docId}", admin(), v(`/documents/${docId}`));
    await call("DELETE", "/api/v1/vendors/{id}/documents/{docId}", { method: "DELETE" }, v("/documents/x"));
  });

  it("overview", async () => {
    await call("GET", "/api/v1/heatmap", admin());
    await call("GET", "/api/v1/heatmap", admin(), "/api/v1/heatmap?view=residual");
    await call("GET", "/api/v1/heatmap", admin(), "/api/v1/heatmap?view=future");
    await call("GET", "/api/v1/heatmap", {});
    await call("GET", "/api/v1/reviews", admin());
    await call("GET", "/api/v1/reviews", {});
    await call("GET", "/api/v1/summary", admin());
    await call("GET", "/api/v1/summary", {});
  });

  it("deletes", async () => {
    await call("DELETE", "/api/v1/vendors/{id}", admin(), v());
    await call("DELETE", "/api/v1/vendors/{id}", admin(), v());
    await call("DELETE", "/api/v1/vendors/{id}", { method: "DELETE" }, "/api/v1/vendors/x");
    await call("DELETE", "/api/v1/risks/{id}", admin(), r());
    await call("DELETE", "/api/v1/risks/{id}", admin(), r());
    await call("DELETE", "/api/v1/risks/{id}", { method: "DELETE" }, "/api/v1/risks/R-1");
    void none;
  });

  it("covers every operation in openapi.json", () => {
    const all = Object.entries(spec.paths).flatMap(([path, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${path}`));
    expect([...covered].sort()).toEqual(all.sort());
  });
});
