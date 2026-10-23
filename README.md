# risk

[![CI](https://github.com/openasy/risk/actions/workflows/ci.yml/badge.svg)](https://github.com/openasy/risk/actions/workflows/ci.yml)
[![Node.js 26 LTS](https://img.shields.io/badge/node-26%20LTS-339933?logo=nodedotjs&logoColor=white)](./.nvmrc)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)](./LICENSE)

The [OpenAsy](https://github.com/openasy) Risk product: **the risk register and vendor reviews, linked to controls and
findings, with a history nobody edits** (ADR 0049). What could go wrong, how bad it would be, what is being done about
it, who decided to live with it and until when.

```
people ─────────────────────────┐
other products (API token) ─────┼─▶ risk ──▶ register · heat map · vendors · reviews due · history
  a finding nobody fixes        ┘            └── /metrics: open risks by band, overdue reviews
```

## Risks

- **A risk** has an `R-n` key, a title and description, a category (strategic, operational, security, compliance,
  vendor, other), an owner, a plan and tags. Anywhere a risk id is accepted, its key is too.
- **The score** is likelihood times impact, each 1 to 5. Bands: low under 5, medium from 5, high from 10, critical
  from 17. A treatment (mitigate, transfer, accept, avoid) can give a **residual** score, where the risk is after it.
- **Status** goes identified, assessing, treating, closed. **Accepting** a risk is a decision somebody answers for:
  it needs a reason, an approver and an end at most 366 days away, and only admins make it. When the acceptance ends,
  the risk is `review-due` until someone accepts it again or changes its status.
- **Reviews.** Each risk has a review interval (90 days by default); marking it reviewed moves the next date. Overdue
  reviews show on the register, together with the vendors that are due.
- **Links** to controls, findings, incidents or vendors in other products. They are references only: nothing is
  fetched from the other product.
- The **heat map** places open risks by likelihood and impact, before or after treatment.

## Vendors

A vendor is a company that holds your data or runs part of your service: what it does, the data classes it holds
(personal, financial, health, credentials, internal, public), its criticality, the state of its questionnaire, a
rating, the risks it brings and links to its documents (a SOC 2 report, an ISO certificate, the data processing
agreement). Nothing is stored or fetched from those links. Vendors are reviewed every 365 days by default.

## History

Every change to a risk or a vendor is written to its history with who made it and what changed. The database refuses
to change or delete a history row; it goes only when its risk or vendor is deleted. To keep the record, close a risk
or set a vendor to offboarding instead.

## Other products open risks

Create an API token with the editor role under API tokens, and send it to the API (ADR 0023). A product sets
`external` so one problem is one risk, however often it reports: the same `source` and `reference` adds a line to the
first risk's history and answers 200 instead of opening a second.

```bash
curl -sf -X POST -H "Authorization: Bearer $RISK_API_TOKEN" -H 'content-type: application/json' \
  -d '{"title":"Unpatched OpenSSL on the payment hosts","category":"security","likelihood":4,"impact":4,
       "external":{"source":"vulnerabilities","reference":"CVE-2026-1234"}}' \
  https://risk.example.com/api/v1/risks
```

## Run

```bash
openssl rand -hex 32 > openasy-kek
docker compose up -d
docker compose logs risk | grep 'no owner yet'
```

Open the link from the log once to create the owner account; there is no default password (ADR 0013). The UI and API
are on http://localhost:8080, the API reference at http://localhost:8080/api/docs/.

`openasy-kek` encrypts sign-in secrets in the database (ADR 0021). Keep it apart from the volume and with your backups.

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `8080` | HTTP port |
| `RISK_PUBLIC_URL` | `http://localhost:8080` | The address people open, with `https://` behind your TLS proxy |
| `OPENASY_PRODUCTS` | | The install's other OpenAsy products, for the product switcher. Give every product the same value |
| `RISK_SECRETS_KEY_FILE` | `/run/secrets/openasy-kek` | 32-byte key-encryption key |
| `RISK_DB` | `/data/risk.db` | SQLite file (WAL), on the `/data` volume |
| `RISK_METRICS_PORT` | | Serve `/metrics` on this port only (ADR 0026) |
| `RISK_HEADLESS` | `false` | `true` serves only the API |
| `RISK_PASSWORD_SIGN_IN`, `OPENASY_OIDC_*` | | Sign-in, as in every OpenAsy product ([@openasy/auth](https://github.com/openasy/auth)) |

Nothing is deleted on a schedule: a register is a record. `/metrics` has `openasy_risk_open_risks{band}`,
`openasy_risk_overdue_reviews`, `openasy_risk_review_due`, `openasy_risk_accepted`, `openasy_risk_vendors` and
`openasy_risk_vendor_reviews_overdue`, to alert on in your own Prometheus.

The container runs as non-root with a read-only root filesystem, no capabilities and `no-new-privileges`.

## Roles

Viewers read everything; editors also add and change risks and vendors, link them and mark reviews; admins also accept
and delete risks, delete vendors, and manage members and API tokens (ADR 0003).

## Develop

```bash
npm install
npm test        # scores and bands, acceptance and its end, reviews, the history nobody edits, and every API response against openapi.json
npm run dev     # the UI, with the API on :8080
```

## Licence

AGPL-3.0 (ADR 0008).
