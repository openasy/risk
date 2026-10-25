// What the search window (Cmd+K) finds in Risk: risks and vendors by key, title, name or text, from the API.
import type { SearchFn, SearchResult } from "@openasy/ui";
import { Building2, TriangleAlert } from "lucide-react";
import type { Risk, Vendor } from "./api.ts";
import type { T } from "./i18n.ts";

type Call = <R>(path: string, init?: RequestInit) => Promise<R>;
const query = (q: string) => new URLSearchParams({ q, limit: "8" });

export function search(call: Call, t: T): SearchFn {
  return async (q, signal) => {
    const [risks, vendors] = await Promise.all([
      call<{ risks: Risk[] }>(`/api/v1/risks?${query(q)}`, { signal }),
      call<{ vendors: Vendor[] }>(`/api/v1/vendors?${query(q)}`, { signal }),
    ]);
    return [
      ...risks.risks.map((r): SearchResult => ({
        id: `risk:${r.id}`,
        label: `${r.key} ${r.title}`,
        detail: t("search.riskDetail", { owner: r.owner ?? t("search.noOwner"), status: r.status }),
        kind: t("search.risk"),
        icon: TriangleAlert,
        severity: r.band,
        href: `/risks/${encodeURIComponent(r.id)}`,
      })),
      ...vendors.vendors.map((v): SearchResult => ({
        id: `vendor:${v.id}`,
        label: v.name,
        detail: v.service,
        kind: t("search.vendor"),
        icon: Building2,
        severity: v.criticality,
        href: `/vendors/${encodeURIComponent(v.id)}`,
      })),
    ];
  };
}
