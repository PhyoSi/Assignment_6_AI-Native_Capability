# Jev Playground — manual configuration

The exact request bodies are in `requests.json`. Each entry has a `caseId` and
the `request` object that the TypeScript code sends.

## Browser steps

1. Open <https://jevplayground.com/>.
2. Choose **Multiple questions**.
3. Paste the `state` string from any entry in `requests.json`.
4. Add three questions:
   - **Choice** — "Which queue owns this inquiry?" with the five criteria from
     `src/config.ts`.
   - **Score** — "How urgent is this inquiry for the business?" with the four
     criteria from `src/config.ts`.
   - **Boolean** — "Does a human agent need to review this inquiry before any
     automated action?"
5. Run. The output is the same `answers` object captured in
   `../evidence/jev-runs.json`.

## Primary case

```json
{
  "state": "Channel: email\nCustomer tier: standard\nCustomer message:\nMy order #48231 was supposed to arrive on Monday, but tracking has not updated in five days.",
  "questions": {
    "category": {
      "type": "choice",
      "instructions": "Choose the single queue that should own this customer inquiry. Judge the customer's primary intent, not the channel or tone. If two queues apply, pick the one that must act first to resolve the problem.",
      "criteria": {
        "billing": "Charges, duplicate charges, refunds, invoices, receipts, subscription price or plan changes, payment methods, failed payments.",
        "technical": "Errors, bugs, crashes, broken pages, checkout failures, integrations/API problems, slow performance, outage reports.",
        "account": "Login, password reset, 2FA/verification codes, locked or compromised accounts, profile or email changes, data export/deletion.",
        "shipping": "Delivery status, tracking, late or missing parcels, damaged items, returns and exchanges.",
        "other": "Pre-sales questions, partnerships, feedback, job applications, spam, or anything that fits none of the queues above."
      }
    },
    "urgency": {
      "type": "score",
      "instructions": "How urgent is this inquiry for the business? Use only the content of the message and the customer tier. Do not treat strong emotion alone as critical.",
      "criteria": [
        "low — no customer impact, informational, feedback, or spam",
        "normal — routine request with a workaround or no hard deadline",
        "high — blocked workflow, money at risk, repeated failure, or a premium/business customer",
        "critical — outage, security compromise, legal threat/chargeback, safety issue, or complete loss of access for many users"
      ]
    },
    "needs_human": {
      "type": "boolean",
      "instructions": "Does a human agent need to review this inquiry before the platform sends an automated reply or takes an automated action? Answer true for legal threats, chargebacks, account compromise, safety issues, press/legal contacts, or an explicit request for a person. Answer false for routine questions."
    }
  }
}
```

## Notes on the recorded runs

- `typesafe-ai/jev` executed the real model through the Playground evaluator;
  nothing in `evidence/` is mocked except the explicitly labelled
  `SIMULATE_FAILURE` scenarios.
- The Playground is rate-limited. The evidence harness retries 429/5xx with
  backoff; the production path does not retry silently — it falls back.
- Probabilities vary slightly between runs (the ambiguous T5 case returned 0.40
  and 0.51 for `account` on two runs). Both were below the 0.60 policy line and
  both correctly fell back.
