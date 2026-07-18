# Code Review

A worked review of a flawed snippet, in the style of a PR review: findings ranked by
severity, each with the concrete failure it causes and a suggested fix. The snippet is
a plausible first cut of a "trigger a run / list runs" controller for FlowForge.

---

## Snippet under review

```ts
 1  @Controller('workflows')
 2  export class WorkflowRunsController {
 3    constructor(
 4      private readonly prisma: PrismaService,
 5      private readonly engine: WorkflowEngine,
 6    ) {}
 7
 8    // POST /workflows/:id/trigger
 9    @Post(':id/trigger')
10    async trigger(@Param('id') id: string, @Body() body: any, @Req() req: any) {
11      const workflow = await this.prisma.workflow.findUnique({ where: { id } });
12      if (!workflow) throw new NotFoundException();
13
14      const version = await this.prisma.workflowVersion.findFirst({
15        where: { workflowId: id },
16        orderBy: { version: 'desc' },
17      });
18
19      const run = await this.prisma.run.create({
20        data: {
21          tenantId: workflow.tenantId,
22          workflowId: id,
23          workflowVersionId: version.id,
24          status: 'RUNNING',
25          trigger: 'MANUAL',
26        },
27      });
28
29      this.engine.execute(version.definition, body);
30
31      return run;
32    }
33
34    // GET /workflows/:id/runs?limit=...
35    @Get(':id/runs')
36    async listRuns(@Param('id') id: string, @Query('limit') limit: string) {
37      const runs = await this.prisma.$queryRawUnsafe(
38        `SELECT * FROM runs WHERE "workflowId" = '${id}' ORDER BY "createdAt" DESC LIMIT ${limit}`,
39      );
40      return runs;
41    }
42  }
```

## Verdict

**Request changes.** Two of the findings are security-critical (broken tenant
isolation and SQL injection) and would be blockers on their own. There are also a
crash path, a missing authorization check, and correctness gaps. Details below,
most-severe first.

---

## Findings

### 1. 🔴 Critical — Broken tenant isolation

**Where:** lines 11, 14, 38.

`findUnique({ where: { id } })` and the raw query filter only by workflow/`id`, never
by the caller's tenant. Any authenticated user can trigger or read the runs of **any
tenant's** workflow just by knowing (or guessing) an id. This defeats the core
multi-tenant guarantee.

**Failure scenario:** a Viewer in tenant B calls `POST /workflows/<tenant-A-id>/trigger`
and executes tenant A's workflow; or `GET /workflows/<tenant-A-id>/runs` and reads
tenant A's run history.

**Fix:** always scope by the authenticated principal's `tenantId`.

```ts
const workflow = await this.prisma.workflow.findFirst({
  where: { id, tenantId: user.tenantId },
});
if (!workflow) throw new NotFoundException(); // 404, not 403 — don't reveal existence
```

Return `404` (not `403`) for a foreign id so the API doesn't leak which ids exist.

### 2. 🔴 Critical — SQL injection

**Where:** lines 37–39.

`$queryRawUnsafe` interpolates `id` and `limit` — both raw request input — directly
into SQL. `id = "' OR '1'='1"` dumps every tenant's runs; worse payloads can run
sub-queries.

**Failure scenario:** `GET /workflows/'%20OR%20'1'%3D'1/runs?limit=100` returns rows
across all tenants.

**Fix:** don't build SQL by hand — use the query builder (which parameterizes), or a
parameterized raw query at minimum.

```ts
return this.prisma.run.findMany({
  where: { workflowId: id, tenantId: user.tenantId },
  orderBy: { createdAt: 'desc' },
  take,
});
```

### 3. 🟠 High — Unvalidated `limit`: unbounded page size + type bug

**Where:** lines 36, 38.

`limit` is an untrusted string spliced into `LIMIT ${limit}`. Beyond the injection
above, there's no upper bound (`?limit=1000000` is a cheap DoS / memory spike) and no
coercion (a non-numeric value produces a SQL error → `500`).

**Fix:** validate and cap. Reuse the project's pagination schema (Zod) so every list
endpoint behaves the same:

```ts
const take = Math.min(Number(limit) || 20, 100);
```

### 4. 🟠 High — `version.id` can throw (null dereference)

**Where:** lines 14–23.

`findFirst` returns `null` when the workflow has no version yet; line 23 then reads
`version.id` and throws a `TypeError`, surfacing as an unhandled `500`. The `enabled`
flag is also ignored, so **disabled** workflows still run.

**Fix:**

```ts
if (!workflow.enabled) throw new ConflictException('Workflow is disabled');
const version = await this.prisma.workflowVersion.findFirst({ ... });
if (!version) throw new ConflictException('Workflow has no published version');
```

### 5. 🟠 High — Missing authorization (RBAC)

**Where:** line 9.

Triggering a run is a write/execute action, but there's no role restriction, so a
**Viewer** can trigger runs. Per the project's RBAC, this should require `Editor`.

**Fix:** `@Roles(Role.EDITOR)` on `trigger` (and confirm the global `RolesGuard` runs).

### 6. 🟡 Medium — Fire-and-forget with no error handling; run can hang in `RUNNING`

**Where:** line 29.

`this.engine.execute(...)` is a floating promise: it isn't awaited and has no
`.catch`. If it rejects, the rejection is unhandled and the run stays `RUNNING`
**forever** (nothing ever writes a terminal status). Background execution is fine, but
it must reconcile the run on both success and failure.

**Fix:** delegate to a method that persists the outcome and always marks a terminal
state, e.g. `void this.executeAndPersist(run.id, ...).catch(logAndMarkFailed)`.

### 7. 🟡 Medium — Steps are never created; run detail is inconsistent

**Where:** lines 19–27.

The run is created without its `RunStep` rows, so the dashboard's DAG view and the
per-step status have nothing to render, and `persistResult` later can't match steps by
key. Create the `PENDING` steps from the definition inside the same create.

### 8. 🔵 Low — Untyped input & leaky response shape

**Where:** lines 10, 29, 38, 40.

- `@Body() body: any` / `@Req() req: any` skip validation and typing — validate the
  trigger payload with a Zod pipe and type the principal via `@CurrentUser()`.
- `SELECT *` returns raw DB rows (all columns, internal shape). Prefer selecting the
  fields the client needs and returning a typed DTO.

---

## What's good

- The controller correctly returns `202`-style "create then run in background" shape
  conceptually (create the run, respond, execute async).
- Fetching the latest version via `orderBy: { version: 'desc' }` is the right way to
  resolve "current" given the append-only versioning model.

## Summary

| # | Severity | Issue |
| --- | --- | --- |
| 1 | Critical | No tenant scoping on reads/writes |
| 2 | Critical | SQL injection via `$queryRawUnsafe` |
| 3 | High | Unvalidated, uncapped `limit` |
| 4 | High | `version` null-deref + ignores `enabled` |
| 5 | High | Missing RBAC on trigger |
| 6 | Medium | Floating promise; run can hang in `RUNNING` |
| 7 | Medium | Steps never created |
| 8 | Low | Untyped input; `SELECT *` leaks shape |

The security findings (1, 2) must be fixed before merge; the rest should follow in the
same change since they're all in this handler.
