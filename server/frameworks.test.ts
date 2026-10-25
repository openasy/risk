import { describe, expect, it } from "vitest";
import { openDb } from "./db.ts";
import { controlOf, FRAMEWORKS } from "./frameworks.ts";
import { createRisk } from "./risk.ts";

describe("the control catalog", () => {
  it("has the 93 controls of ISO 27001:2022 Annex A, in its four themes, and SOC 2's criteria", () => {
    const iso = FRAMEWORKS.find((f) => f.id === "iso27001-2022")!;
    expect(iso.controls).toHaveLength(93);
    const themes = Object.groupBy(iso.controls, (c) => c.group);
    expect(Object.fromEntries(Object.entries(themes).map(([k, v]) => [k, v!.length]))).toEqual({
      Organizational: 37,
      People: 8,
      Physical: 14,
      Technological: 34,
    });
    const soc2 = FRAMEWORKS.find((f) => f.id === "soc2-2017")!;
    expect(soc2.controls.filter((c) => c.id.startsWith("CC"))).toHaveLength(33);
    for (const f of FRAMEWORKS) expect(new Set(f.controls.map((c) => c.id)).size).toBe(f.controls.length);
    expect(controlOf("iso27001-2022", "8.8")?.control.title).toBe("Management of technical vulnerabilities");
    expect(controlOf("iso27001-2022", "A.8.8")).toBeUndefined();
  });

  it("names only products that exist", () => {
    const products = new Set([
      "identity",
      "vpn",
      "infrastructure",
      "vulnerabilities",
      "logs",
      "siem",
      "audit",
      "sast",
      "dast",
      "malware",
      "posture",
      "secrets",
      "incidents",
      "errors",
      "supply-chain",
      "certificates",
      "uptime",
      "backups",
      "risk",
      "threat-intel",
      "cost",
    ]);
    for (const f of FRAMEWORKS) for (const c of f.controls) for (const p of c.products ?? []) expect(products, `${f.id} ${c.id}`).toContain(p);
  });
});

describe("controls that treat a risk", () => {
  const setup = () => {
    const risk = createRisk(openDb(":memory:"));
    const make = (title: string) => risk.createRisk({ title, category: "security", likelihood: 4, impact: 4 }, "Ada").risk;
    return { risk, make };
  };

  it("sets them, writes each change to the history, and finds risks by control", () => {
    const { risk, make } = setup();
    const a = make("Stolen laptop");
    const b = make("Unpatched servers");
    risk.setControls(
      a.key,
      {
        controls: [
          { framework: "iso27001-2022", id: "8.1" },
          { framework: "soc2-2017", id: "CC6.1" },
        ],
      },
      "Ada",
    );
    risk.setControls(b.key, { controls: [{ framework: "iso27001-2022", id: "8.8" }] }, "Ada");
    expect(risk.risk(a.key)).toMatchObject({
      controlCount: 2,
      controls: [
        { framework: "iso27001-2022", id: "8.1", title: "User endpoint devices" },
        { framework: "soc2-2017", id: "CC6.1", title: "Logical access security over protected assets" },
      ],
    });
    // The same list again changes nothing; a shorter one removes what is left out.
    risk.setControls(
      a.key,
      {
        controls: [
          { framework: "soc2-2017", id: "CC6.1" },
          { framework: "iso27001-2022", id: "8.1" },
        ],
      },
      "Ada",
    );
    risk.setControls(a.key, { controls: [{ framework: "iso27001-2022", id: "8.1" }] }, "Grace");
    const lines = risk.riskHistory(a.key).filter((h) => h.field.startsWith("control"));
    expect(lines.map((h) => [h.who, h.field, h.from, h.to])).toEqual([
      ["Grace", "control removed", "SOC 2 CC6.1", null],
      ["Ada", "control added", null, "SOC 2 CC6.1"],
      ["Ada", "control added", null, "ISO 27001 8.1"],
    ]);
    expect(risk.listRisks({ control: "iso27001-2022:8.8" }, undefined, 10).items.map((r) => r.key)).toEqual([b.key]);
    expect(() => risk.listRisks({ control: "iso27001-2022:9.9" }, undefined, 10)).toThrow(/framework:id/);
  });

  it("refuses a control that is not in the catalog", () => {
    const { risk, make } = setup();
    const a = make("Shared admin password");
    expect(() => risk.setControls(a.key, { controls: [{ framework: "iso27001-2013", id: "A.9.1.1" }] }, "Ada")).toThrow(/GET \/api\/v1\/frameworks/);
    expect(() => risk.setControls(a.key, { controls: "8.1" }, "Ada")).toThrow(/at most 100/);
  });

  it("shows each control with the open risks it treats, and how many cover any", () => {
    const { risk, make } = setup();
    const a = make("Stolen laptop");
    const closed = make("Old office");
    risk.setControls(a.key, { controls: [{ framework: "iso27001-2022", id: "8.1" }] }, "Ada");
    risk.setControls(closed.key, { controls: [{ framework: "iso27001-2022", id: "7.1" }] }, "Ada");
    risk.updateRisk(closed.key, { status: "closed" }, "Ada");
    const f = risk.framework("iso27001-2022");
    expect(f.covered).toBe(1);
    expect(f.controls.find((c) => c.id === "8.1")).toMatchObject({ group: "Technological", risks: [{ key: a.key, band: "high", status: "identified" }] });
    expect(f.controls.find((c) => c.id === "7.1")!.risks).toEqual([]);
    expect(f.controls.find((c) => c.id === "8.8")!.products).toContain("vulnerabilities");
    expect(() => risk.framework("nist-csf")).toThrow(/does not exist/);
    expect(risk.frameworks()).toEqual([
      { id: "iso27001-2022", name: "ISO/IEC 27001:2022 Annex A", short: "ISO 27001", controls: 93 },
      { id: "soc2-2017", name: "SOC 2 Trust Services Criteria (2017, revised 2022)", short: "SOC 2", controls: expect.any(Number) },
    ]);
  });
});
