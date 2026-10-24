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
  useAgo,
} from "@openasy/ui";
import { AccountSettings, AuthGate, MembersSettings, SignInSettings, TokensSettings, useAuth, useInstallBrand } from "@openasy/auth/react";
import colophon from "virtual:openasy-colophon";
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
import { useT } from "./i18n.ts";
const day = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString() : "–");

const PAGES = ["heatmap", "setup", "account", "members", "signin", "tokens", "about"] as const;
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
  const tone =
    risk.status === "closed"
      ? "neutral"
      : risk.status === "review-due"
        ? "danger"
        : risk.status === "accepted"
          ? "info"
          : risk.status === "treating"
            ? "warning"
            : "neutral";
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
  const t = useT();
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
        body: JSON.stringify({
          title,
          category,
          likelihood: Number(likelihood),
          impact: Number(impact),
          description,
          ...(owner.trim() && { owner: owner.trim() }),
        }),
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
      title={t("newRiskDialog.addARisk")}
      description={t("newRiskDialog.sayWhatCouldGoWrong")}
      onSubmit={submit}
      footer={
        <>
          <Button type="button" onClick={close}>
            {t("newRiskDialog.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={title.trim().length < 3}>
            {t("newRiskDialog.addRisk")}
          </Button>
        </>
      }
    >
      <TextField
        label={t("newRiskDialog.title")}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        hint={t("newRiskDialog.whatCouldGoWrong")}
        error={error}
      />
      <div className="grid grid-cols-3 gap-2">
        <SelectField
          label={t("newRiskDialog.category")}
          value={category}
          onChange={(e) => setCategory(e.target.value as Category)}
          options={options(CATEGORIES)}
        />
        <SelectField label={t("newRiskDialog.likelihood")} value={likelihood} onChange={(e) => setLikelihood(e.target.value)} options={scale} />
        <SelectField label={t("newRiskDialog.impact")} value={impact} onChange={(e) => setImpact(e.target.value)} options={scale} />
      </div>
      <TextField label={t("newRiskDialog.owner")} value={owner} onChange={(e) => setOwner(e.target.value)} hint={t("newRiskDialog.whoAnswersForItOptional")} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t("newRiskDialog.description")}</span>
        <textarea
          className="risk-textarea w-full rounded-md border border-line-strong bg-surface px-2.5 py-2 text-sm text-fg"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
    </Dialog>
  );
}

type View = "active" | "review-due" | "closed" | "all";

function RegisterPage({ call, summary, reload }: { call: Call; summary?: Summary; reload: () => void }) {
  const t = useT();
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
    query().then(
      (r) => (setRows(r.risks), setMore(r.nextCursor)),
      () => setRows([]),
    );
    void call<{ risks: Risk[]; vendors: Vendor[] }>("/api/v1/reviews").then(setReviews, () => {});
  }, [query, call]);
  useEffect(load, [load]);
  const loadMore = () => more && query(more).then((r) => (setRows((x) => [...(x ?? []), ...r.risks]), setMore(r.nextCursor)));

  const columns: Column<Risk>[] = [
    { id: "key", header: t("registerPage.risk"), width: "76px", sortValue: (r) => r.number, cell: (r) => <span className="font-mono text-xs">{r.key}</span> },
    {
      id: "title",
      header: t("registerPage.title"),
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
    { id: "band", header: t("registerPage.score"), width: "130px", sortValue: (r) => r.score, cell: (r) => <BandBadge band={r.band} score={r.score} /> },
    {
      id: "residual",
      header: t("registerPage.residual"),
      width: "130px",
      cell: (r) => (r.residual ? <BandBadge band={r.residual.band} score={r.residual.score} /> : <span className="text-xs text-fg-muted">–</span>),
    },
    { id: "status", header: t("registerPage.status"), cell: (r) => <StatusPill risk={r} /> },
    { id: "owner", header: t("registerPage.owner"), sortValue: (r) => r.owner ?? "", cell: (r) => <span className="text-xs">{r.owner ?? "–"}</span> },
    {
      id: "review",
      header: t("registerPage.nextReview"),
      sortValue: (r) => r.nextReview,
      cell: (r) => (r.status === "closed" ? "–" : <Due date={r.nextReview} overdue={r.overdue} />),
    },
  ];
  const s = summary;
  const due = reviews ? reviews.risks.length + reviews.vendors.length : 0;
  return (
    <>
      <PageHeader
        title={t("registerPage.riskRegister")}
        description={s ? `${t("plurals.openRisk", { count: s.risks.open })} · ${t("plurals.vendor", { count: s.vendors.total })}` : undefined}
        actions={
          <>
            <SearchInput label={t("registerPage.searchRisks")} className="w-56" value={q} onChange={(e) => setQ(e.target.value)} />
            {can("editor") && (
              <Button variant="primary" icon={<Plus />} onClick={() => setAdding(true)}>
                {t("registerPage.addRisk")}
              </Button>
            )}
          </>
        }
      />
      {s && (
        <KpiGrid minWidth={150}>
          <KpiCard label={t("registerPage.critical")} value={s.risks.byBand.critical} footer={<SeverityBadge severity="critical" />} />
          <KpiCard label={t("registerPage.high")} value={s.risks.byBand.high} footer={<SeverityBadge severity="high" />} />
          <KpiCard label={t("registerPage.medium")} value={s.risks.byBand.medium} footer={<SeverityBadge severity="medium" />} />
          <KpiCard label={t("registerPage.low")} value={s.risks.byBand.low} footer={<SeverityBadge severity="low" />} />
          <KpiCard
            label={t("registerPage.reviewsOverdue")}
            value={s.risks.overdue + s.vendors.overdue}
            tone={s.risks.overdue + s.vendors.overdue ? "warning" : "success"}
          />
          <KpiCard label={t("registerPage.accepted")} value={s.risks.accepted} tone="info" />
        </KpiGrid>
      )}
      {due > 0 && reviews && (
        <Panel title={t("registerPage.overdue", { plural: t("plurals.review", { count: due }) })} description={t("registerPage.reviewTheRiskOrVendor")}>
          <ul className="risk-list flex flex-col gap-1 text-sm">
            {reviews.risks.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2">
                <a href={`/risks/${r.key}`} className="font-medium">
                  {r.key} {r.title}
                </a>
                <StatusPill risk={r} />
                <span className="text-xs text-fg-muted">
                  {r.status === "review-due" ? t("registerPage.acceptanceRanOut") : t("registerPage.due", { day: day(r.nextReview) })}
                </span>
              </li>
            ))}
            {reviews.vendors.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2">
                <a href={`/vendors/${v.id}`} className="font-medium">
                  {v.name}
                </a>
                <Badge>{t("registerPage.vendor")}</Badge>
                <span className="text-xs text-fg-muted">due {day(v.nextReview)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <Tabs<View>
        label={t("registerPage.registerViews")}
        value={view}
        onChange={setView}
        items={[
          { value: "active", label: t("registerPage.open") },
          { value: "review-due", label: t("registerPage.reviewDue") },
          { value: "closed", label: t("registerPage.closed") },
          { value: "all", label: t("registerPage.all") },
        ]}
      />
      <FilterBar onClear={() => (setBands([]), setCategory("all"), setQ(""))}>
        <FacetFilter
          label={t("registerPage.band")}
          selected={bands}
          onChange={setBands}
          options={BANDS.map((b) => ({ value: b, label: label(b), count: view === "active" ? s?.risks.byBand[b] : undefined }))}
        />
        <SelectField
          label={t("registerPage.category")}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          options={[{ value: "all", label: t("registerPage.everyCategory") }, ...options(CATEGORIES)]}
        />
      </FilterBar>
      <Panel
        title={t("registerPage.highestScoreFirst")}
        flush
        footer={
          more ? (
            <Button size="sm" onClick={loadMore}>
              {t("registerPage.loadMore")}
            </Button>
          ) : undefined
        }
      >
        <DataTable
          label={t("registerPage.risks")}
          columns={columns}
          rows={rows ?? []}
          loading={!rows}
          getRowId={(r) => r.id}
          minWidth={900}
          pageSize={50}
          empty={
            <EmptyState title={t("registerPage.noRisksHere")}>
              {view === "active" && s && s.risks.open === 0 ? t("registerPage.addTheFirstRiskOr") : t("registerPage.nothingMatchesTheseFilters")}
            </EmptyState>
          }
        />
      </Panel>
      <NewRiskDialog open={adding} onClose={() => setAdding(false)} call={call} onCreated={(key) => (reload(), navigate(`/risks/${key}`))} />
    </>
  );
}

function TextArea({
  label: name,
  value,
  onChange,
  hint,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  rows?: number;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{name}</span>
      <textarea
        className="risk-textarea w-full rounded-md border border-line-strong bg-surface px-2.5 py-2 text-sm text-fg"
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <span className="text-xs text-fg-muted">{hint}</span>}
    </label>
  );
}

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

// ---------------------------------------------------------------- One risk

function EditRiskDialog({ risk, call, onClose, onSaved }: { risk: Risk; call: Call; onClose: () => void; onSaved: () => void }) {
  const msg = useT();
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
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
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
      title={msg("editRiskDialog.change", { key: risk.key })}
      description={msg("editRiskDialog.everyChangeIsKeptIn")}
      onSubmit={save}
      footer={
        <>
          <Button type="button" onClick={onClose}>
            {msg("editRiskDialog.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={title.trim().length < 3}>
            {msg("editRiskDialog.save")}
          </Button>
        </>
      }
    >
      <TextField label={msg("editRiskDialog.title")} value={title} onChange={(e) => setTitle(e.target.value)} />
      <TextArea label={msg("editRiskDialog.description")} value={description} onChange={setDescription} />
      <div className="grid grid-cols-3 gap-2">
        <SelectField
          label={msg("editRiskDialog.category")}
          value={category}
          onChange={(e) => setCategory(e.target.value as Category)}
          options={options(CATEGORIES)}
        />
        <SelectField label={msg("editRiskDialog.likelihood")} value={likelihood} onChange={(e) => setLikelihood(e.target.value)} options={scale} />
        <SelectField label={msg("editRiskDialog.impact")} value={impact} onChange={(e) => setImpact(e.target.value)} options={scale} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <SelectField
          label={msg("editRiskDialog.treatment")}
          value={treatment}
          onChange={(e) => setTreatment(e.target.value)}
          options={[{ value: "", label: msg("editRiskDialog.notDecided") }, ...options(TREATMENTS)]}
        />
        <SelectField
          label={msg("editRiskDialog.afterTreatmentLikelihood")}
          value={rl}
          onChange={(e) => setRl(e.target.value)}
          options={[{ value: "", label: "–" }, ...scale]}
        />
        <SelectField
          label={msg("editRiskDialog.afterTreatmentImpact")}
          value={ri}
          onChange={(e) => setRi(e.target.value)}
          options={[{ value: "", label: "–" }, ...scale]}
        />
      </div>
      <TextArea label={msg("editRiskDialog.plan")} value={plan} onChange={setPlan} hint={msg("editRiskDialog.whatIsBeingDoneAbout")} />
      <div className="grid grid-cols-3 gap-2">
        <TextField label={msg("editRiskDialog.owner")} value={owner} onChange={(e) => setOwner(e.target.value)} />
        <SelectField
          label={msg("editRiskDialog.status")}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[
            ...(risk.status === "accepted" || risk.status === "review-due" ? [{ value: "", label: label(risk.status) }] : []),
            ...options(["identified", "assessing", "treating", "closed"]),
          ]}
        />
        <TextField label={msg("editRiskDialog.reviewEveryDays")} inputMode="numeric" value={interval} onChange={(e) => setIntervalDays(e.target.value)} />
      </div>
      <TextField
        label={msg("editRiskDialog.tags")}
        value={tags}
        onChange={(e) => setTags(e.target.value)}
        hint={msg("editRiskDialog.commaSeparated")}
        error={error}
      />
    </Dialog>
  );
}

function AcceptDialog({ risk, call, onClose, onSaved }: { risk: Risk; call: Call; onClose: () => void; onSaved: () => void }) {
  const t = useT();
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
      title={t("acceptDialog.accept", { key: risk.key })}
      description={t("acceptDialog.acceptingARiskIsA")}
      onSubmit={save}
      footer={
        <>
          <Button type="button" onClick={onClose}>
            {t("acceptDialog.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={reason.trim().length < 3 || approver.trim().length < 2}>
            {t("acceptDialog.acceptRisk")}
          </Button>
        </>
      }
    >
      <TextArea label={t("acceptDialog.reason")} value={reason} onChange={setReason} hint={t("acceptDialog.whyLivingWithItIs")} />
      <div className="grid gap-2 sm:grid-cols-2">
        <TextField
          label={t("acceptDialog.approvedBy")}
          value={approver}
          onChange={(e) => setApprover(e.target.value)}
          hint={t("acceptDialog.thePersonWhoAnswersFor")}
        />
        <SelectField
          label={t("acceptDialog.until")}
          value={days}
          onChange={(e) => setDays(e.target.value)}
          options={[
            { value: "90", label: t("acceptDialog.n90Days") },
            { value: "180", label: t("acceptDialog.n180Days") },
            { value: "365", label: t("acceptDialog.n1Year") },
          ]}
        />
      </div>
      {error && <p className="m-0 text-xs text-danger">{error}</p>}
    </Dialog>
  );
}

const LINK_KINDS: LinkKind[] = ["control", "finding", "incident", "vendor", "other"];

function LinkDialog({ risk, call, onClose, onSaved }: { risk: Risk; call: Call; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [kind, setKind] = useState<LinkKind>("control");
  const [product, setProduct] = useState("");
  const [reference, setReference] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string>();
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await call(`/api/v1/risks/${risk.key}/links`, {
        method: "POST",
        body: JSON.stringify({ kind, reference, ...(product.trim() && { product: product.trim() }), ...(url.trim() && { url: url.trim() }) }),
      });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("linkDialog.linkTo", { key: risk.key })}
      description={t("linkDialog.aReferenceToAControl")}
      onSubmit={save}
      footer={
        <>
          <Button type="button" onClick={onClose}>
            {t("linkDialog.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={!reference.trim()}>
            {t("linkDialog.addLink")}
          </Button>
        </>
      }
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <SelectField label={t("linkDialog.kind")} value={kind} onChange={(e) => setKind(e.target.value as LinkKind)} options={options(LINK_KINDS)} />
        <TextField
          label={t("linkDialog.product")}
          value={product}
          onChange={(e) => setProduct(e.target.value)}
          hint={t("linkDialog.optionalSuchAsVulnerabilities")}
        />
      </div>
      <TextField label={t("linkDialog.reference")} value={reference} onChange={(e) => setReference(e.target.value)} hint={t("linkDialog.suchAsIso27001A")} />
      <TextField label={t("linkDialog.address")} value={url} onChange={(e) => setUrl(e.target.value)} hint={t("linkDialog.optionalLinkToIt")} error={error} />
    </Dialog>
  );
}

function HistoryPanel({ call, path }: { call: Call; path: string }) {
  const t = useT();
  const [rows, setRows] = useState<HistoryEntry[]>();
  useEffect(
    () =>
      void call<{ history: HistoryEntry[] }>(path).then(
        (r) => setRows(r.history),
        () => setRows([]),
      ),
    [call, path],
  );
  const columns: Column<HistoryEntry>[] = [
    {
      id: "at",
      header: t("historyPanel.when"),
      sortValue: (h) => h.at,
      cell: (h) => <span className="whitespace-nowrap text-xs">{new Date(h.at).toLocaleString()}</span>,
    },
    { id: "who", header: t("historyPanel.who"), cell: (h) => <span className="text-xs">{h.who}</span> },
    { id: "field", header: t("historyPanel.what"), cell: (h) => <span className="text-xs">{label(h.field)}</span> },
    {
      id: "change",
      header: t("historyPanel.change"),
      width: "50%",
      cell: (h) => (
        <span className="risk-clamp text-xs text-fg-muted" title={`${h.from ?? ""} → ${h.to ?? ""}`}>
          {h.from === null ? (h.to ?? "") : `${h.from} → ${h.to ?? "–"}`}
        </span>
      ),
    },
  ];
  return (
    <Panel title={t("historyPanel.history")} description={t("historyPanel.keptAsItHappenedNobody")} flush>
      <DataTable
        label={t("historyPanel.history")}
        columns={columns}
        rows={rows ?? []}
        loading={!rows}
        getRowId={(h) => `${h.at}-${h.field}-${h.to ?? ""}`}
        minWidth={640}
        pageSize={20}
        empty={<EmptyState title={t("historyPanel.noChangesYet")}>{t("historyPanel.changesShowHereWithWho")}</EmptyState>}
      />
    </Panel>
  );
}

function RiskPage({ call, id, reload }: { call: Call; id: string; reload: () => void }) {
  const ago = useAgo();
  const msg = useT();
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
      <EmptyState title={msg("riskPage.riskNotFound")}>
        {msg("riskPage.itMayHaveBeenDeleted")} <a href="/risks">{msg("riskPage.backToTheRegister")}</a>.
      </EmptyState>
    );
  if (!risk) return null;

  const linkColumns: Column<NonNullable<Risk["links"]>[number]>[] = [
    { id: "kind", header: msg("riskPage.kind"), width: "110px", cell: (l) => <Badge>{label(l.kind)}</Badge> },
    {
      id: "ref",
      header: msg("riskPage.reference"),
      width: "40%",
      cell: (l) =>
        l.url ? (
          <a href={l.url} target="_blank" rel="noopener noreferrer" className="risk-wrap">
            {l.reference}
          </a>
        ) : (
          <span className="risk-wrap">{l.reference}</span>
        ),
    },
    { id: "product", header: msg("riskPage.product"), cell: (l) => <span className="text-xs">{l.product ?? ""}</span> },
    { id: "added", header: msg("riskPage.added"), cell: (l) => <span className="text-xs">{ago(l.createdAt)}</span> },
    ...(can("editor")
      ? [
          {
            id: "remove",
            header: "",
            align: "right" as const,
            width: "56px",
            cell: (l: NonNullable<Risk["links"]>[number]) => (
              <IconButton
                label={msg("riskPage.remove", { reference: l.reference })}
                size="sm"
                onClick={() => void act(`/api/v1/risks/${risk.key}/links/${l.id}`, { method: "DELETE" })}
              >
                <X />
              </IconButton>
            ),
          },
        ]
      : []),
  ];
  return (
    <>
      <PageHeader
        title={`${risk.key} ${risk.title}`}
        description={msg("riskPage.added2", {
          label: label(risk.category),
          value: risk.owner ? ` · owned by ${risk.owner}` : " · no owner yet",
          value2: risk.external ? ` · opened by ${risk.external.source} (${risk.external.reference})` : "",
          ago: ago(risk.createdAt),
        })}
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill risk={risk} />
            {can("editor") && risk.status !== "closed" && (
              <Button icon={<ClipboardCheck />} onClick={() => void act(`/api/v1/risks/${risk.key}/review`, { method: "POST" })}>
                {msg("riskPage.markReviewed")}
              </Button>
            )}
            {can("admin") && risk.status !== "closed" && <Button onClick={() => setDialog("accept")}>{msg("riskPage.accept")}</Button>}
            {can("editor") && <Button onClick={() => setDialog("edit")}>{msg("riskPage.change")}</Button>}
          </span>
        }
      />
      {error && <p className="m-0 text-sm text-danger">{error}</p>}
      <KpiGrid minWidth={150}>
        <KpiCard
          label={msg("riskPage.score")}
          value={<BandBadge band={risk.band} score={risk.score} />}
          footer={msg("riskPage.likelihoodImpact", { likelihood: risk.likelihood, impact: risk.impact })}
        />
        <KpiCard
          label={msg("riskPage.afterTreatment")}
          value={risk.residual ? <BandBadge band={risk.residual.band} score={risk.residual.score} /> : "–"}
          footer={risk.treatment ? label(risk.treatment) : msg("riskPage.noTreatmentYet")}
        />
        <KpiCard
          label={msg("riskPage.nextReview")}
          value={risk.status === "closed" ? "–" : day(risk.nextReview)}
          tone={risk.overdue ? "warning" : undefined}
          footer={risk.lastReview ? msg("riskPage.last", { day: day(risk.lastReview) }) : msg("riskPage.neverReviewed")}
        />
        <KpiCard label={msg("riskPage.links")} value={risk.linkCount} />
      </KpiGrid>
      {risk.acceptance && (
        <Callout
          tone={risk.acceptance.expired ? "warning" : "info"}
          title={
            risk.acceptance.expired
              ? msg("riskPage.acceptanceEnded", { day: day(risk.acceptance.until.slice(0, 10)) })
              : msg("riskPage.acceptedByUntil", { approver: risk.acceptance.approver, day: day(risk.acceptance.until.slice(0, 10)) })
          }
        >
          {risk.acceptance.reason}
        </Callout>
      )}
      <div className="grid gap-2.5 lg:grid-cols-2">
        <Panel title={msg("riskPage.whatCouldGoWrong")}>
          <p className="risk-prose m-0 text-sm">{risk.description || <span className="text-fg-muted">{msg("riskPage.noDescription")}</span>}</p>
          {risk.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {risk.tags.map((t) => (
                <Badge key={t}>{t}</Badge>
              ))}
            </div>
          )}
        </Panel>
        <Panel title={msg("riskPage.plan")}>
          <p className="risk-prose m-0 text-sm">{risk.plan || <span className="text-fg-muted">{msg("riskPage.noPlanYet")}</span>}</p>
        </Panel>
      </div>
      <Panel
        title={msg("riskPage.links")}
        description={msg("riskPage.controlsFindingsAndIncidentsThis")}
        flush
        footer={
          can("editor") ? (
            <Button size="sm" icon={<Plus />} onClick={() => setDialog("link")}>
              {msg("riskPage.addLink")}
            </Button>
          ) : undefined
        }
      >
        <DataTable
          label={msg("riskPage.links")}
          columns={linkColumns}
          rows={risk.links ?? []}
          getRowId={(l) => l.id}
          minWidth={560}
          empty={<EmptyState title={msg("riskPage.noLinks")}>{msg("riskPage.linkTheControlItThreatens")}</EmptyState>}
        />
      </Panel>
      <HistoryPanel key={version} call={call} path={`/api/v1/risks/${risk.key}/history`} />
      {can("admin") && (
        <div>
          <Button icon={<Trash2 />} onClick={() => setDialog("delete")}>
            {msg("riskPage.deleteRisk")}
          </Button>
        </div>
      )}
      {dialog === "edit" && <EditRiskDialog risk={risk} call={call} onClose={() => setDialog(undefined)} onSaved={saved} />}
      {dialog === "accept" && <AcceptDialog risk={risk} call={call} onClose={() => setDialog(undefined)} onSaved={saved} />}
      {dialog === "link" && <LinkDialog risk={risk} call={call} onClose={() => setDialog(undefined)} onSaved={saved} />}
      <Dialog
        open={dialog === "delete"}
        onOpenChange={(o) => !o && setDialog(undefined)}
        title={msg("riskPage.delete", { key: risk.key })}
        description={msg("riskPage.itsLinksAndHistoryAre")}
        footer={
          <>
            <Button type="button" onClick={() => setDialog(undefined)}>
              {msg("riskPage.cancel")}
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() =>
                void call(`/api/v1/risks/${risk.key}`, { method: "DELETE" }).then(
                  () => (reload(), navigate("/risks")),
                  (err: Error) => setError(err.message),
                )
              }
            >
              {msg("riskPage.delete2")}
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
  const t = useT();
  const [view, setView] = useState<"inherent" | "residual">("inherent");
  const [cells, setCells] = useState<HeatCell[]>();
  useEffect(
    () =>
      void call<{ cells: HeatCell[] }>(`/api/v1/heatmap?view=${view}`).then(
        (r) => setCells(r.cells),
        () => setCells([]),
      ),
    [call, view],
  );
  const at = (l: number, i: number) => cells?.find((c) => c.likelihood === l && c.impact === i);
  return (
    <>
      <PageHeader title={t("heatmapPage.heatMap")} description={t("heatmapPage.openRisksByLikelihoodAnd")} />
      <SegmentedControl
        label={t("heatmapPage.view")}
        value={view}
        onChange={setView}
        options={[
          { value: "inherent", label: t("heatmapPage.beforeTreatment") },
          { value: "residual", label: t("heatmapPage.afterTreatment") },
        ]}
      />
      <Panel>
        <div className="risk-heat">
          <span className="risk-heat-axis text-xs text-fg-muted">{t("heatmapPage.likelihood")}</span>
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
          <span className="text-center text-xs text-fg-muted">{t("heatmapPage.impact")}</span>
        </div>
      </Panel>
      <p className="m-0 text-xs text-fg-muted">{t("heatmapPage.bandsLowUnder5Medium")}</p>
    </>
  );
}

// ---------------------------------------------------------------- Vendors

const DATA_CLASSES = ["personal", "financial", "health", "credentials", "internal", "public"] as const;

function VendorDialog({ call, vendor, onClose, onSaved }: { call: Call; vendor?: Vendor; onClose: () => void; onSaved: (v: Vendor) => void }) {
  const t = useT();
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
      risks: risks
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
      ...(vendor
        ? { contact: contact.trim() || null, rating: rating || null }
        : { ...(contact.trim() && { contact: contact.trim() }), ...(rating && { rating }) }),
    };
    try {
      const v = vendor
        ? await call<Vendor>(`/api/v1/vendors/${vendor.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : await call<Vendor>("/api/v1/vendors", { method: "POST", body: JSON.stringify(body) });
      onSaved(v);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={vendor ? t("vendorDialog.change", { name: vendor.name }) : t("vendorDialog.addAVendor")}
      description={t("vendorDialog.aCompanyThatHoldsYour")}
      onSubmit={save}
      footer={
        <>
          <Button type="button" onClick={onClose}>
            {t("vendorDialog.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={!name.trim()}>
            {vendor ? t("vendorDialog.save") : t("vendorDialog.addVendor")}
          </Button>
        </>
      }
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <TextField label={t("vendorDialog.name")} value={name} onChange={(e) => setName(e.target.value)} />
        <TextField label={t("vendorDialog.service")} value={service} onChange={(e) => setService(e.target.value)} hint={t("vendorDialog.whatTheyDoForYou")} />
      </div>
      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
        <legend className="mb-1 text-sm font-medium">{t("vendorDialog.dataTheyHold")}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {DATA_CLASSES.map((c) => (
            <Checkbox
              key={c}
              label={label(c)}
              checked={classes.includes(c)}
              onChange={(e) => setClasses((xs) => (e.target.checked ? [...xs, c] : xs.filter((x) => x !== c)))}
            />
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-3 gap-2">
        <SelectField
          label={t("vendorDialog.criticality")}
          value={criticality}
          onChange={(e) => setCriticality(e.target.value as Band)}
          options={options(["low", "medium", "high", "critical"])}
        />
        <SelectField
          label={t("vendorDialog.status")}
          value={status}
          onChange={(e) => setStatus(e.target.value as Vendor["status"])}
          options={options(["onboarding", "active", "offboarding"])}
        />
        <SelectField
          label={t("vendorDialog.questionnaire")}
          value={questionnaire}
          onChange={(e) => setQuestionnaire(e.target.value as Vendor["questionnaire"])}
          options={options(["not-sent", "sent", "received", "reviewed"])}
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <SelectField
          label={t("vendorDialog.rating")}
          value={rating}
          onChange={(e) => setRating(e.target.value)}
          options={[{ value: "", label: t("vendorDialog.notRated") }, ...options(["low", "medium", "high"])]}
        />
        <TextField label={t("vendorDialog.reviewEveryDays")} inputMode="numeric" value={interval} onChange={(e) => setIntervalDays(e.target.value)} />
        <TextField label={t("vendorDialog.contact")} value={contact} onChange={(e) => setContact(e.target.value)} />
      </div>
      <TextField label={t("vendorDialog.risks")} value={risks} onChange={(e) => setRisks(e.target.value)} hint={t("vendorDialog.keysOfTheRisksThey")} />
      <TextArea label={t("vendorDialog.notes")} value={notes} onChange={setNotes} />
      {error && <p className="m-0 text-xs text-danger">{error}</p>}
    </Dialog>
  );
}

function VendorsPage({ call, reload }: { call: Call; reload: () => void }) {
  const t = useT();
  const { can } = useAuth();
  const [rows, setRows] = useState<Vendor[]>();
  const [q, setQ] = useState("");
  const [crit, setCrit] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    const p = new URLSearchParams({ limit: "500", ...(q.trim() && { q: q.trim() }), ...(crit.length && { criticality: crit.join(",") }) });
    void call<{ vendors: Vendor[] }>(`/api/v1/vendors?${p}`).then(
      (r) => setRows(r.vendors),
      () => setRows([]),
    );
  }, [call, q, crit]);
  const columns: Column<Vendor>[] = [
    {
      id: "name",
      header: t("vendorsPage.vendor"),
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
    {
      id: "crit",
      header: t("vendorsPage.criticality"),
      sortValue: (v) => BANDS.indexOf(v.criticality),
      cell: (v) => <SeverityBadge severity={v.criticality} />,
    },
    { id: "data", header: t("vendorsPage.data"), cell: (v) => <span className="text-xs">{v.dataClasses.map(label).join(", ") || "–"}</span> },
    { id: "status", header: t("vendorsPage.status"), cell: (v) => <Badge>{label(v.status)}</Badge> },
    {
      id: "rating",
      header: t("vendorsPage.rating"),
      cell: (v) =>
        v.rating ? (
          <StatusBadge tone={v.rating === "high" ? "danger" : v.rating === "medium" ? "warning" : "success"}>{label(v.rating)}</StatusBadge>
        ) : (
          <span className="text-xs text-fg-muted">{t("vendorsPage.notRated")}</span>
        ),
    },
    { id: "review", header: t("vendorsPage.nextReview"), sortValue: (v) => v.nextReview, cell: (v) => <Due date={v.nextReview} overdue={v.overdue} /> },
  ];
  return (
    <>
      <PageHeader
        title={t("vendorsPage.vendors")}
        description={t("vendorsPage.whoHoldsYourDataOr")}
        actions={
          <>
            <SearchInput label={t("vendorsPage.searchVendors")} className="w-56" value={q} onChange={(e) => setQ(e.target.value)} />
            {can("editor") && (
              <Button variant="primary" icon={<Plus />} onClick={() => setAdding(true)}>
                {t("vendorsPage.addVendor")}
              </Button>
            )}
          </>
        }
      />
      <FilterBar onClear={() => setCrit([])}>
        <FacetFilter label={t("vendorsPage.criticality")} selected={crit} onChange={setCrit} options={BANDS.map((b) => ({ value: b, label: label(b) }))} />
      </FilterBar>
      <Panel flush>
        <DataTable
          label={t("vendorsPage.vendors")}
          columns={columns}
          rows={rows ?? []}
          loading={!rows}
          getRowId={(v) => v.id}
          minWidth={860}
          pageSize={50}
          empty={<EmptyState title={t("vendorsPage.noVendors")}>{t("vendorsPage.addTheCompaniesThatHold")}</EmptyState>}
        />
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
  const ago = useAgo();
  const t = useT();
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
      <EmptyState title={t("vendorPage.vendorNotFound")}>
        {t("vendorPage.itMayHaveBeenDeleted")} <a href="/vendors">{t("vendorPage.backToVendors")}</a>.
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
                {t("vendorPage.markReviewed")}
              </Button>
            )}
            {can("editor") && <Button onClick={() => setDialog("edit")}>{t("vendorPage.change")}</Button>}
          </span>
        }
      />
      {error && <p className="m-0 text-sm text-danger">{error}</p>}
      <KpiGrid minWidth={150}>
        <KpiCard label={t("vendorPage.status")} value={label(vendor.status)} />
        <KpiCard label={t("vendorPage.questionnaire")} value={label(vendor.questionnaire)} />
        <KpiCard label={t("vendorPage.rating")} value={vendor.rating ? label(vendor.rating) : "Not rated"} />
        <KpiCard
          label={t("vendorPage.nextReview")}
          value={day(vendor.nextReview)}
          tone={vendor.overdue ? "warning" : undefined}
          footer={vendor.lastReview ? t("vendorPage.last", { day: day(vendor.lastReview) }) : t("vendorPage.neverReviewed")}
        />
      </KpiGrid>
      <div className="grid gap-2.5 lg:grid-cols-2">
        <Panel title={t("vendorPage.dataTheyHold")}>
          {vendor.dataClasses.length ? (
            <div className="flex flex-wrap gap-1">
              {vendor.dataClasses.map((c) => (
                <Badge key={c}>{label(c)}</Badge>
              ))}
            </div>
          ) : (
            <p className="m-0 text-sm text-fg-muted">{t("vendorPage.noneRecorded")}</p>
          )}
          {vendor.notes && <p className="risk-prose mt-3 mb-0 text-sm">{vendor.notes}</p>}
        </Panel>
        <Panel title={t("vendorPage.risksTheyBring")}>
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
            <p className="m-0 text-sm text-fg-muted">{t("vendorPage.noRiskLinkedAddTheir")}</p>
          )}
        </Panel>
      </div>
      <Panel
        title={t("vendorPage.documents")}
        description={t("vendorPage.linksToReportsCertificatesAnd")}
        footer={
          can("editor") ? (
            <Button size="sm" icon={<Plus />} onClick={() => setDialog("doc")}>
              {t("vendorPage.addDocumentLink")}
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
                  <IconButton
                    label={t("vendorPage.remove", { title: d.title })}
                    size="sm"
                    onClick={() => void act(`/api/v1/vendors/${vendor.id}/documents/${d.id}`, { method: "DELETE" })}
                  >
                    <X />
                  </IconButton>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-sm text-fg-muted">{t("vendorPage.noDocumentsYetASoc")}</p>
        )}
      </Panel>
      <HistoryPanel key={version} call={call} path={`/api/v1/vendors/${vendor.id}/history`} />
      {can("admin") && (
        <div>
          <Button icon={<Trash2 />} onClick={() => setDialog("delete")}>
            {t("vendorPage.deleteVendor")}
          </Button>
        </div>
      )}
      {dialog === "edit" && <VendorDialog call={call} vendor={vendor} onClose={() => setDialog(undefined)} onSaved={saved} />}
      <Dialog
        open={dialog === "doc"}
        onOpenChange={(o) => !o && setDialog(undefined)}
        title={t("vendorPage.addADocumentLink")}
        onSubmit={(e) => (
          e.preventDefault(),
          void act(`/api/v1/vendors/${vendor.id}/documents`, { method: "POST", body: JSON.stringify({ title: docTitle, url: docUrl }) })
        )}
        footer={
          <>
            <Button type="button" onClick={() => setDialog(undefined)}>
              {t("vendorPage.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={!docTitle.trim() || !/^https?:\/\//.test(docUrl.trim())}>
              {t("vendorPage.add")}
            </Button>
          </>
        }
      >
        <TextField label={t("vendorPage.title")} value={docTitle} onChange={(e) => setDocTitle(e.target.value)} hint={t("vendorPage.suchAsSoc2Type")} />
        <TextField label={t("vendorPage.address")} value={docUrl} onChange={(e) => setDocUrl(e.target.value)} hint={t("vendorPage.whereTheDocumentIsKept")} />
      </Dialog>
      <Dialog
        open={dialog === "delete"}
        onOpenChange={(o) => !o && setDialog(undefined)}
        title={t("vendorPage.delete", { name: vendor.name })}
        description={t("vendorPage.itsDocumentsAndHistoryAre")}
        footer={
          <>
            <Button type="button" onClick={() => setDialog(undefined)}>
              {t("vendorPage.cancel")}
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() =>
                void call(`/api/v1/vendors/${vendor.id}`, { method: "DELETE" }).then(
                  () => (reload(), navigate("/vendors")),
                  (err: Error) => setError(err.message),
                )
              }
            >
              {t("vendorPage.delete2")}
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
  const t = useT();
  const origin = window.location.origin;
  return (
    <>
      <PageHeader title={t("setupPage.setup")} description={t("setupPage.theRegisterIsKeptBy")} />
      <Panel title={t("setupPage.openARiskFromAnother")} description={t("setupPage.withAnApiTokenWith")}>
        <Code>{`curl -sf -X POST -H "Authorization: Bearer $RISK_API_TOKEN" -H 'content-type: application/json' \\
  -d '{"title":"Unpatched OpenSSL on the payment hosts","category":"security","likelihood":4,"impact":4,
       "external":{"source":"vulnerabilities","reference":"CVE-2026-1234"}}' \\
  "${origin}/api/v1/risks"`}</Code>
      </Panel>
      <Panel title={t("setupPage.whatToKnow")}>
        <ul className="risk-list flex flex-col gap-1 text-sm text-fg-muted">
          <li>{t("setupPage.theScoreIsLikelihoodTimes")}</li>
          <li>{t("setupPage.acceptingARiskNeedsA")}</li>
          <li>{t("setupPage.risksAndVendorsHaveA")}</li>
          <li>{t("setupPage.everyChangeIsKeptIn")}</li>
        </ul>
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------- Shell

/** Account, Members, Sign-in and API tokens: the screens come from @openasy/auth. */
function SettingsPage({ page }: { page: "account" | "members" | "signin" | "tokens" }) {
  const t = useT();
  const { signOut, can } = useAuth();
  if (page !== "account" && !can("admin")) return <EmptyState title={t("settingsPage.adminsOnly")}>{t("settingsPage.askAnAdminOfThis")}</EmptyState>;
  const titles = {
    account: ["Account", "Your profile, password, two-step verification and where you are signed in."],
    members: [
      "Members",
      "Who can sign in to this risk, and with which role. Viewers see everything; editors also add and change risks and vendors and mark reviews; admins also accept and delete risks, delete vendors, and manage members and tokens.",
    ],
    signin: [
      "Sign-in",
      "Identity providers people can sign in with, such as OpenAsy Identity, Keycloak or Microsoft Entra ID, and which of their groups give which role.",
    ],
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
              {t("settingsPage.signOut")}
            </Button>
          )
        }
      />
      {page === "account" ? <AccountSettings /> : page === "members" ? <MembersSettings /> : page === "signin" ? <SignInSettings /> : <TokensSettings />}
    </>
  );
}

function Product() {
  const msg = useT();
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
    { id: "risks", label: msg("product.register"), icon: ClipboardCheck, count: summary?.risks.open },
    { id: "heatmap", label: msg("product.heatMap"), icon: Grid3x3 },
    { id: "vendors", label: msg("product.vendors"), icon: Building2, count: summary?.vendors.total },
  ];
  const footerNav = [
    { id: "setup", label: msg("product.setup"), icon: Settings2 },
    ...(can("admin")
      ? [
          { id: "members", label: msg("product.members"), icon: Users },
          { id: "signin", label: msg("product.signIn"), icon: LogIn },
          { id: "tokens", label: msg("product.apiTokens"), icon: KeyRound },
        ]
      : []),
    { id: "account", label: msg("product.account"), icon: UserRound },
  ];
  const active = route.page === "risk" ? "risks" : route.page === "vendor" ? "vendors" : route.page;
  const roleName = me.user.role.charAt(0).toUpperCase() + me.user.role.slice(1);

  return (
    <AppShell
      product="risk"
      about={colophon}
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
  const installBrand = useInstallBrand();
  const [theme] = useThemePreference();
  return (
    // The install's brand from config/brand.env (ADR 0053); OpenAsy's own look where it sets none.
    <BrandProvider theme={theme} brand={{ name: "OpenAsy", organization: undefined, ...installBrand }} className="min-h-screen">
      <AuthGate product="OpenAsy Risk">
        <Product />
      </AuthGate>
    </BrandProvider>
  );
}
