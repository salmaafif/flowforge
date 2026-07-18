# FlowForge

Real-time, multi-tenant **workflow orchestration engine** — define workflows as DAGs,
execute them with retries/timeouts/parallelism, and monitor runs live. A self-hosted
blend of Zapier's workflow model and GitHub Actions' execution model.

---

## Contents

- [Features](#features)
- [Tech stack & why](#tech-stack--why)
- [Architecture](#architecture)
- [Getting started](#getting-started)
- [API reference](#api-reference)
- [Testing](#testing)
- [Database & migrations](#database--migrations)
- [Trade-offs & future work](#trade-offs--future-work)
- [Further docs](#further-docs)

---

## Features

| Area | What it does |
| --- | --- |
| **DAG engine** | Workflows are DAGs of typed steps (HTTP, SCRIPT, DELAY, CONDITION). The engine topologically sorts the graph, runs independent steps **in parallel**, honors dependencies, retries with **exponential/fixed backoff**, and enforces a **global timeout**. Cycles are rejected at validation time. |
| **Conditional branching** | A `CONDITION` step that evaluates false **prunes** its downstream branch (dependent steps are skipped). |
| **Multi-tenant API** | Strict per-tenant isolation on every entity and query. Workflow CRUD + append-only **version history** with **rollback**. Manual / **cron** / **webhook** triggers. Pagination, filtering, and rate limiting on list endpoints. |
| **AuthN/Z** | JWT auth; **RBAC** with Admin / Editor / Viewer. All input validated & sanitized with **Zod**. |
| **Real-time dashboard** | React SPA: live run/step status over **SSE**, visual **DAG rendering** (React Flow), run history, and a global **health panel** (active runs, success/failure rate, avg exec time over 24h). Client caching + optimistic updates via TanStack Query. |
| **AI failure analysis** | On a failed run, an LLM (**Groq**, Llama 3.3 70B) produces a structured root-cause analysis with guarded, validated JSON output. Degrades gracefully to `503` when unconfigured. |
| **Data layer** | Relational schema (tenants, users, workflows + versions, runs + steps). High-volume execution logs live in a **time-partitioned** append-only table. A composite index accelerates the health panel (**~69× faster**, measured). |
| **Infra & CI** | Multi-stage Dockerfiles, full `docker-compose`, and a GitHub Actions pipeline (lint · test · integration/E2E · build · docker). |

Requirement coverage: A (engine) · B (multi-tenant API) · C (realtime dashboard) ·
D (data layer) · E (infra) · F (quality/tests/docs) · G (AI enhancement).

---

## Tech stack & why

| Layer | Choice | Why |
| --- | --- | --- |
| Language/runtime | **TypeScript + Node.js** | One language across backend & frontend; async I/O fits HTTP-call steps and SSE. |
| API framework | **NestJS** | Modular DI with first-class guards / interceptors / pipes for RBAC, validation, and rate limiting. |
| Validation | **Zod** | Schema-based validation + inferred types, so runtime checks and compile-time types can't drift. |
| Database | **PostgreSQL + Prisma** | Relational integrity for the workflow→version→run→step graph; JSONB for DAG definitions; type-safe migrations. |
| Log store | **Partitioned Postgres table** | High write volume handled by monthly partitioning without a second datastore to operate. |
| Realtime | **Server-Sent Events** | One-way server→client push; simpler than WebSockets and proxy/CDN-friendly. |
| Frontend | **React + Vite + TanStack Query + React Flow** | Fast dev loop; built-in client caching/optimistic updates; ready-made DAG rendering. |
| AI | **Groq (Llama 3.3 70B)** | Fast, reliable structured-output completions on a free tier; swappable behind a service boundary. |
| Infra/CI | **Docker · docker-compose · GitHub Actions** | Reproducible local stack and automated quality gates. |

There is deliberately **no message broker** — realtime fan-out is in-process and
execution is not queue-distributed at this scale. The seams to add one (Redis/SQS)
later exist behind interfaces. See [docs/infrastructure.md §6](docs/infrastructure.md).

---

## Architecture

```
Browser (React SPA)
   │  same-origin HTTP + SSE
   ▼
nginx (serves SPA, reverse-proxies API)      ← frontend container
   │
   ▼
NestJS API  ──►  PostgreSQL (Prisma)          ← backend + db containers
   │  ├─ DAG engine (parallel, retry, timeout)
   │  ├─ SSE run events (in-process pub/sub)
   │  ├─ cron scheduler (@nestjs/schedule)
   │  └─ AI failure analysis ──► Groq API
```

- The **engine** is pure and storage-agnostic (returns a result + emits events);
  persistence and SSE are layered on top, so it stays unit-testable without a DB.
- **Triggering is fire-and-forget**: the API creates the run (`RUNNING`) and responds
  `202` immediately; execution continues in the background and the final result is
  reconciled into the run/step records in one transaction.

Repository layout:

```
flowforge/
├── backend/     # NestJS API + workflow engine (src/), Prisma schema & migrations, tests
├── frontend/    # React dashboard (Vite), nginx.conf for production
├── docs/        # Infrastructure, query optimization, and partitioning design docs
├── docker-compose.yml
└── .github/workflows/ci.yml
```

---

## Getting started

### Prerequisites

- **Node.js ≥ 22** and npm (for local dev)
- **Docker Desktop** (for the containerized stack / local Postgres)

### Option A — full stack with Docker

```bash
docker compose up -d --build
```

This starts Postgres, runs migrations + seed (one-shot `migrate` service), then the
API and web app. Once up:

- Web app → <http://localhost:8080>
- API → <http://localhost:3000> (e.g. `GET /health`)

### Option B — local dev (hot reload)

```bash
npm install                      # installs both workspaces

docker compose up -d db          # just Postgres (host port 5433)
cp backend/.env.example backend/.env

npm run --workspace=@flowforge/backend prisma:migrate    # apply migrations
npm run --workspace=@flowforge/backend db:seed           # seed demo data

npm run --workspace=@flowforge/backend start:dev         # API on :3000
npm run --workspace=@flowforge/frontend dev              # SPA on :5173 (proxies API)
```

> Postgres uses host port **5433** to avoid clashing with a default local Postgres on 5432.

### Demo credentials

Seeded tenants — password `password123` for all users:

| tenantSlug | email | role |
| --- | --- | --- |
| `salma` | admin@salma.test | Admin |
| `salma` | editor@salma.test | Editor |
| `salma` | viewer@salma.test | Viewer |
| `tavi` | admin@tavi.test | Admin |

### Configuration (`backend/.env`)

| Var | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. |
| `PORT` | API port (default 3000). |
| `JWT_SECRET` / `JWT_EXPIRES_IN` | Access-token signing secret / lifetime. |
| `GROQ_API_KEY` / `GROQ_MODEL` | AI failure analysis (optional; feature returns `503` when unset). |

---

## API reference

All routes require a `Bearer` token except those marked **public**. Writes require
`Editor`; destructive actions require `Admin`.

| Method & path | Role | Purpose |
| --- | --- | --- |
| `POST /auth/login` | public | Exchange `{ tenantSlug, email, password }` for a JWT. |
| `GET /health` | public | Liveness probe. |
| `GET /workflows` | Viewer+ | List workflows (paginated: `?page=&pageSize=`). |
| `POST /workflows` | Editor | Create a workflow + its first version. |
| `GET /workflows/:id` | Viewer+ | Get one workflow. |
| `PATCH /workflows/:id` | Editor | Update workflow metadata / cron. |
| `DELETE /workflows/:id` | Admin | Delete a workflow. |
| `POST /workflows/:id/versions` | Editor | Publish a new version. |
| `GET /workflows/:id/versions` | Viewer+ | List version history. |
| `POST /workflows/:id/versions/:v/rollback` | Editor | Roll back (appends a new version). |
| `POST /workflows/:id/webhook` | Editor | Enable a webhook token. |
| `DELETE /workflows/:id/webhook` | Editor | Disable the webhook. |
| `POST /workflows/:id/trigger` | Editor | Manually trigger a run (`202 Accepted`). |
| `GET /workflows/:id/runs` | Viewer+ | Run history for a workflow (paginated). |
| `GET /runs/:id` | Viewer+ | Run detail incl. steps and executed definition. |
| `POST /runs/:id/analysis` | Viewer+ | AI failure analysis for a run. |
| `POST /hooks/:token` | public | Webhook trigger (token is the credential, `202`). |
| `GET /events/runs` (SSE) | Viewer+ | Live run/step event stream (`?access_token=`). |

---

## Testing

```bash
npm run --workspace=@flowforge/backend test        # unit (DAG parser + engine + services)
npm run --workspace=@flowforge/backend test:e2e    # integration (API) + E2E (full run) — needs Postgres
npm run --workspace=@flowforge/frontend typecheck
npm run format:check                                # prettier
```

- **Unit** (141 tests): DAG parsing/validation/topological sort, retry/backoff, timeout,
  each step executor, and every service (mocked Prisma).
- **Integration** (12 tests): the real HTTP stack — JWT + RBAC guards, Zod validation,
  pagination, and **cross-tenant isolation** — against a live throwaway Postgres.
- **E2E** (2 tests): create a workflow via the API, trigger it, and follow the real
  background execution to completion — covering parallel branches, conditional skips,
  and retry→failure propagation.

The e2e suite creates its own `flowforge_test` database, applies migrations, and
truncates between tests; it never touches the dev database. All of this runs in CI.

---

## Database & migrations

- Schema and migrations live in [`backend/prisma`](backend/prisma). Apply with
  `prisma migrate deploy` (prod) or `prisma migrate dev` (local).
- **Migration 2** adds a composite health-panel index — see
  [docs/query-optimization.md](docs/query-optimization.md) for the `EXPLAIN` evidence.
- **Migration 3** converts `execution_logs` into a monthly range-partitioned table —
  see [docs/execution-logs-partitioning.md](docs/execution-logs-partitioning.md).

---

## Trade-offs & future work

- **In-process execution & SSE** — simple and correct on a single instance. Scaling
  the API horizontally needs a shared pub/sub (Redis) for SSE fan-out and a dedicated
  single-replica scheduler; both slot behind existing interfaces. (infrastructure.md §5)
- **Fire-and-forget runs** — a run does not survive an API restart mid-execution. A
  durable queue (BullMQ/SQS) would make execution crash-safe.
- **SCRIPT/CONDITION sandbox** — user code runs in an isolated Node child process with
  a hard timeout, capped heap, and scrubbed env (trusted-within-tenant model, like
  GitHub Actions). Stronger isolation (locked-down container, dropped syscalls) is the
  next hardening step.
- **Execution logs** — the partitioned store and its indexes exist and are verified;
  wiring the engine to emit per-step logs into it is the remaining step.
- **AI analysis** — currently synchronous; could be queued for very large runs.
- **GraphQL** — a GraphQL endpoint (bonus) is not implemented.

---

## Further docs

- [docs/infrastructure.md](docs/infrastructure.md) — production AWS design, scaling, security, CI/CD.
- [docs/query-optimization.md](docs/query-optimization.md) — the health-panel index, with `EXPLAIN` before/after.
- [docs/execution-logs-partitioning.md](docs/execution-logs-partitioning.md) — the partitioned log store.
- [REVIEW.md](REVIEW.md) — a worked code review of a flawed snippet.
