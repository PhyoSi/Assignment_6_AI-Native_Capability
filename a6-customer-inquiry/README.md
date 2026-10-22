# A6 — Customer Inquiry Classification with Jev

A bounded AI decision capability for a commerce/support platform. It turns an
unstructured customer message into a typed routing decision, validates it, and
falls back to deterministic rules whenever the model cannot be trusted.

**Implementation method:** Jev Playground (keyless evaluator) for the recorded
model runs, TypeScript integration for the platform contract, validation, and
fallback. The same request body works against the official
`POST https://api.typesafe.ai/v1/systemone` endpoint by setting
`JEV_TRANSPORT=api`.

---

## The decision

| Question | Jev type | Result |
|---|---|---|
| Which queue owns this inquiry? | `choice` | `billing` / `technical` / `account` / `shipping` / `other` |
| How urgent is it? | `score` (4 criteria) | continuous index → urgency 1–4 |
| Does a human need to review before automated action? | `boolean` | probability ≥ 0.5 → true |

All three questions are sent in **one** request. Jev returns probabilities, not
prose, so the platform never parses free text.

```ts
// src/config.ts (excerpt)
export const DECISION_QUESTIONS = {
  category: {
    type: "choice",
    instructions:
      "Choose the single queue that should own this customer inquiry. ...",
    criteria: {
      billing: "Charges, duplicate charges, refunds, invoices, ...",
      technical: "Errors, bugs, checkout failures, integrations, ...",
      account: "Login, password reset, 2FA, locked or compromised accounts, ...",
      shipping: "Delivery status, tracking, late or missing parcels, ...",
      other: "Pre-sales, partnerships, feedback, spam, or none of the above.",
    },
  },
  urgency: {
    type: "score",
    instructions: "How urgent is this inquiry for the business? ...",
    criteria: ["low ...", "normal ...", "high ...", "critical ..."],
  },
  needs_human: {
    type: "boolean",
    instructions: "Does a human agent need to review this inquiry ...?",
  },
};
```

## Platform API

`POST /api/classify`

```json
{
  "message": "My order #48231 was supposed to arrive on Monday, but tracking has not updated in five days.",
  "channel": "email",
  "customerTier": "standard"
}
```

Observed response (real model run, 2026-10-22):

```json
{
  "inquiryId": "inq_0279aae5-a7f8-42da-b6df-350e1cafd8ea",
  "category": "shipping",
  "urgency": 2,
  "needsHuman": false,
  "confidence": 1,
  "source": "jev",
  "reviewReasons": [],
  "routing": { "queue": "logistics", "slaHours": 24 },
  "model": "typesafe-ai/jev",
  "latencyMs": 445
}
```

`source` and `reviewReasons` make the decision auditable: the platform can
alert when `source` is `fallback` instead of silently assuming the model worked.

## Validation and policy

1. **Input** — zod strict object: message 5–2000 chars, non-blank, no control
   characters; channel/tier enums; optional order ID matching
   `^[A-Za-z0-9-]{3,32}$`. Invalid input returns HTTP 400 and the model is never
   called.
2. **Envelope** — JSON shape, `answers` present, each answer's type checked.
3. **Values** — category must be one of 5 labels; confidence and boolean
   probability must be finite in `[0,1]`; urgency score finite in `[0,3]`.
4. **Policy** — accept only if category confidence ≥ **0.60**. Between 0.60 and
   0.75 the answer is accepted but flagged `low_confidence`. Category `other`,
   urgency 4, or a model request for a human always forces `needsHuman: true`.
5. **Output** — the final object is parsed again against `Classification`
   before it leaves the service, so a bug cannot emit a malformed contract.
6. **Privacy** — logs contain IDs, labels, and latency only; message text is
   never logged.

## Fallback

`src/fallback.ts` is dependency-free. It scores keyword rules per category,
returns `other` on a tie or no match, derives urgency from explicit escalation
terms, and always sets `needsHuman: true` with `confidence: null`. It also
detects prompt-injection phrases (`ignore previous instructions`,
`category=...`) so injected text cannot choose a queue while the model is down.

| Trigger | Review reason | Result |
|---|---|---|
| HTTP/network failure | `model_unavailable` | deterministic category, human review |
| Client timeout (`AbortSignal.timeout`) | `model_timeout` | deterministic category, human review |
| Unknown label / bad schema | `invalid_model_response` | deterministic category, human review |
| Confidence < 0.60 | `low_confidence` | deterministic category, human review |
| Category `other` | `category_other` | Jev label, forced human review |
| Urgency 4 | `critical_urgency` | Jev label, forced human review |

## A7 evaluation (grounding + 10-case comparison)

A7 evaluates the same A6 capability, then applies exactly one change: retrieved
policy grounding. `knowledge/knowledge-base.json` holds seven synthetic policy
records; `src/grounding.ts` selects KB-06/KB-07 (always on) plus the top three
queue records by keyword score and inserts them into the Jev state. The model,
questions, thresholds, validation, and fallback are unchanged.

```bash
npm run eval   # 10 cases x 3 runs x baseline/improved -> eval/
```

The harness (`eval/run-eval.ts`) writes `eval/results-baseline.json`,
`eval/results-improved.json`, and `eval/summary.md`, and copies the dataset to
`../eval-cases.json`. Measured result on 2026-10-22/23 (UTC): baseline 7/10
(70%), improved 10/10 (100%); model-call p95 616 ms → 735 ms; average input
tokens 573 → 849. Full report: `../assignment9_submission.md`, PDF:
`../A7_6731503082.pdf`.

## Evidence

- `evidence/test-results.md` — 8 test cases, 8 passed, with the model's label,
  confidence, urgency, and review flag.
- `evidence/jev-runs.json` — raw model answers and platform outputs.
- `evidence/fallback-demo.txt` — control + timeout + outage + invalid label +
  out-of-range score + NaN + low confidence + injection-under-outage, plus five
  rejected inputs.
- `evidence/http-evidence.txt` — real HTTP 200/400 responses, including
  `SIMULATE_FAILURE=1`, `invalid`, and `timeout` modes.
- `playground/requests.json` — copy-paste request bodies for the browser
  Playground.

## Run it

```bash
npm install
npm test                 # 8 real model runs -> evidence/
npm run demo:fallback    # degraded-mode evidence
npm run eval             # A7 10-case baseline/improved evaluation -> eval/
npm run dev              # http://localhost:8787
```

For the official API, copy `.env.example` to `.env`, set
`JEV_TRANSPORT=api` and `TYPESAFE_API_KEY`, then restart. The Playground
endpoint is an independent third-party tool with no SLA and rate limits; it is
used here only because the assignment permits Playground evidence. Production
must use the official API.

```bash
curl -X POST http://localhost:8787/api/classify \
  -H "Content-Type: application/json" \
  -d '{"message":"I was charged twice for my subscription.","channel":"email"}'

# Degraded mode
SIMULATE_FAILURE=1 npm run dev
```

## Structure

```
src/config.ts        decision configuration + state builder (optional retrieved context)
src/schema.ts        input/output contracts (zod)
src/jev.ts           transports, timeouts, envelope normalisation, usage capture
src/grounding.ts     A7 knowledge-base retrieval and context formatting
src/classify.ts      validation, policy, fallback orchestration
src/fallback.ts      deterministic rules + routing
src/server.ts        Hono HTTP API
src/test-cases.ts    8 synthetic cases
knowledge/knowledge-base.json  A7 policy records (KB-01..KB-07)
eval/                A7 dataset, harness, raw results, summary
scripts/run-tests.ts evidence harness
scripts/fallback-demo.ts failure demonstrations
docs/architecture.md diagram + failure boundaries
```

## Report

The filled submissions are `../assignment8_submission.md` (A6) and
`../assignment9_submission.md` (A7); printable PDFs are `../A6_6731503082.pdf`
and `../A7_6731503082.pdf`. Regenerate the HTML after editing either report:

```bash
npm run report     # A6 -> ../assignment8_submission.html
npm run report:a7  # A7 -> ../assignment9_submission.html
```

Then print the HTML to PDF with a browser (A4, no headers/footers).

## Limitations

- Thresholds (0.60/0.75) are a starting policy, not calibrated on production
  data; they should be tuned against labelled outcomes.
- The deterministic fallback is English keyword matching and will miss typos,
  other languages, and novel wording.
- Category `other` is a safety valve, not a real queue; a production system
  needs a dedicated triage process behind it.
- The Playground endpoint is not a production dependency.
- The demo API has no authentication or per-tenant rate limiting; those belong
  in the platform gateway, not in the decision capability.
