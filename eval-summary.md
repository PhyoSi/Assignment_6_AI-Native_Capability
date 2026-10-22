# A7 Evaluation Summary

Generated: 2026-10-22T18:28:16.256Z

Capability: A6 customer inquiry classification, same questions and fallback.
Controlled change: retrieved platform policy context (baseline sends none).
Runs per case: 3. A case passes only when **all 3 runs** match the expected category, human-review flag, and decision source. Strict accuracy also checks urgency.

## Before / after

| Metric | Baseline | Improved | Change |
|---|---:|---:|---:|
| Accuracy (case-level, all runs) | 70% | 100% | +30% |
| Accuracy (strict, includes urgency) | 70% | 100% | +30% |
| Accuracy (run-level) | 70% | 100% | +30% |
| p95 latency (measured requests, ms) | 2357 ms | 1929 ms | -428 ms |
| p95 latency (model calls, ms) | 616 ms | 735 ms | +119 ms |
| Avg input tokens / task | 573 | 849 | +277 |
| Est. cost / task (USD) | 0.00002406 | 0.00003567 | +0.00001161 |
| Est. cost / 1,000 tasks (USD) | 0.0241 | 0.0357 | +0.0116 |

Cost is an estimate: actual measured input tokens × USD 0.042 per 1M input tokens (output free). The keyless Playground does not bill this account, so no invoice exists.

## Per-case results

| ID | Type | Expected | Baseline actual | Base | Improved actual | Improved |
|---|---|---|---|---|---|---|
| T01 | normal | billing/u3/no-human/jev | billing, u3, no human, jev (conf 1) | Pass | billing, u3, no human, jev (conf 1) | Pass |
| T02 | normal | technical/u4/human/jev | technical, u4, human, jev (conf 0.99) | Pass | technical, u4, human, jev (conf 1) | Pass |
| T03 | normal | account/u3/no-human/jev | account, u3, no human, jev (conf 1) | Pass | account, u3, no human, jev (conf 1) | Pass |
| T04 | edge | other/u1/human/jev | billing, u1, human, fallback (conf n/a) | Fail | other, u1, human, jev (conf 1) | Pass |
| T05 | edge | shipping/u2/no-human/jev | shipping, u2, no human, jev (conf 1) | Pass | shipping, u2, no human, jev (conf 1) | Pass |
| T06 | edge | account/u4/human/jev | account, u4, human, jev (conf 1) | Pass | account, u4, human, jev (conf 1) | Pass |
| T07 | fallback | billing/un-a/human/fallback | billing, u1, human, fallback (conf n/a) | Pass | billing, u1, human, fallback (conf n/a) | Pass |
| T08 | fallback | shipping/un-a/human/fallback | shipping, u3, human, fallback (conf n/a) | Pass | shipping, u3, human, fallback (conf n/a) | Pass |
| T09 | difficult | billing/u3/no-human/jev | billing, u3, human, fallback (conf n/a) | Fail | billing, u3, no human, jev (conf 1) | Pass |
| T10 | difficult | billing/u3/human/jev | shipping, u3, human, fallback (conf n/a) | Fail | billing, u3, human, jev (conf 0.96) | Pass |

## Analysis

**Improved cases:** T04, T09, T10
**Worse cases:** none
**Still failing:** none

### Baseline

T01 pass (billing, u3, no human, jev (conf 1)); T02 pass (technical, u4, human, jev (conf 0.99)); T03 pass (account, u3, no human, jev (conf 1)); T04 fail (billing, u1, human, fallback (conf n/a)); T05 pass (shipping, u2, no human, jev (conf 1)); T06 pass (account, u4, human, jev (conf 1)); T07 pass (billing, u1, human, fallback (conf n/a)); T08 pass (shipping, u3, human, fallback (conf n/a)); T09 fail (billing, u3, human, fallback (conf n/a)); T10 fail (shipping, u3, human, fallback (conf n/a))

### Improved

T01 pass (billing, u3, no human, jev (conf 1)); T02 pass (technical, u4, human, jev (conf 1)); T03 pass (account, u3, no human, jev (conf 1)); T04 pass (other, u1, human, jev (conf 1)); T05 pass (shipping, u2, no human, jev (conf 1)); T06 pass (account, u4, human, jev (conf 1)); T07 pass (billing, u1, human, fallback (conf n/a)); T08 pass (shipping, u3, human, fallback (conf n/a)); T09 pass (billing, u3, no human, jev (conf 1)); T10 pass (billing, u3, human, jev (conf 0.96))

## Retrieval evidence

- **T01**: KB-06 (0; always-on); KB-07 (0; always-on); KB-01 (6; charge, charged, duplicate charge, refund, subscription)
- **T02**: KB-06 (0; always-on); KB-07 (0; always-on); KB-02 (5; error, 500, checkout, checkout fails)
- **T03**: KB-06 (0; always-on); KB-07 (0; always-on); KB-03 (10; log in, can't log in, password, password reset, locked out, account)
- **T04**: KB-06 (0; always-on); KB-07 (0; always-on); KB-05 (6; discount, student discount, student, annual plan)
- **T05**: KB-06 (0; always-on); KB-07 (0; always-on); KB-04 (4; damaged, arrived damaged, replacement); KB-01 (1; refund)
- **T06**: KB-06 (0; always-on); KB-07 (0; always-on); KB-03 (5; changed the email, email address, account)
- **T07**: KB-06 (0; always-on); KB-07 (0; always-on); KB-01 (4; charge, charged, refund, subscription)
- **T08**: KB-06 (0; always-on); KB-07 (0; always-on); KB-04 (2; tracking, parcel)
- **T09**: KB-06 (0; always-on); KB-07 (0; always-on); KB-03 (4; log in, can't log in); KB-01 (3; charge, charged, invoice)
- **T10**: KB-06 (0; always-on); KB-07 (0; always-on); KB-03 (4; log in, can't log in); KB-04 (4; damaged, arrived damaged, return); KB-01 (2; charge, charged)

## Measurement method

- 3 repetitions per case per version; a warm-up call was excluded.
- Latency is wall-clock around `classifyInquiry`, excluding rate-limit retries and forced-failure samples.
- Fallback cases T07/T08 force HTTP 503 / timeout; latency for them is not included in the model-latency metric.
- Model latency is the upstream `latencyMs` returned by Jev.
- Token usage is the upstream `usage.inputTokens`; cost uses USD 0.042 per 1M input tokens, output free.
- 24 improved model calls and 24 baseline model calls were recorded.
