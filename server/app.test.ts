import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bandOf } from "./risk.ts";
import { startApp } from "./test-app.ts";

let app: Awaited<ReturnType<typeof startApp>>;
beforeAll(async () => {
  app = await startApp({ version: "0.1.0" });
});
afterAll(() => app.close());

const json = async (res: Response) => (await res.json()) as any;
const create = (body: Record<string, unknown>) =>
  app.send("POST", "/api/v1/risks", { title: "Customer data in a public bucket", category: "security", likelihood: 4, impact: 5, ...body });
const inDays = (d: number) => new Date(app.clock.now().getTime() + d * 86_400_000).toISOString();

describe("scoring", () => {
  it("bands likelihood times impact", () => {
    expect([1, 4, 5, 9, 10, 16, 17, 25].map(bandOf)).toEqual(["low", "low", "medium", "medium", "high", "high", "critical", "critical"]);
  });

  it("shows the score, the band and the residual score of a risk", async () => {
    const res = await create({ owner: "Ada", residualLikelihood: 2, residualImpact: 3, tags: ["Cloud", "cloud", "data"] });
    expect(res.status).toBe(201);
    expect(await json(res)).toMatchObject({
      key: "R-1",
      status: "identified",
      score: 20,
      band: "critical",
      owner: "Ada",
      tags: ["cloud", "data"],
      residual: { likelihood: 2, impact: 3, score: 6, band: "medium" },
      nextReview: "2027-01-20",
      overdue: false,
      acceptance: null,
    });
  });

  it("numbers risks one after another and finds them by key or id", async () => {
    const second = await json(await create({ title: "Laptops without disk encryption", category: "compliance", likelihood: 2, impact: 3 }));
    expect(second.key).toBe("R-2");
    expect((await json(await app.send("GET", "/api/v1/risks/R-2"))).id).toBe(second.id);
    expect((await json(await app.send("GET", `/api/v1/risks/${second.id}`))).key).toBe("R-2");
    expect((await app.send("GET", "/api/v1/risks/R-99")).status).toBe(404);
  });

  it("refuses what is outside the model", async () => {
    for (const bad of [
      { likelihood: 6 },
      { impact: 0 },
      { likelihood: 2.5 },
      { category: "weather" },
      { title: "x" },
      { residualLikelihood: 2 },
      { reviewIntervalDays: 3 },
      { extra: 1 },
      { tags: "cloud" },
      { treatment: "ignore" },
    ]) {
      expect((await create(bad)).status, JSON.stringify(bad)).toBe(422);
    }
  });
});

describe("history", () => {
  it("writes every change with who, when, what and from what", async () => {
    await app.send("PATCH", "/api/v1/risks/R-1", { likelihood: 3, owner: "Grace", status: "assessing" });
    const { history } = await json(await app.send("GET", "/api/v1/risks/R-1/history"));
    const byField = Object.fromEntries(history.map((h: any) => [h.field, h]));
    expect(byField.likelihood).toMatchObject({ who: "admin token", from: "4", to: "3", at: expect.any(String) });
    expect(byField.owner).toMatchObject({ from: "Ada", to: "Grace" });
    expect(byField.status).toMatchObject({ from: "identified", to: "assessing" });
    expect(byField.created).toMatchObject({ to: "R-1" });
    // A change that changes nothing writes nothing.
    await app.send("PATCH", "/api/v1/risks/R-1", { owner: "Grace" });
    expect((await json(await app.send("GET", "/api/v1/risks/R-1/history"))).history).toHaveLength(history.length);
  });

  it("cannot be edited, not even directly in the database", () => {
    expect(() => app.db.exec("UPDATE history SET who = 'mallory'")).toThrow(/cannot be changed/);
    expect(() => app.db.exec("DELETE FROM history")).toThrow(/cannot be deleted/);
  });

  it("recomputes the next review when the interval changes", async () => {
    const r = await json(await app.send("PATCH", "/api/v1/risks/R-2", { reviewIntervalDays: 30 }));
    expect(r).toMatchObject({ reviewIntervalDays: 30, nextReview: "2026-11-21" });
  });
});

describe("accepting a risk", () => {
  it("is not a status you can set, and needs a reason, an approver and an end", async () => {
    expect((await app.send("PATCH", "/api/v1/risks/R-2", { status: "accepted" })).status).toBe(422);
    const accept = (body: Record<string, unknown>) => app.send("POST", "/api/v1/risks/R-2/accept", body);
    expect((await accept({ approver: "CISO", expiresAt: inDays(30) })).status).toBe(422);
    expect((await accept({ reason: "Cost is above the loss", expiresAt: inDays(30) })).status).toBe(422);
    expect((await accept({ reason: "Cost is above the loss", approver: "CISO" })).status).toBe(422);
    expect((await accept({ reason: "Cost is above the loss", approver: "CISO", expiresAt: inDays(-1) })).status).toBe(422);
    expect((await accept({ reason: "Cost is above the loss", approver: "CISO", expiresAt: inDays(400) })).status).toBe(422);
    expect((await accept({ reason: "Cost is above the loss", approver: "CISO", expiresAt: inDays(30), extra: 1 })).status).toBe(422);
    const done = await json(await accept({ reason: "Cost is above the loss", approver: "CISO", expiresAt: inDays(30) }));
    expect(done).toMatchObject({ status: "accepted", treatment: "accept", acceptance: { reason: "Cost is above the loss", approver: "CISO", expired: false } });
    const fields = (await json(await app.send("GET", "/api/v1/risks/R-2/history"))).history.map((h: any) => h.field);
    expect(fields).toEqual(expect.arrayContaining(["status", "treatment", "acceptance"]));
  });

  it("comes back as review due when the acceptance runs out", async () => {
    expect((await json(await app.send("GET", "/api/v1/risks/R-2"))).status).toBe("accepted");
    app.clock.advance(31);
    const r = await json(await app.send("GET", "/api/v1/risks/R-2"));
    expect(r).toMatchObject({ status: "review-due", overdue: true, acceptance: { expired: true } });
    expect((await json(await app.send("GET", "/api/v1/risks?status=review-due"))).risks.map((x: any) => x.key)).toEqual(["R-2"]);
    expect((await json(await app.send("GET", "/api/v1/summary"))).risks).toMatchObject({ reviewDue: 1, accepted: 0 });
    // A review does not renew it: somebody accepts it again, or changes its status.
    expect((await app.send("POST", "/api/v1/risks/R-2/review")).status).toBe(409);
    const again = await json(await app.send("POST", "/api/v1/risks/R-2/accept", { reason: "Still the same", approver: "CISO", expiresAt: inDays(60) }));
    expect(again).toMatchObject({ status: "accepted", acceptance: { expired: false } });
    const left = await json(await app.send("PATCH", "/api/v1/risks/R-2", { status: "treating" }));
    expect(left).toMatchObject({ status: "treating", acceptance: null });
  });
});

describe("overdue reviews, with the clock moved", () => {
  it("flags a risk when its review date has come, and clears it when it is reviewed", async () => {
    const before = await json(await app.send("GET", "/api/v1/risks?overdue=true"));
    app.clock.advance(100);
    const after = await json(await app.send("GET", "/api/v1/risks?overdue=true"));
    expect(after.risks.length).toBeGreaterThan(before.risks.length);
    const reviews = await json(await app.send("GET", "/api/v1/reviews"));
    expect(reviews.risks.map((r: any) => r.key)).toEqual(expect.arrayContaining(["R-1", "R-2"]));
    const done = await json(await app.send("POST", "/api/v1/risks/R-1/review"));
    const today = app.clock.now().toISOString().slice(0, 10);
    expect(done).toMatchObject({ overdue: false, lastReview: today });
    expect(done.nextReview > today).toBe(true);
    expect((await json(await app.send("GET", "/api/v1/reviews"))).risks.map((r: any) => r.key)).not.toContain("R-1");
  });

  it("does not count a closed risk, and a closed risk is not reviewed or accepted", async () => {
    await app.send("PATCH", "/api/v1/risks/R-2", { status: "closed" });
    expect((await json(await app.send("GET", "/api/v1/reviews"))).risks.map((r: any) => r.key)).not.toContain("R-2");
    expect((await app.send("POST", "/api/v1/risks/R-2/review")).status).toBe(409);
    expect((await app.send("POST", "/api/v1/risks/R-2/accept", { reason: "no", approver: "CISO", expiresAt: inDays(10) })).status).toBe(409);
    expect((await json(await app.send("GET", "/api/v1/risks/R-2"))).closedAt).toEqual(expect.any(String));
    expect((await json(await app.send("PATCH", "/api/v1/risks/R-2", { status: "identified" }))).closedAt).toBeNull();
  });
});

describe("links and other products", () => {
  it("links controls, findings and incidents by reference, and removes them", async () => {
    const link = await json(
      await app.send("POST", "/api/v1/risks/R-1/links", {
        kind: "finding",
        product: "dast",
        reference: "shop-staging/40018",
        url: "https://dast.example.com/targets/1",
      }),
    );
    expect(link).toMatchObject({ kind: "finding", product: "dast", reference: "shop-staging/40018" });
    expect((await app.send("POST", "/api/v1/risks/R-1/links", { kind: "finding", product: "dast", reference: "shop-staging/40018" })).status).toBe(409);
    expect((await app.send("POST", "/api/v1/risks/R-1/links", { kind: "magic", reference: "x" })).status).toBe(422);
    expect((await app.send("POST", "/api/v1/risks/R-1/links", { kind: "other", reference: "x", url: "ftp://x" })).status).toBe(422);
    expect((await app.send("POST", "/api/v1/risks/R-1/links", { kind: "other", reference: "x", url: "https://u:p@x.example.com" })).status).toBe(422);
    expect((await json(await app.send("GET", "/api/v1/risks/R-1"))).links).toHaveLength(1);
    expect((await app.send("DELETE", `/api/v1/risks/R-1/links/${link.id}`)).status).toBe(204);
    expect((await app.send("DELETE", `/api/v1/risks/R-1/links/${link.id}`)).status).toBe(404);
    const fields = (await json(await app.send("GET", "/api/v1/risks/R-1/history"))).history.map((h: any) => h.field);
    expect(fields).toEqual(expect.arrayContaining(["link added", "link removed"]));
  });

  it("opens one risk for the same finding, and notes it when it is seen again", async () => {
    const body = {
      title: "Reflected XSS on /profile",
      category: "security",
      likelihood: 3,
      impact: 3,
      external: { source: "dast", reference: "shop-staging/40012" },
      links: [{ kind: "finding", product: "dast", reference: "shop-staging/40012" }],
    };
    const first = await app.send("POST", "/api/v1/risks", body);
    expect(first.status).toBe(201);
    const key = (await json(first)).key;
    const second = await app.send("POST", "/api/v1/risks", body);
    expect(second.status).toBe(200);
    expect((await json(second)).key).toBe(key);
    expect((await json(await app.send("GET", "/api/v1/risks?q=xss"))).risks).toHaveLength(1);
    const history = (await json(await app.send("GET", `/api/v1/risks/${key}/history`))).history;
    expect(history.map((h: any) => h.field)).toContain("seen again");
    expect((await app.send("POST", "/api/v1/risks", { ...body, external: { source: "Bad Source", reference: "x" } })).status).toBe(422);
  });

  it("creates nothing when a link in the request is wrong", async () => {
    const count = (await json(await app.send("GET", "/api/v1/summary"))).risks.open;
    expect((await create({ title: "Half made", links: [{ kind: "nope", reference: "x" }] })).status).toBe(422);
    expect((await json(await app.send("GET", "/api/v1/summary"))).risks.open).toBe(count);
  });
});

describe("vendors", () => {
  it("keeps a vendor with its data, review dates and linked risks", async () => {
    const res = await app.send("POST", "/api/v1/vendors", {
      name: "Acme Payments",
      service: "Card processing",
      dataClasses: ["financial", "personal"],
      criticality: "critical",
      contact: "sec@acme.example",
      risks: ["R-1"],
    });
    expect(res.status).toBe(201);
    const v = await json(res);
    expect(v).toMatchObject({
      name: "Acme Payments",
      status: "onboarding",
      questionnaire: "not-sent",
      rating: null,
      reviewIntervalDays: 365,
      overdue: false,
      risks: [{ key: "R-1", band: "high" }],
    });
    expect((await app.send("POST", "/api/v1/vendors", { name: "Acme Payments", criticality: "low" })).status).toBe(409);
    for (const bad of [{ criticality: "huge" }, { dataClasses: ["gossip"] }, { status: "gone" }, { risks: ["R-404"] }, { name: "A" }, { extra: 1 }]) {
      expect((await app.send("POST", "/api/v1/vendors", { name: "Other", criticality: "low", ...bad })).status, JSON.stringify(bad)).toBe(422);
    }
    const patched = await json(
      await app.send("PATCH", `/api/v1/vendors/${v.id}`, { status: "active", questionnaire: "reviewed", rating: "medium", risks: [] }),
    );
    expect(patched).toMatchObject({ status: "active", questionnaire: "reviewed", rating: "medium", risks: [] });
    const fields = (await json(await app.send("GET", `/api/v1/vendors/${v.id}/history`))).history.map((h: any) => h.field);
    expect(fields).toEqual(expect.arrayContaining(["status", "questionnaire", "rating", "risks", "created"]));
  });

  it("is overdue when its review date comes, and not once it is offboarding", async () => {
    const [v] = (await json(await app.send("GET", "/api/v1/vendors"))).vendors;
    expect((await json(await app.send("GET", "/api/v1/vendors?overdue=true"))).vendors).toHaveLength(0);
    app.clock.advance(400);
    expect((await json(await app.send("GET", "/api/v1/vendors?overdue=true"))).vendors.map((x: any) => x.name)).toEqual(["Acme Payments"]);
    expect((await json(await app.send("GET", "/api/v1/reviews"))).vendors).toHaveLength(1);
    const reviewed = await json(await app.send("POST", `/api/v1/vendors/${v.id}/review`));
    expect(reviewed).toMatchObject({ overdue: false });
    app.clock.advance(400);
    await app.send("PATCH", `/api/v1/vendors/${v.id}`, { status: "offboarding" });
    expect((await json(await app.send("GET", "/api/v1/vendors?overdue=true"))).vendors).toHaveLength(0);
  });

  it("holds documents as links only", async () => {
    const [v] = (await json(await app.send("GET", "/api/v1/vendors"))).vendors;
    const doc = await json(await app.send("POST", `/api/v1/vendors/${v.id}/documents`, { title: "SOC 2 report 2026", url: "https://drive.example.com/soc2" }));
    expect(doc).toMatchObject({ title: "SOC 2 report 2026" });
    expect((await app.send("POST", `/api/v1/vendors/${v.id}/documents`, { title: "x", url: "file:///etc/passwd" })).status).toBe(422);
    expect((await json(await app.send("GET", `/api/v1/vendors/${v.id}`))).documents).toHaveLength(1);
    expect((await app.send("DELETE", `/api/v1/vendors/${v.id}/documents/${doc.id}`)).status).toBe(204);
    expect((await app.send("DELETE", `/api/v1/vendors/${v.id}/documents/${doc.id}`)).status).toBe(404);
  });
});

describe("views", () => {
  it("counts risks on a heat map, inherent and residual", async () => {
    const map = await json(await app.send("GET", "/api/v1/heatmap"));
    expect(map.cells).toHaveLength(25);
    expect(map.cells[0]).toMatchObject({ likelihood: 5, impact: 1 });
    const cell = map.cells.find((c: any) => c.likelihood === 3 && c.impact === 5);
    expect(cell).toMatchObject({ score: 15, band: "high", count: 1, keys: ["R-1"] });
    const residual = await json(await app.send("GET", "/api/v1/heatmap?view=residual"));
    expect(residual.cells.find((c: any) => c.likelihood === 2 && c.impact === 3).keys).toContain("R-1");
    expect((await app.send("GET", "/api/v1/heatmap?view=future")).status).toBe(422);
  });

  it("summarizes by band, owner and category, and filters the register", async () => {
    const s = await json(await app.send("GET", "/api/v1/summary"));
    expect(s.risks.open).toBe(s.risks.byBand.low + s.risks.byBand.medium + s.risks.byBand.high + s.risks.byBand.critical);
    expect(s.byOwner).toEqual(expect.arrayContaining([{ owner: "Grace", count: 1 }]));
    expect(s.byCategory.find((c: any) => c.category === "security").count).toBeGreaterThan(0);
    expect(s.vendors).toMatchObject({ total: 1 });
    const top = await json(await app.send("GET", "/api/v1/risks?band=high,critical&limit=1"));
    expect(top.risks[0].score).toBeGreaterThanOrEqual(10);
    expect((await json(await app.send("GET", "/api/v1/risks?owner=Grace"))).risks.map((r: any) => r.key)).toEqual(["R-1"]);
    expect((await json(await app.send("GET", "/api/v1/risks?category=compliance"))).risks.map((r: any) => r.key)).toEqual(["R-2"]);
    for (const q of ["status=gone", "band=urgent", "category=weather", "overdue=maybe", "limit=0", "cursor=junk"])
      expect((await app.send("GET", `/api/v1/risks?${q}`)).status, q).toBe(422);
  });

  it("pages the register", async () => {
    const page = await json(await app.send("GET", "/api/v1/risks?limit=1"));
    expect(page.risks).toHaveLength(1);
    expect(page.nextCursor).toBeDefined();
    expect((await json(await app.send("GET", `/api/v1/risks?limit=1&cursor=${page.nextCursor}`))).risks).toHaveLength(1);
  });
});

describe("deleting and access", () => {
  it("deletes a risk with its links and history, and lets a vendor outlive it", async () => {
    const id = (await json(await app.send("GET", "/api/v1/risks/R-1"))).id;
    expect((await app.send("DELETE", "/api/v1/risks/R-1")).status).toBe(204);
    expect((await app.send("GET", "/api/v1/risks/R-1")).status).toBe(404);
    expect(app.db.prepare("SELECT COUNT(*) AS n FROM history WHERE subject_id = ?").get(id)).toEqual({ n: 0 });
    expect(app.db.prepare("SELECT COUNT(*) AS n FROM risk_links WHERE risk_id = ?").get(id)).toEqual({ n: 0 });
    const [v] = (await json(await app.send("GET", "/api/v1/vendors"))).vendors;
    expect((await app.send("DELETE", `/api/v1/vendors/${v.id}`)).status).toBe(204);
    expect((await app.send("DELETE", `/api/v1/vendors/${v.id}`)).status).toBe(404);
  });

  it("asks for a sign-in, and answers version, health and metrics", async () => {
    for (const [m, p] of [
      ["GET", "/api/v1/risks"],
      ["POST", "/api/v1/risks"],
      ["GET", "/api/v1/vendors"],
      ["POST", "/api/v1/risks/R-1/accept"],
      ["DELETE", "/api/v1/risks/R-1"],
      ["GET", "/api/v1/heatmap"],
    ] as const) {
      expect((await fetch(app.base + p, { method: m })).status, `${m} ${p}`).toBe(401);
    }
    expect(await json(await fetch(`${app.base}/api/v1/version`))).toEqual({ product: "risk", version: "0.1.0" });
    expect((await fetch(`${app.base}/healthz`)).status).toBe(200);
    const metrics = await (await fetch(`${app.base}/metrics`)).text();
    expect(metrics).toContain('openasy_build_info{product="risk",version="0.1.0"} 1');
    expect(metrics).toContain('openasy_risk_open_risks{band="high"}');
  });
});
