import {
  AppShell,
  Badge,
  BrandProvider,
  Button,
  Callout,
  Checkbox,
  DataTable,
  Dialog,
  EmptyState,
  FacetFilter,
  FilterBar,
  IconButton,
  KpiCard,
  KpiGrid,
  navigate,
  PageHeader,
  Panel,
  PRODUCT_IDS,
  SearchInput,
  SegmentedControl,
  SelectField,
  SeverityBadge,
  StatusBadge,
  Tabs,
  TextField,
  usePath,
  type Column,
  type ProductId,
  useThemePreference,
} from "@openasy/ui";
import { AccountSettings, AuthGate, MembersSettings, SignInSettings, TokensSettings, useAuth } from "@openasy/auth/react";
import { Building2, ClipboardCheck, Grid3x3, KeyRound, LogIn, LogOut, Plus, Settings2, Trash2, UserRound, Users, X } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  api,
  MfaSetupRequired,
  Unauthorized,
  type Band,
  type Category,
  type HeatCell,
  type HistoryEntry,
  type LinkKind,
  type ProductLink,
  type Risk,
  type Summary,
  type Treatment,
  type Vendor,
} from "./api.ts";

function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
const day = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString() : "–");

const PAGES = ["heatmap", "setup", "account", "members", "signin", "tokens"] as const;
type Route = { page: "risks" | "vendors" | (typeof PAGES)[number] } | { page: "risk" | "vendor"; id: string };
/** The first path segments that are pages of this UI, for followLinks. */
export const PATHS = ["risks", "vendors", ...PAGES];
function parseRoute(path: string): Route {
  const [page, id] = path.replace(/^\//, "").split("/");
  if (page === "risks" && id) return { page: "risk", id: decodeURIComponent(id) };
  if (page === "vendors" && id) return { page: "vendor", id: decodeURIComponent(id) };
  if (page === "vendors") return { page: "vendors" };
  if ((PAGES as readonly string[]).includes(page ?? "")) return { page: page as (typeof PAGES)[number] };
  return { page: "risks" };
}

/** Data loading with the session; when it ends, the sign-in screen comes back. */
function useApi() {
  const { expired, refresh } = useAuth();
  return useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      try {
        return await api<T>(path, init);
      } catch (err) {
        if (err instanceof Unauthorized) expired();
        if (err instanceof MfaSetupRequired) void refresh();
        throw err;
      }
    },
    [expired, refresh],
  );
}
type Call = ReturnType<typeof useApi>;

const BANDS: Band[] = ["critical", "high", "medium", "low"];
const CATEGORIES: Category[] = ["strategic", "operational", "security", "compliance", "vendor", "other"];
const TREATMENTS: Treatment[] = ["mitigate", "transfer", "accept", "avoid"];
const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, " ");
const options = (list: readonly string[]) => list.map((v) => ({ value: v, label: label(v) }));
const scale = ["1", "2", "3", "4", "5"].map((v) => ({ value: v, label: v }));

function BandBadge({ band, score }: { band: Band; score?: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <SeverityBadge severity={band} />
      {score !== undefined && <span className="font-mono text-xs text-fg-muted">{score}</span>}
    </span>
  );
}

function StatusPill({ risk }: { risk: Pick<Risk, "status" | "overdue"> }) {
  const tone = risk.status === "closed" ? "neutral" : risk.status === "review-due" ? "danger" : risk.status === "accepted" ? "info" : risk.status === "treating" ? "warning" : "neutral";
  return <StatusBadge tone={tone}>{label(risk.status)}</StatusBadge>;
}

function Due({ date, overdue }: { date: string; overdue: boolean }) {
  return overdue ? <Badge tone="danger">Overdue, {day(date)}</Badge> : <span className="text-xs whitespace-nowrap">{day(date)}</span>;
}

function Code({ children }: { children: ReactNode }) {
  return <pre className="m-0 overflow-x-auto rounded-md bg-subtle px-2.5 py-2 font-mono text-xs text-fg">{children}</pre>;
}

// ---------------------------------------------------------------- Register

function NewRiskDialog({ open, onClose, call, onCreated }: { open: boolean; onClose: () => void; call: Call; onCreated: (key: string) => void }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("security");
  const [likelihood, setLikelihood] = useState("3");
  const [impact, setImpact] = useState("3");
  const [owner, setOwner] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string>();
  const close = () => (setTitle(""), setOwner(""), setDescription(""), setError(undefined), onClose());

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await call<Risk>("/api/v1/risks", {
        method: "POST",
        body: JSON.stringify({ title, category, likelihood: Number(likelihood), impact: Number(impact), description, ...(owner.trim() && { owner: owner.trim() }) }),
      });
      close();
      onCreated(r.key);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title="Add a risk"
      description="Say what could go wrong, how likely it is and how much it would hurt. The score follows."
      onSubmit={submit}
      footer={
        <>
          <Button type="button" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={title.trim().length < 3}>
            Add risk
          </Button>
        </>
      }
    >
      <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} hint="What could go wrong." error={error} />
      <div className="grid grid-cols-3 gap-2">
        <SelectField label="Category" value={category} onChange={(e) => setCategory(e.target.value as Category)} options={options(CATEGORIES)} />
        <SelectField label="Likelihood" value={likelihood} onChange={(e) => setLikelihood(e.target.value)} options={scale} />
        <SelectField label="Impact" value={impact} onChange={(e) => setImpact(e.target.value)} options={scale} />
      </div>
      <TextField label="Owner" value={owner} onChange={(e) => setOwner(e.target.value)} hint="Who answers for it. Optional." />
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Description</span>
        <textarea className="risk-textarea w-full rounded-md border border-line-strong bg-surface px-2.5 py-2 text-sm text-fg" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
    </Dialog>
  );
}

type View = "active" | "review-due" | "closed" | "all";

function RegisterPage({ call, summary, reload }: { call: Call; summary?: Summary; reload: () => void }) {
  const { can } = useAuth();
  const [view, setView] = useState<View>("active");
  const [bands, setBands] = useState<string[]>([]);
  const [category, setCategory] = useState("all");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Risk[]>();
  const [more, setMore] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [reviews, setReviews] = useState<{ risks: Risk[]; vendors: Vendor[] }>();

  const query = useCallback(
    (cursor?: string) => {
      const p = new URLSearchParams({ limit: "200" });
      if (view !== "all") p.set("status", view);
      if (bands.length) p.set("band", bands.join(","));
      if (category !== "all") p.set("category", category);
      if (q.trim()) p.set("q", q.trim());
      if (cursor) p.set("cursor", cursor);
      return call<{ risks: Risk[]; nextCursor?: string }>(`/api/v1/risks?${p}`);
    },
    [call, view, bands, category, q],
  );
  const load = useCallback(() => {
    query().then((r) => (setRows(r.risks), setMore(r.nextCursor)), () => setRows([]));
    void call<{ risks: Risk[]; vendors: Vendor[] }>("/api/v1/reviews").then(setReviews, () => {});
  }, [query, call]);
  useEffect(load, [load]);
  const loadMore = () => more && query(more).then((r) => (setRows((x) => [...(x ?? []), ...r.risks]), setMore(r.nextCursor)));

  const columns: Column<Risk>[] = [
    { id: "key", header: "Risk", width: "76px", sortValue: (r) => r.number, cell: (r) => <span className="font-mono text-xs">{r.key}</span> },
    {
      id: "title",
      header: "Title",
      width: "34%",
      sortValue: (r) => r.title,
      cell: (r) => (
        <span className="flex min-w-0 flex-col">
          <a href={`/risks/${r.key}`} className="risk-wrap font-medium">
            {r.title}
          </a>
          <span className="text-xs text-fg-muted">{label(r.category)}</span>
        </span>
      ),
    },
    { id: "band", header: "Score", width: "130px", sortValue: (r) => r.score, cell: (r) => <BandBadge band={r.band} score={r.score} /> },
    { id: "residual", header: "Residual", width: "130px", cell: (r) => (r.residual ? <BandBadge band={r.residual.band} score={r.residual.score} /> : <span className="text-xs text-fg-muted">–</span>) },
    { id: "status", header: "Status", cell: (r) => <StatusPill risk={r} /> },
    { id: "owner", header: "Owner", sortValue: (r) => r.owner ?? "", cell: (r) => <span className="text-xs">{r.owner ?? "–"}</span> },
    { id: "review", header: "Next review", sortValue: (r) => r.nextReview, cell: (r) => (r.status === "closed" ? "–" : <Due date={r.nextReview} overdue={r.overdue} />) },
  ];
  const s = summary;
  const due = reviews ? reviews.risks.length + reviews.vendors.length : 0;
  return (
    <>
      <PageHeader
        title="Risk register"
        description={s ? `${plural(s.risks.open, "open risk")} · ${plural(s.vendors.total, "vendor")}` : undefined}
        actions={
          <>
            <SearchInput label="Search risks" className="w-56" value={q} onChange={(e) => setQ(e.target.value)} />
            {can("editor") && (
              <Button variant="primary" icon={<Plus />} onClick={() => setAdding(true)}>
                Add risk
              </Button>
            )}
          </>
        }
      />
      {s && (
        <KpiGrid minWidth={150}>
          <KpiCard label="Critical" value={s.risks.byBand.critical} footer={<SeverityBadge severity="critical" />} />
          <KpiCard label="High" value={s.risks.byBand.high} footer={<SeverityBadge severity="high" />} />
          <KpiCard label="Medium" value={s.risks.byBand.medium} footer={<SeverityBadge severity="medium" />} />
          <KpiCard label="Low" value={s.risks.byBand.low} footer={<SeverityBadge severity="low" />} />
          <KpiCard label="Reviews overdue" value={s.risks.overdue + s.vendors.overdue} tone={s.risks.overdue + s.vendors.overdue ? "warning" : "success"} />
          <KpiCard label="Accepted" value={s.risks.accepted} tone="info" />
        </KpiGrid>
      )}
      {due > 0 && reviews && (
        <Panel title={`${plural(due, "review")} overdue`} description="Review the risk or vendor, or change its status.">
          <ul className="risk-list flex flex-col gap-1 text-sm">
            {reviews.risks.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2">
                <a href={`/risks/${r.key}`} className="font-medium">
                  {r.key} {r.title}
                </a>
                <StatusPill risk={r} />
                <span className="text-xs text-fg-muted">{r.status === "review-due" ? "acceptance ran out" : `due ${day(r.nextReview)}`}</span>
              </li>
            ))}
            {reviews.vendors.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2">
                <a href={`/vendors/${v.id}`} className="font-medium">
                  {v.name}
                </a>
                <Badge>Vendor</Badge>
                <span className="text-xs text-fg-muted">due {day(v.nextReview)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <Tabs<View>
        label="Register views"
        value={view}
        onChange={setView}
        items={[
          { value: "active", label: "Open" },
          { value: "review-due", label: "Review due" },
          { value: "closed", label: "Closed" },
          { value: "all", label: "All" },
        ]}
      />
      <FilterBar onClear={() => (setBands([]), setCategory("all"), setQ(""))}>
        <FacetFilter label="Band" selected={bands} onChange={setBands} options={BANDS.map((b) => ({ value: b, label: label(b), count: view === "active" ? s?.risks.byBand[b] : undefined }))} />
        <SelectField label="Category" value={category} onChange={(e) => setCategory(e.target.value)} options={[{ value: "all", label: "Every category" }, ...options(CATEGORIES)]} />
      </FilterBar>
      <Panel
        title="Highest score first"
        flush
        footer={
          more ? (
            <Button size="sm" onClick={loadMore}>
              Load more
            </Button>
          ) : undefined
        }
      >
        <DataTable
          label="Risks"
          columns={columns}
          rows={rows ?? []}
          loading={!rows}
          getRowId={(r) => r.id}
          minWidth={900}
          pageSize={50}
          empty={<EmptyState title="No risks here">{view === "active" && s && s.risks.open === 0 ? "Add the first risk, or let another product open one from a finding." : "Nothing matches these filters."}</EmptyState>}
        />
      </Panel>
      <NewRiskDialog open={adding} onClose={() => setAdding(false)} call={call} onCreated={(key) => (reload(), navigate(`/risks/${key}`))} />
    </>
  );
}

function TextArea({ label: name, value, onChange, hint, rows = 3 }: { label: string; value: string; onChange: (v: string) => void; hint?: string; rows?: number }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{name}</span>
      <textarea className="risk-textarea w-full rounded-md border border-line-strong bg-surface px-2.5 py-2 text-sm text-fg" rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="text-xs text-fg-muted">{hint}</span>}
    </label>
  );
}

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

// ---------------------------------------------------------------- One risk

function EditRiskDialog({ risk, call, onClose, onSaved }: { risk: Risk; call: Call; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(risk.title);
  const [description, setDescription] = useState(risk.description);
  const [category, setCategory] = useState<Category>(risk.category);
  const [likelihood, setLikelihood] = useState(String(risk.likelihood));
  const [impact, setImpact] = useState(String(risk.impact));
  const [rl, setRl] = useState(risk.residual ? String(risk.residual.likelihood) : "");
  const [ri, setRi] = useState(risk.residual ? String(risk.residual.impact) : "");
  const [owner, setOwner] = useState(risk.owner ?? "");
  const [status, setStatus] = useState<string>(risk.status === "accepted" || risk.status === "review-due" ? "" : risk.status);
  const [treatment, setTreatment] = useState<string>(risk.treatment ?? "");
  const [plan, setPlan] = useState(risk.plan);
  const [interval, setIntervalDays] = useState(String(risk.reviewIntervalDays));
  const [tags, setTags] = useState(risk.tags.join(", "));
  const [error, setError] = useState<string>();
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      title,
      description,
      category,
      likelihood: Number(likelihood),
      impact: Number(impact),
      residualLikelihood: rl && ri ? Number(rl) : null,
      residualImpact: rl && ri ? Number(ri) : null,
      owner: owner.trim() || null,
      treatment: treatment || null,
      plan,
      reviewIntervalDays: Number(interval),
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      ...(status && { status }),
    };
    try {
      await call(`/api/v1/risks/${risk.key}`, { method: "PATCH", body: JSON.stringify(body) });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Change ${risk.key}`}
      description="Every change is kept in the history, with who made it."
      onSubmit={save}
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={title.trim().length < 3}>
            Save
          </Button>
        </>
      }
    >
      <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <TextArea label="Description" value={description} onChange={setDescription} />
      <div className="grid grid-cols-3 gap-2">
        <SelectField label="Category" value={category} onChange={(e) => setCategory(e.target.value as Category)} options={options(CATEGORIES)} />
        <SelectField label="Likelihood" value={likelihood} onChange={(e) => setLikelihood(e.target.value)} options={scale} />
        <SelectField label="Impact" value={impact} onChange={(e) => setImpact(e.target.value)} options={scale} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <SelectField label="Treatment" value={treatment} onChange={(e) => setTreatment(e.target.value)} options={[{ value: "", label: "Not decided" }, ...options(TREATMENTS)]} />
        <SelectField label="After treatment: likelihood" value={rl} onChange={(e) => setRl(e.target.value)} options={[{ value: "", label: "–" }, ...scale]} />
        <SelectField label="After treatment: impact" value={ri} onChange={(e) => setRi(e.target.value)} options={[{ value: "", label: "–" }, ...scale]} />
      </div>
      <TextArea label="Plan" value={plan} onChange={setPlan} hint="What is being done about it, by whom and by when." />
      <div className="grid grid-cols-3 gap-2">
        <TextField label="Owner" value={owner} onChange={(e) => setOwner(e.target.value)} />
        <SelectField
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[...(risk.status === "accepted" || risk.status === "review-due" ? [{ value: "", label: label(risk.status) }] : []), ...options(["identified", "assessing", "treating", "closed"])]}
        />
        <TextField label="Review every (days)" inputMode="numeric" value={interval} onChange={(e) => setIntervalDays(e.target.value)} />
      </div>
      <TextField label="Tags" value={tags} onChange={(e) => setTags(e.target.value)} hint="Comma-separated." error={error} />
    </Dialog>
  );
}

function AcceptDialog({ risk, call, onClose, onSaved }: { risk: Risk; call: Call; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState("");
  const [approver, setApprover] = useState("");
  const [days, setDays] = useState("180");
  const [error, setError] = useState<string>();
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await call(`/api/v1/risks/${risk.key}/accept`, { method: "POST", body: JSON.stringify({ reason, approver, expiresAt: inDays(Number(days)) }) });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Accept ${risk.key}`}
      description="Accepting a risk is a decision somebody answers for. When it ends, the risk is due for review again."
      onSubmit={save}
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={reason.trim().length < 3 || approver.trim().length < 2}>
            Accept risk
          </Button>
        </>
      }
    >
      <TextArea label="Reason" value={reason} onChange={setReason} hint="Why living with it is the right call, for now." />
      <div className="grid gap-2 sm:grid-cols-2">
        <TextField label="Approved by" value={approver} onChange={(e) => setApprover(e.target.value)} hint="The person who answers for it." />
        <SelectField
          label="Until"
          value={days}
          onChange={(e) => setDays(e.target.value)}
          options={[
            { value: "90", label: "90 days" },
            { value: "180", label: "180 days" },
            { value: "365", label: "1 year" },
          ]}
        />
      </div>
      {error && <p className="m-0 text-xs text-danger">{error}</p>}
    </Dialog>
  );
}

const LINK_KINDS: LinkKind[] = ["control", "finding", "incident", "vendor", "other"];

function LinkDialog({ risk, call, onClose, onSaved }: { risk: Risk; call: Call; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<LinkKind>("control");
  const [product, setProduct] = useState("");
  const [reference, setReference] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string>();
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await call(`/api/v1/risks/${risk.key}/links`, { method: "POST", body: JSON.stringify({ kind, reference, ...(product.trim() && { product: product.trim() }), ...(url.trim() && { url: url.trim() }) }) });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Link to ${risk.key}`}
      description="A reference to a control, a finding or an incident elsewhere. Nothing is fetched from the other product."
      onSubmit={save}
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!reference.trim()}>
            Add link
          </Button>
        </>
      }
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <SelectField label="Kind" value={kind} onChange={(e) => setKind(e.target.value as LinkKind)} options={options(LINK_KINDS)} />
        <TextField label="Product" value={product} onChange={(e) => setProduct(e.target.value)} hint="Optional, such as vulnerabilities." />
      </div>
      <TextField label="Reference" value={reference} onChange={(e) => setReference(e.target.value)} hint="Such as ISO 27001 A.8.8, CVE-2026-1234 or INC-12." />
      <TextField label="Address" value={url} onChange={(e) => setUrl(e.target.value)} hint="Optional link to it." error={error} />
    </Dialog>
  );
}

function HistoryPanel({ call, path }: { call: Call; path: string }) {
  const [rows, setRows] = useState<HistoryEntry[]>();
  useEffect(() => void call<{ history: HistoryEntry[] }>(path).then((r) => setRows(r.history), () => setRows([])), [call, path]);
  const columns: Column<HistoryEntry>[] = [
    { id: "at", header: "When", sortValue: (h) => h.at, cell: (h) => <span className="whitespace-nowrap text-xs">{new Date(h.at).toLocaleString()}</span> },
    { id: "who", header: "Who", cell: (h) => <span className="text-xs">{h.who}</span> },
    { id: "field", header: "What", cell: (h) => <span className="text-xs">{label(h.field)}</span> },
    { id: "change", header: "Change", width: "50%", cell: (h) => <span className="risk-clamp text-xs text-fg-muted" title={`${h.from ?? ""} → ${h.to ?? ""}`}>{h.from === null ? (h.to ?? "") : `${h.from} → ${h.to ?? "–"}`}</span> },
  ];
  return (
    <Panel title="History" description="Kept as it happened; nobody edits it." flush>
      <DataTable label="History" columns={columns} rows={rows ?? []} loading={!rows} getRowId={(h) => `${h.at}-${h.field}-${h.to ?? ""}`} minWidth={640} pageSize={20} empty={<EmptyState title="No changes yet">Changes show here with who made them.</EmptyState>} />
    </Panel>
  );
}

function RiskPage({ call, id, reload }: { call: Call; id: string; reload: () => void }) {
  const { can } = useAuth();
  const [risk, setRisk] = useState<Risk | null>();
  const [dialog, setDialog] = useState<"edit" | "accept" | "link" | "delete">();
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string>();
  const load = useCallback(() => void call<Risk>(`/api/v1/risks/${id}`).then(setRisk, () => setRisk(null)), [call, id]);
  useEffect(load, [load]);
  const saved = () => (setDialog(undefined), setError(undefined), load(), reload(), setVersion((v) => v + 1));
  const act = (path: string, init: RequestInit) => call(path, init).then(saved, (err: Error) => setError(err.message));

  if (risk === null)
    return (
      <EmptyState title="Risk not found">
        It may have been deleted. <a href="/risks">Back to the register</a>.
      </EmptyState>
    );
  if (!risk) return null;

  const linkColumns: Column<NonNullable<Risk["links"]>[number]>[] = [
    { id: "kind", header: "Kind", width: "110px", cell: (l) => <Badge>{label(l.kind)}</Badge> },
    { id: "ref", header: "Reference", width: "40%", cell: (l) => (l.url ? <a href={l.url} target="_blank" rel="noopener noreferrer" className="risk-wrap">{l.reference}</a> : <span className="risk-wrap">{l.reference}</span>) },
    { id: "product", header: "Product", cell: (l) => <span className="text-xs">{l.product ?? ""}</span> },
    { id: "added", header: "Added", cell: (l) => <span className="text-xs">{ago(l.createdAt)}</span> },
    ...(can("editor") ? [{ id: "remove", header: "", align: "right" as const, width: "56px", cell: (l: NonNullable<Risk["links"]>[number]) => <IconButton label={`Remove ${l.reference}`} size="sm" onClick={() => void act(`/api/v1/risks/${risk.key}/links/${l.id}`, { method: "DELETE" })}><X /></IconButton> }] : []),
  ];
  return (
    <>
      <PageHeader
        title={`${risk.key} ${risk.title}`}
        description={`${label(risk.category)}${risk.owner ? ` · owned by ${risk.owner}` : " · no owner yet"}${risk.external ? ` · opened by ${risk.external.source} (${risk.external.reference})` : ""} · added ${ago(risk.createdAt)}`}
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill risk={risk} />
            {can("editor") && risk.status !== "closed" && (
              <Button icon={<ClipboardCheck />} onClick={() => void act(`/api/v1/risks/${risk.key}/review`, { method: "POST" })}>
                Mark reviewed
              </Button>
            )}
            {can("admin") && risk.status !== "closed" && <Button onClick={() => setDialog("accept")}>Accept</Button>}
            {can("editor") && <Button onClick={() => setDialog("edit")}>Change</Button>}
          </span>
        }
      />
      {error && <p className="m-0 text-sm text-danger">{error}</p>}
      <KpiGrid minWidth={150}>
        <KpiCard label="Score" value={<BandBadge band={risk.band} score={risk.score} />} footer={`likelihood ${risk.likelihood} × impact ${risk.impact}`} />
        <KpiCard label="After treatment" value={risk.residual ? <BandBadge band={risk.residual.band} score={risk.residual.score} /> : "–"} footer={risk.treatment ? label(risk.treatment) : "No treatment yet"} />
        <KpiCard label="Next review" value={risk.status === "closed" ? "–" : day(risk.nextReview)} tone={risk.overdue ? "warning" : undefined} footer={risk.lastReview ? `last ${day(risk.lastReview)}` : "never reviewed"} />
        <KpiCard label="Links" value={risk.linkCount} />
      </KpiGrid>
      {risk.acceptance && (
        <Callout tone={risk.acceptance.expired ? "warning" : "info"} title={risk.acceptance.expired ? `Acceptance ended ${day(risk.acceptance.until.slice(0, 10))}` : `Accepted by ${risk.acceptance.approver} until ${day(risk.acceptance.until.slice(0, 10))}`}>
          {risk.acceptance.reason}
        </Callout>
      )}
      <div className="grid gap-2.5 lg:grid-cols-2">
        <Panel title="What could go wrong">
          <p className="risk-prose m-0 text-sm">{risk.description || <span className="text-fg-muted">No description.</span>}</p>
          {risk.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {risk.tags.map((t) => (
                <Badge key={t}>{t}</Badge>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="Plan">
          <p className="risk-prose m-0 text-sm">{risk.plan || <span className="text-fg-muted">No plan yet.</span>}</p>
        </Panel>
      </div>
      <Panel
        title="Links"
        description="Controls, findings and incidents this risk is about."
        flush
        footer={
          can("editor") ? (
            <Button size="sm" icon={<Plus />} onClick={() => setDialog("link")}>
              Add link
            </Button>
          ) : undefined
        }
      >
        <DataTable label="Links" columns={linkColumns} rows={risk.links ?? []} getRowId={(l) => l.id} minWidth={560} empty={<EmptyState title="No links">Link the control it threatens, or the finding or incident it came from.</EmptyState>} />
      </Panel>
      <HistoryPanel key={version} call={call} path={`/api/v1/risks/${risk.key}/history`} />
      {can("admin") && (
        <div>
          <Button icon={<Trash2 />} onClick={() => setDialog("delete")}>
            Delete risk
          </Button>
        </div>
      )}
      {dialog === "edit" && <EditRiskDialog risk={risk} call={call} onClose={() => setDialog(undefined)} onSaved={saved} />}
      {dialog === "accept" && <AcceptDialog risk={risk} call={call} onClose={() => setDialog(undefined)} onSaved={saved} />}
      {dialog === "link" && <LinkDialog risk={risk} call={call} onClose={() => setDialog(undefined)} onSaved={saved} />}
      <Dialog
        open={dialog === "delete"}
        onOpenChange={(o) => !o && setDialog(undefined)}
        title={`Delete ${risk.key}?`}
        description="Its links and history are deleted with it. To keep the record, close it instead."
        footer={
          <>
            <Button type="button" onClick={() => setDialog(undefined)}>
              Cancel
            </Button>
            <Button type="button" variant="primary" onClick={() => void call(`/api/v1/risks/${risk.key}`, { method: "DELETE" }).then(() => (reload(), navigate("/risks")), (err: Error) => setError(err.message))}>
              Delete
            </Button>
          </>
        }
      >
        <></>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------- Heat map

const BAND_CELL: Record<Band, string> = { low: "bg-success-soft", medium: "bg-accent-soft", high: "bg-warning-soft", critical: "bg-danger-soft" };

function HeatmapPage({ call }: { call: Call }) {
  const [view, setView] = useState<"inherent" | "residual">("inherent");
  const [cells, setCells] = useState<HeatCell[]>();
  useEffect(() => void call<{ cells: HeatCell[] }>(`/api/v1/heatmap?view=${view}`).then((r) => setCells(r.cells), () => setCells([])), [call, view]);
  const at = (l: number, i: number) => cells?.find((c) => c.likelihood === l && c.impact === i);
  return (
    <>
      <PageHeader title="Heat map" description="Open risks by likelihood and impact. Residual places a risk where it is after treatment; one not treated stays where it was." />
      <SegmentedControl
        label="View"
        value={view}
        onChange={setView}
        options={[
          { value: "inherent", label: "Before treatment" },
          { value: "residual", label: "After treatment" },
        ]}
      />
      <Panel>
        <div className="risk-heat">
          <span className="risk-heat-axis text-xs text-fg-muted">Likelihood</span>
          {[5, 4, 3, 2, 1].map((l) => (
            <div key={l} className="risk-heat-row">
              <span className="w-4 text-center text-xs text-fg-muted">{l}</span>
              {[1, 2, 3, 4, 5].map((i) => {
                const c = at(l, i);
                const band: Band = c?.band ?? (l * i >= 17 ? "critical" : l * i >= 10 ? "high" : l * i >= 5 ? "medium" : "low");
                return (
                  <div key={i} className={`risk-heat-cell rounded-md ${BAND_CELL[band]}`} title={c?.keys.join(", ") || undefined}>
                    <span className="text-lg font-semibold tabular-nums">{c?.count || ""}</span>
                    <span className="risk-clamp text-xs text-fg-muted">
                      {(c?.keys ?? []).slice(0, 3).map((k, n) => (
                        <span key={k}>
                          {n > 0 && ", "}
                          <a href={`/risks/${k}`}>{k}</a>
                        </span>
                      ))}
                      {(c?.keys.length ?? 0) > 3 ? "…" : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
          <div className="risk-heat-row">
            <span className="w-4" />
            {[1, 2, 3, 4, 5].map((i) => (
              <span key={i} className="risk-heat-label text-center text-xs text-fg-muted">
                {i}
              </span>
            ))}
          </div>
          <span className="text-center text-xs text-fg-muted">Impact</span>
        </div>
      </Panel>
      <p className="m-0 text-xs text-fg-muted">Bands: low under 5, medium from 5, high from 10, critical from 17 (likelihood × impact).</p>
    </>
  );
}

// ---------------------------------------------------------------- Vendors

const DATA_CLASSES = ["personal", "financial", "health", "credentials", "internal", "public"] as const;

function VendorDialog({ call, vendor, onClose, onSaved }: { call: Call; vendor?: Vendor; onClose: () => void; onSaved: (v: Vendor) => void }) {
  const [name, setName] = useState(vendor?.name ?? "");
  const [service, setService] = useState(vendor?.service ?? "");
  const [classes, setClasses] = useState<string[]>(vendor?.dataClasses ?? []);
  const [criticality, setCriticality] = useState<Band>(vendor?.criticality ?? "medium");
  const [contact, setContact] = useState(vendor?.contact ?? "");
  const [status, setStatus] = useState<Vendor["status"]>(vendor?.status ?? "onboarding");
  const [questionnaire, setQuestionnaire] = useState<Vendor["questionnaire"]>(vendor?.questionnaire ?? "not-sent");
  const [rating, setRating] = useState<string>(vendor?.rating ?? "");
  const [interval, setIntervalDays] = useState(String(vendor?.reviewIntervalDays ?? 365));
  const [risks, setRisks] = useState((vendor?.risks ?? []).map((r) => r.key).join(", "));
  const [notes, setNotes] = useState(vendor?.notes ?? "");
  const [error, setError] = useState<string>();
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      name,
      service,
      dataClasses: classes,
      criticality,
      status,
      questionnaire,
      reviewIntervalDays: Number(interval),
      notes,
      risks: risks.split(",").map((k) => k.trim()).filter(Boolean),
      ...(vendor ? { contact: contact.trim() || null, rating: rating || null } : { ...(contact.trim() && { contact: contact.trim() }), ...(rating && { rating }) }),
    };
    try {
      const v = vendor ? await call<Vendor>(`/api/v1/vendors/${vendor.id}`, { method: "PATCH", body: JSON.stringify(body) }) : await call<Vendor>("/api/v1/vendors", { method: "POST", body: JSON.stringify(body) });
      onSaved(v);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={vendor ? `Change ${vendor.name}` : "Add a vendor"}
      description="A company that holds your data or runs part of your service, and how much it matters."
      onSubmit={save}
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!name.trim()}>
            {vendor ? "Save" : "Add vendor"}
          </Button>
        </>
      }
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField label="Service" value={service} onChange={(e) => setService(e.target.value)} hint="What they do for you." />
      </div>
      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
        <legend className="mb-1 text-sm font-medium">Data they hold</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {DATA_CLASSES.map((c) => (
            <Checkbox key={c} label={label(c)} checked={classes.includes(c)} onChange={(e) => setClasses((xs) => (e.target.checked ? [...xs, c] : xs.filter((x) => x !== c)))} />
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-3 gap-2">
        <SelectField label="Criticality" value={criticality} onChange={(e) => setCriticality(e.target.value as Band)} options={options(["low", "medium", "high", "critical"])} />
        <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value as Vendor["status"])} options={options(["onboarding", "active", "offboarding"])} />
        <SelectField label="Questionnaire" value={questionnaire} onChange={(e) => setQuestionnaire(e.target.value as Vendor["questionnaire"])} options={options(["not-sent", "sent", "received", "reviewed"])} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <SelectField label="Rating" value={rating} onChange={(e) => setRating(e.target.value)} options={[{ value: "", label: "Not rated" }, ...options(["low", "medium", "high"])]} />
        <TextField label="Review every (days)" inputMode="numeric" value={interval} onChange={(e) => setIntervalDays(e.target.value)} />
        <TextField label="Contact" value={contact} onChange={(e) => setContact(e.target.value)} />
      </div>
      <TextField label="Risks" value={risks} onChange={(e) => setRisks(e.target.value)} hint="Keys of the risks they bring, such as R-3, R-7." />
      <TextArea label="Notes" value={notes} onChange={setNotes} />
      {error && <p className="m-0 text-xs text-danger">{error}</p>}
    </Dialog>
  );
}

function VendorsPage({ call, reload }: { call: Call; reload: () => void }) {
  const { can } = useAuth();
  const [rows, setRows] = useState<Vendor[]>();
  const [q, setQ] = useState("");
  const [crit, setCrit] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    const p = new URLSearchParams({ limit: "500", ...(q.trim() && { q: q.trim() }), ...(crit.length && { criticality: crit.join(",") }) });
    void call<{ vendors: Vendor[] }>(`/api/v1/vendors?${p}`).then((r) => setRows(r.vendors), () => setRows([]));
  }, [call, q, crit]);
  const columns: Column<Vendor>[] = [
    {
      id: "name",
      header: "Vendor",
      width: "28%",
      sortValue: (v) => v.name,
      cell: (v) => (
        <span className="flex min-w-0 flex-col">
          <a href={`/vendors/${v.id}`} className="font-medium">
            {v.name}
          </a>
          <span className="risk-clamp text-xs text-fg-muted">{v.service}</span>
        </span>
      ),
    },
    { id: "crit", header: "Criticality", sortValue: (v) => BANDS.indexOf(v.criticality), cell: (v) => <SeverityBadge severity={v.criticality} /> },
    { id: "data", header: "Data", cell: (v) => <span className="text-xs">{v.dataClasses.map(label).join(", ") || "–"}</span> },
    { id: "status", header: "Status", cell: (v) => <Badge>{label(v.status)}</Badge> },
    { id: "rating", header: "Rating", cell: (v) => (v.rating ? <StatusBadge tone={v.rating === "high" ? "danger" : v.rating === "medium" ? "warning" : "success"}>{label(v.rating)}</StatusBadge> : <span className="text-xs text-fg-muted">Not rated</span>) },
    { id: "review", header: "Next review", sortValue: (v) => v.nextReview, cell: (v) => <Due date={v.nextReview} overdue={v.overdue} /> },
  ];
  return (
    <>
      <PageHeader
        title="Vendors"
        description="Who holds your data or runs part of your service, how much it matters, and when you last looked."
        actions={
          <>
            <SearchInput label="Search vendors" className="w-56" value={q} onChange={(e) => setQ(e.target.value)} />
            {can("editor") && (
              <Button variant="primary" icon={<Plus />} onClick={() => setAdding(true)}>
                Add vendor
              </Button>
            )}
          </>
        }
      />
      <FilterBar onClear={() => setCrit([])}>
        <FacetFilter label="Criticality" selected={crit} onChange={setCrit} options={BANDS.map((b) => ({ value: b, label: label(b) }))} />
      </FilterBar>
      <Panel flush>
        <DataTable label="Vendors" columns={columns} rows={rows ?? []} loading={!rows} getRowId={(v) => v.id} minWidth={860} pageSize={50} empty={<EmptyState title="No vendors">Add the companies that hold your data, starting with the critical ones.</EmptyState>} />
      </Panel>
      {adding && (
        <VendorDialog
          call={call}
          onClose={() => setAdding(false)}
          onSaved={(v) => {
            setAdding(false);
            reload();
            navigate(`/vendors/${v.id}`);
          }}
        />
      )}
    </>
  );
}

function VendorPage({ call, id, reload }: { call: Call; id: string; reload: () => void }) {
  const { can } = useAuth();
  const [vendor, setVendor] = useState<Vendor | null>();
  const [dialog, setDialog] = useState<"edit" | "doc" | "delete">();
  const [docTitle, setDocTitle] = useState("");
  const [docUrl, setDocUrl] = useState("");
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string>();
  const load = useCallback(() => void call<Vendor>(`/api/v1/vendors/${id}`).then(setVendor, () => setVendor(null)), [call, id]);
  useEffect(load, [load]);
  const saved = () => (setDialog(undefined), setError(undefined), setDocTitle(""), setDocUrl(""), load(), reload(), setVersion((v) => v + 1));
  const act = (path: string, init: RequestInit) => call(path, init).then(saved, (err: Error) => setError(err.message));

  if (vendor === null)
    return (
      <EmptyState title="Vendor not found">
        It may have been deleted. <a href="/vendors">Back to vendors</a>.
      </EmptyState>
    );
  if (!vendor) return null;
  return (
    <>
      <PageHeader
        title={vendor.name}
        description={`${vendor.service || "No service described"}${vendor.contact ? ` · ${vendor.contact}` : ""}`}
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={vendor.criticality} />
            {can("editor") && (
              <Button icon={<ClipboardCheck />} onClick={() => void act(`/api/v1/vendors/${vendor.id}/review`, { method: "POST" })}>
                Mark reviewed
              </Button>
            )}
            {can("editor") && <Button onClick={() => setDialog("edit")}>Change</Button>}
          </span>
        }
      />
      {error && <p className="m-0 text-sm text-danger">{error}</p>}
      <KpiGrid minWidth={150}>
        <KpiCard label="Status" value={label(vendor.status)} />
        <KpiCard label="Questionnaire" value={label(vendor.questionnaire)} />
        <KpiCard label="Rating" value={vendor.rating ? label(vendor.rating) : "Not rated"} />
        <KpiCard label="Next review" value={day(vendor.nextReview)} tone={vendor.overdue ? "warning" : undefined} footer={vendor.lastReview ? `last ${day(vendor.lastReview)}` : "never reviewed"} />
      </KpiGrid>
      <div className="grid gap-2.5 lg:grid-cols-2">
        <Panel title="Data they hold">
          {vendor.dataClasses.length ? (
            <div className="flex flex-wrap gap-1">
              {vendor.dataClasses.map((c) => (
                <Badge key={c}>{label(c)}</Badge>
              ))}
            </div>
          ) : (
            <p className="m-0 text-sm text-fg-muted">None recorded.</p>
          )}
          {vendor.notes && <p className="risk-prose mt-3 mb-0 text-sm">{vendor.notes}</p>}
        </Panel>
        <Panel title="Risks they bring">
          {vendor.risks.length ? (
            <ul className="risk-list flex flex-col gap-1 text-sm">
              {vendor.risks.map((r) => (
                <li key={r.id} className="flex items-center gap-2">
                  <a href={`/risks/${r.key}`}>
                    {r.key} {r.title}
                  </a>
                  <SeverityBadge severity={r.band} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-sm text-fg-muted">No risk linked. Add their keys under Change.</p>
          )}
        </Panel>
      </div>
      <Panel
        title="Documents"
        description="Links to reports, certificates and contracts. Nothing is stored or fetched."
        footer={
          can("editor") ? (
            <Button size="sm" icon={<Plus />} onClick={() => setDialog("doc")}>
              Add document link
            </Button>
          ) : undefined
        }
      >
        {vendor.documents.length ? (
          <ul className="risk-list flex flex-col gap-1 text-sm">
            {vendor.documents.map((d) => (
              <li key={d.id} className="flex items-center gap-2">
                <a href={d.url} target="_blank" rel="noopener noreferrer">
                  {d.title}
                </a>
                <span className="text-xs text-fg-muted">{ago(d.createdAt)}</span>
                {can("editor") && (
                  <IconButton label={`Remove ${d.title}`} size="sm" onClick={() => void act(`/api/v1/vendors/${vendor.id}/documents/${d.id}`, { method: "DELETE" })}>
                    <X />
                  </IconButton>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-sm text-fg-muted">No documents yet: a SOC 2 report, an ISO certificate or the data processing agreement.</p>
        )}
      </Panel>
      <HistoryPanel key={version} call={call} path={`/api/v1/vendors/${vendor.id}/history`} />
      {can("admin") && (
        <div>
          <Button icon={<Trash2 />} onClick={() => setDialog("delete")}>
            Delete vendor
          </Button>
        </div>
      )}
      {dialog === "edit" && <VendorDialog call={call} vendor={vendor} onClose={() => setDialog(undefined)} onSaved={saved} />}
      <Dialog
        open={dialog === "doc"}
        onOpenChange={(o) => !o && setDialog(undefined)}
        title="Add a document link"
        onSubmit={(e) => (e.preventDefault(), void act(`/api/v1/vendors/${vendor.id}/documents`, { method: "POST", body: JSON.stringify({ title: docTitle, url: docUrl }) }))}
        footer={
          <>
            <Button type="button" onClick={() => setDialog(undefined)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!docTitle.trim() || !/^https?:\/\//.test(docUrl.trim())}>
              Add
            </Button>
          </>
        }
      >
        <TextField label="Title" value={docTitle} onChange={(e) => setDocTitle(e.target.value)} hint="Such as SOC 2 Type II, 2026." />
        <TextField label="Address" value={docUrl} onChange={(e) => setDocUrl(e.target.value)} hint="Where the document is kept." />
      </Dialog>
      <Dialog
        open={dialog === "delete"}
        onOpenChange={(o) => !o && setDialog(undefined)}
        title={`Delete ${vendor.name}?`}
        description="Its documents and history are deleted with it. To keep the record, set it to offboarding instead."
        footer={
          <>
            <Button type="button" onClick={() => setDialog(undefined)}>
              Cancel
            </Button>
            <Button type="button" variant="primary" onClick={() => void call(`/api/v1/vendors/${vendor.id}`, { method: "DELETE" }).then(() => (reload(), navigate("/vendors")), (err: Error) => setError(err.message))}>
              Delete
            </Button>
          </>
        }
      >
        <></>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------- Setup

function SetupPage() {
  const origin = window.location.origin;
  return (
    <>
      <PageHeader title="Setup" description="The register is kept by people. Other products can open a risk too, so a finding nobody fixes becomes a decision somebody makes." />
      <Panel title="Open a risk from another product" description="With an API token with the editor role. The same source and reference open one risk, so sending it again changes nothing.">
        <Code>{`curl -sf -X POST -H "Authorization: Bearer $RISK_API_TOKEN" -H 'content-type: application/json' \\
  -d '{"title":"Unpatched OpenSSL on the payment hosts","category":"security","likelihood":4,"impact":4,
       "external":{"source":"vulnerabilities","reference":"CVE-2026-1234"}}' \\
  "${origin}/api/v1/risks"`}</Code>
      </Panel>
      <Panel title="What to know">
        <ul className="risk-list flex flex-col gap-1 text-sm text-fg-muted">
          <li>The score is likelihood times impact, each 1 to 5: low under 5, medium from 5, high from 10, critical from 17.</li>
          <li>Accepting a risk needs a reason, an approver and an end within a year. When it ends, the risk is due for review again.</li>
          <li>Risks and vendors have a review interval; overdue reviews show on the register and in /metrics.</li>
          <li>Every change is kept in the history with who made it, and nobody edits the history.</li>
        </ul>
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------- Shell

/** Account, Members, Sign-in and API tokens: the screens come from @openasy/auth. */
function SettingsPage({ page }: { page: "account" | "members" | "signin" | "tokens" }) {
  const { signOut, can } = useAuth();
  if (page !== "account" && !can("admin")) return <EmptyState title="Admins only">Ask an admin of this risk for access.</EmptyState>;
  const titles = {
    account: ["Account", "Your profile, password, two-step verification and where you are signed in."],
    members: ["Members", "Who can sign in to this risk, and with which role. Viewers see everything; editors also add and change risks and vendors and mark reviews; admins also accept and delete risks, delete vendors, and manage members and tokens."],
    signin: ["Sign-in", "Identity providers people can sign in with, such as OpenAsy Identity, Keycloak or Microsoft Entra ID, and which of their groups give which role."],
    tokens: ["API tokens", "For scripts and other products. Each token has one role and an expiry; the secret is shown once."],
  } as const;
  return (
    <>
      <PageHeader
        title={titles[page][0]}
        description={titles[page][1]}
        actions={
          page === "account" && (
            <Button icon={<LogOut />} onClick={() => void signOut()}>
              Sign out
            </Button>
          )
        }
      />
      {page === "account" ? <AccountSettings /> : page === "members" ? <MembersSettings /> : page === "signin" ? <SignInSettings /> : <TokensSettings />}
    </>
  );
}

function Product() {
  const [theme, setTheme] = useThemePreference();
  const { me, can } = useAuth();
  const route = parseRoute(usePath());
  const [summary, setSummary] = useState<Summary>();
  const [products, setProducts] = useState<Array<ProductLink & { id: ProductId }>>([]);
  const call = useApi();

  // The install's other products (OPENASY_PRODUCTS), for the switcher; ids this UI does not know are left out.
  useEffect(() => {
    void call<{ products: ProductLink[] }>("/api/v1/products").then(
      (r) => setProducts(r.products.filter((p): p is ProductLink & { id: ProductId } => p.id !== "risk" && (PRODUCT_IDS as readonly string[]).includes(p.id))),
      () => {},
    );
  }, [call]);

  const reload = useCallback(() => void call<Summary>("/api/v1/summary").then(setSummary, () => {}), [call]);
  useEffect(() => {
    reload();
    const t = setInterval(reload, 30_000);
    return () => clearInterval(t);
  }, [reload]);

  const nav = [
    { id: "risks", label: "Register", icon: ClipboardCheck, count: summary?.risks.open },
    { id: "heatmap", label: "Heat map", icon: Grid3x3 },
    { id: "vendors", label: "Vendors", icon: Building2, count: summary?.vendors.total },
  ];
  const footerNav = [
    { id: "setup", label: "Setup", icon: Settings2 },
    ...(can("admin")
      ? [
          { id: "members", label: "Members", icon: Users },
          { id: "signin", label: "Sign-in", icon: LogIn },
          { id: "tokens", label: "API tokens", icon: KeyRound },
        ]
      : []),
    { id: "account", label: "Account", icon: UserRound },
  ];
  const active = route.page === "risk" ? "risks" : route.page === "vendor" ? "vendors" : route.page;
  const roleName = me.user.role.charAt(0).toUpperCase() + me.user.role.slice(1);

  return (
    <AppShell
      product="risk"
      nav={nav}
      activeNav={active}
      onNavigate={(id) => navigate(`/${id}`)}
      connectedProducts={products.map((p) => p.id)}
      onSwitchProduct={(id) => {
        const to = products.find((p) => p.id === id);
        if (to) window.location.assign(to.url);
      }}
      footerNav={footerNav}
      user={{ name: me.user.name, role: roleName }}
      theme={theme}
      onThemeChange={setTheme}
    >
      {route.page === "risks" ? (
        <RegisterPage call={call} summary={summary} reload={reload} />
      ) : route.page === "risk" ? (
        <RiskPage key={route.id} call={call} id={route.id} reload={reload} />
      ) : route.page === "heatmap" ? (
        <HeatmapPage call={call} />
      ) : route.page === "vendors" ? (
        <VendorsPage call={call} reload={reload} />
      ) : route.page === "vendor" ? (
        <VendorPage key={route.id} call={call} id={route.id} reload={reload} />
      ) : route.page === "account" || route.page === "members" || route.page === "signin" || route.page === "tokens" ? (
        <SettingsPage page={route.page} />
      ) : (
        <SetupPage />
      )}
    </AppShell>
  );
}

export function App() {
  const [theme] = useThemePreference();
  return (
    // No organization until branding is configurable (ADR 0004); the library's default is a placeholder.
    <BrandProvider theme={theme} brand={{ name: "OpenAsy", organization: undefined }} className="min-h-screen">
      <AuthGate product="OpenAsy Risk">
        <Product />
      </AuthGate>
    </BrandProvider>
  );
}
