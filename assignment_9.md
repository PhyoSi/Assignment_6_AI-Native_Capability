# Assignment A7: Evaluate and Improve Your AI Capability

**Course:** Platform Development  
**Week:** 09 — Retrieval, Context and Evaluation  
**Type:** Individual Assignment  
**Total:** 100 Points

## Objective

Evaluate the AI capability developed in Week 08 using a repeatable test set, then improve one part of the system and demonstrate its impact using evidence.

**Use the same AI capability from A6. Do not start a new project unless approved by the instructor.**

## Task 1 — Prepare Grounding Context (20 points)

Identify information that could help your decision model make more reliable decisions.

Examples:
- University FAQs
- Department service descriptions
- Product categories
- Platform policies
- Support ticket guidelines

Requirements:

1. Prepare at least 5 relevant knowledge records.
2. Describe how the records are selected or retrieved.
3. Show how relevant context is supplied to the model.
4. Explain why the selected context is useful.

A small local JSON knowledge base is sufficient. A vector database is not required.

## Task 2 — Create an Evaluation Dataset (25 points)

Prepare 10 evaluation cases with expected results defined before testing.

| Case Type | Number |
|---|---:|
| Normal cases | 3 |
| Edge cases | 3 |
| Fallback cases | 2 |
| Difficult / ambiguous cases | 2 |
| **Total** | **10** |

Each case must include:
- Case ID
- Input
- Expected decision
- Expected fallback or review behavior, where applicable
- Reason for the expected result

Save the dataset as `eval-cases.json` or include an equivalent structured table.

## Task 3 — Measure Baseline Performance (20 points)

Run the 10 evaluation cases against your original Week 08 capability.

Measure:

**Accuracy**

Accuracy = Correct cases / Total cases × 100

**Latency**

Record response time in milliseconds. Report p95 latency if sufficient repeated measurements are available.

**Cost per Task**

Report estimated API cost per request where pricing or usage information is available. Otherwise report `N/A` and explain why.

Provide actual results, not invented measurements.

## Task 4 — Improve One Thing and Compare (25 points)

Choose exactly one improvement:

- Better decision instructions or criteria
- More relevant grounding context
- Improved retrieval or filtering
- A different confidence or review threshold

Run the same 10 cases again.

Compare baseline and improved results.

| Metric | Before | After | Change |
|---|---|---|---|
| Accuracy | | | |
| p95 Latency | | | |
| Cost per Task | | | |

Explain:

1. Which cases improved?
2. Which cases became worse?
3. Did the improvement introduce any trade-offs?
4. Is the improved version suitable for production? Why or why not?

An improvement attempt that does not increase accuracy is acceptable if the evaluation is reproducible and the analysis is sound.

## Task 5 — Engineering Reflection (10 points)

Answer:

1. What did you learn from systematic evaluation?
2. Why is testing only a few successful examples insufficient?
3. What would you evaluate next before production deployment?

## Submission

Submit:

- `A7_StudentID.pdf` — evaluation report
- `eval-cases.json` — 10 evaluation cases
- Configuration or code showing the single improvement
- Supporting screenshots or execution logs

**Important:** Use actual measurements. Clearly distinguish measured values from estimates.
