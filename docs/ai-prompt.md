# AI Prompts & Prompt Engineering

> Requirement G. FlowForge ships **two** LLM-powered features on Groq (Llama 3.3
> 70B), both behind one Groq client and the same layered output-guard strategy:
>
> 1. **Intelligent failure analysis** — when a run fails, diagnose why and suggest a
>    fix. ([`failure-analysis.service.ts`](../backend/src/ai/failure-analysis.service.ts))
> 2. **Natural-language workflow builder** — describe a workflow in plain English
>    and get a valid DAG definition back.
>    ([`workflow-generator.service.ts`](../backend/src/ai/workflow-generator.service.ts))
>
> Shared client: [`groq.client.ts`](../backend/src/ai/groq.client.ts).

---

## Shared design

Both features use the same three principles:

- **JSON mode at the source.** Every call sets
  `response_format: { type: "json_object" }`, so the response is always
  *syntactically* valid JSON — no markdown or free text.
- **Re-validate the shape with Zod.** JSON mode does not enforce a *schema* (unlike
  Gemini's `responseSchema`), so the parsed object is always re-validated against a
  Zod schema. A model that ignores the contract fails here.
- **Fail closed.** Any transport error, non-2xx, unparseable body, or failed
  validation maps to a clean HTTP **502** — raw model text never reaches the client.
  With no API key configured, the endpoints answer **503** and the rest of the app
  is unaffected.

| Setting | Value |
| --- | --- |
| Provider | Groq (OpenAI-compatible `/chat/completions`) |
| Model | `llama-3.3-70b-versatile` (`GROQ_MODEL`, overridable) |
| Response format | `json_object` (JSON mode) |
| API key | `GROQ_API_KEY` (features return `503` when unset) |

---

## Feature 1 — Intelligent failure analysis

### System prompt (fixed)

Pins the assistant's role, domain, and the exact output contract; never varies
between requests.

```text
You are the failure-analysis assistant of FlowForge, a workflow orchestration
platform where DAGs of steps (HTTP calls, sandboxed Node.js scripts, delays,
conditional branches) run with per-step retries and a global timeout. Diagnose
why the given run failed. Be specific: name the step keys involved, distinguish
transient causes (network, rate limits) from permanent ones (wrong URL, bad
expression, bug in script code), and suggest the smallest concrete fix. If retries
were exhausted on a transient-looking error, say so. Respond with ONLY a JSON
object (no markdown, no prose outside it) with exactly these string fields:
"summary", "rootCause", "suggestedFix", and "confidence" (one of "low", "medium",
or "high").
```

### User message (per-run context)

The volatile run data travels in the **user turn** as labelled sections, so the
model attributes each fact to its source instead of guessing from a blob:

```text
<workflow name="{name}" version="{n}">
{DAG definition JSON, clipped to 3000 chars}
</workflow>
<run id="{id}" status="{FAILED|TIMED_OUT}" trigger="{...}">
<failed_steps>
- step "{key}" ({type}) after {attempts} attempt(s), {durationMs}ms: error: {error, clipped to 600}
</failed_steps>
<other_steps>
- step "{key}" ({type}): {status} output: {output, clipped to 300}
</other_steps>
</run>
```

### Prompt engineering

- **Role + domain grounding** so the model reasons about workflow-specific causes.
- **Stable vs. volatile split** — instructions/contract in the system message, run
  context in the user turn (deterministic, cache-friendly).
- **Labelled context** (`<workflow>`, `<failed_steps>`, `<other_steps>`) so it can
  tell "intended" from "what actually failed" and cite step keys.
- **Failure-first framing** — failed steps carry full detail; others collapse to
  one line.

### Token limits

Trimmed at the field level ([`LIMITS`](../backend/src/ai/failure-analysis.service.ts)):
`error` → 600, `output` → 300, `definition` → 3000 chars, plus the structural
reduction above. This bounds the prompt regardless of workflow or error size.

### Output guard (schema)

Re-validated to require exactly `summary`, `rootCause`, `suggestedFix` (strings)
and `confidence` (`low|medium|high`). Only `FAILED`/`TIMED_OUT` runs are analysable
(else `409`); the run is tenant-scoped.

### Example (real)

Input: the seeded **Sample ETL** run (its `fetch` step gets a 404 and exhausts
retries). Output (confidence **high**): summary — failed HTTP request in `fetch`;
rootCause — likely a wrong/permanent URL `https://example.com/api`; suggestedFix —
verify the URL, else review retry/backoff.

---

## Feature 2 — Natural-language workflow builder

Turns a plain-English description into a valid DAG definition — the second AI
option from requirement G. Authoring action, so it requires the **Editor** role.

### System prompt (fixed)

Fully specifies FlowForge's DAG schema so the model emits a definition that passes
validation on the first try:

```text
You are the workflow builder for FlowForge, a DAG-based workflow engine.
Convert the user description into ONE JSON object that is a valid workflow
definition. Respond with ONLY that JSON object — no markdown, no prose.

Shape:
{ "timeoutMs"?: number (positive, whole-workflow timeout),
  "steps": [ ...at least one step... ] }

Every step has:
- "key": unique id, letters/numbers/_/- only
- "name": short human label
- "type": one of "HTTP", "SCRIPT", "DELAY", "CONDITION"
- "dependsOn": array of other step keys that must finish first (use [] for none)
- optional "retry": { "maxRetries": 0-20, "backoff": { "strategy": "fixed"|"exponential", "initialDelayMs": number, "factor"?: number>=1, "maxDelayMs"?: number } }

Per-type "config":
- HTTP: { "method": "GET"|"POST"|"PUT"|"PATCH"|"DELETE", "url": string, "headers"?: object, "body"?: any, "timeoutMs"?: number }
- SCRIPT: { "code": string } — an async JS function body; upstream step outputs are available as `input.<stepKey>`; use `return` to output a value
- DELAY: { "delayMs": number }
- CONDITION: { "expression": string } — a JS boolean expression over `outputs.<stepKey>`; when it is false, dependent steps are skipped

Rules: keys are unique; every dependsOn entry references an existing key; no
cycles; a step never depends on itself. Prefer realistic URLs and concise
script code. Keep it minimal but faithful to the description.
```

### User message

Just the description, wrapped:
`Generate a workflow for this description:\n{prompt}`.

### Prompt engineering

- **Schema-as-contract.** The system prompt enumerates every field, allowed enum,
  and per-type config shape — so the model doesn't invent unsupported fields, and
  its output matches the exact Zod schema the create endpoint uses.
- **Rule restatement.** The uniqueness / dependency / acyclicity rules are stated
  in plain language, which measurably reduces invalid drafts (duplicate keys,
  dangling `dependsOn`).
- **Minimal-but-faithful instruction** keeps drafts small and reviewable — the user
  edits in the same JSON editor before saving.

### Token limits

The **input description is capped at 2000 characters** (request DTO), and the
system prompt is a fixed constant. The output is a DAG definition, bounded by
nature. So the prompt size is bounded on both ends without truncating meaning.

### Output guard (schema + acyclicity)

Three layers on top of JSON mode:

1. Accept the definition directly (or unwrap a `definition`/`workflow` wrapper key).
2. **Re-validate with the very same `WorkflowDefinitionValidator`** (Zod) the manual
   create path uses — identical rules, no divergence.
3. **Reject cycles** by running the definition through the engine's `WorkflowDag`.

Any failure → **502** ("AI produced an invalid workflow — try rephrasing"). The
generated definition is therefore always something the engine can actually run.

### Example (real)

Prompt: *"Fetch an order from an API, then run a script to check if the total is
over 100, and if so send a POST webhook to notify Slack."* Output (HTTP 201):

```
fetch_order  (HTTP)   dependsOn: []
check_total  (SCRIPT) dependsOn: [fetch_order]
notify_slack (HTTP)   dependsOn: [check_total]
```

A valid, acyclic DAG that passed schema + cycle validation on the first try.
