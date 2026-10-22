// Prometheus text exposition, written by hand: a few lines, no client library needed.
const requests = new Map<string, number>();

export function countRequest(method: string, route: string, status: number) {
  const key = `method="${method}",route="${route}",status="${status}"`;
  requests.set(key, (requests.get(key) ?? 0) + 1);
}

export interface Gauges {
  /** Risks that are not closed, by band. */
  open: Record<string, number>;
  overdue: number;
  reviewDue: number;
  accepted: number;
  vendors: number;
  vendorsOverdue: number;
}

export function renderMetrics(version: string, g: Gauges): string {
  const lines = [
    "# HELP openasy_build_info Build information.",
    "# TYPE openasy_build_info gauge",
    `openasy_build_info{product="risk",version="${version}"} 1`,
    "# HELP openasy_http_requests_total HTTP requests handled.",
    "# TYPE openasy_http_requests_total counter",
    ...[...requests].map(([labels, n]) => `openasy_http_requests_total{${labels}} ${n}`),
    "# HELP openasy_risk_open_risks Risks that are not closed, by band.",
    "# TYPE openasy_risk_open_risks gauge",
    ...Object.entries(g.open).map(([b, n]) => `openasy_risk_open_risks{band="${b}"} ${n}`),
    "# HELP openasy_risk_overdue_reviews Risks whose review date or acceptance has passed.",
    "# TYPE openasy_risk_overdue_reviews gauge",
    `openasy_risk_overdue_reviews ${g.overdue}`,
    "# HELP openasy_risk_review_due Accepted risks whose acceptance has run out.",
    "# TYPE openasy_risk_review_due gauge",
    `openasy_risk_review_due ${g.reviewDue}`,
    "# HELP openasy_risk_accepted Risks with a running acceptance.",
    "# TYPE openasy_risk_accepted gauge",
    `openasy_risk_accepted ${g.accepted}`,
    "# HELP openasy_risk_vendors Vendors on the register.",
    "# TYPE openasy_risk_vendors gauge",
    `openasy_risk_vendors ${g.vendors}`,
    "# HELP openasy_risk_vendor_reviews_overdue Vendors whose review date has passed.",
    "# TYPE openasy_risk_vendor_reviews_overdue gauge",
    `openasy_risk_vendor_reviews_overdue ${g.vendorsOverdue}`,
    "# HELP process_uptime_seconds Seconds since the process started.",
    "# TYPE process_uptime_seconds gauge",
    `process_uptime_seconds ${process.uptime().toFixed(0)}`,
  ];
  return lines.join("\n") + "\n";
}
