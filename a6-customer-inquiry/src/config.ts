/**
 * The Jev decision configuration.
 *
 * One `state` (the inquiry) and three typed questions are sent in a single
 * request. Jev returns a label, a continuous score, and a probability — never
 * free-form text, so the result can be validated and routed deterministically.
 *
 * This file is the single source of truth. The same object is used by the
 * Playground transport, the official API transport, and the request samples
 * in `playground/`.
 */

export const CATEGORIES = [
  "billing",
  "technical",
  "account",
  "shipping",
  "other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CHANNELS = ["email", "chat", "web_form", "phone_note"] as const;
export type Channel = (typeof CHANNELS)[number];

export const CUSTOMER_TIERS = ["standard", "premium", "business"] as const;
export type CustomerTier = (typeof CUSTOMER_TIERS)[number];

export const URGENCY_LABELS = ["low", "normal", "high", "critical"] as const;

/** Category metadata used by the decision prompt and by the routing table. */
export const CATEGORY_DEFINITIONS: Record<Category, string> = {
  billing:
    "Charges, duplicate charges, refunds, invoices, receipts, subscription price or plan changes, payment methods, failed payments.",
  technical:
    "Errors, bugs, crashes, broken pages, checkout failures, integrations/API problems, slow performance, outage reports.",
  account:
    "Login, password reset, 2FA/verification codes, locked or compromised accounts, profile or email changes, data export/deletion.",
  shipping:
    "Delivery status, tracking, late or missing parcels, damaged items, returns and exchanges.",
  other:
    "Pre-sales questions, partnerships, feedback, job applications, spam, or anything that fits none of the queues above.",
};

/**
 * Question 1 — Choice. Five mutually exclusive labels, each with explicit
 * criteria so the model's boundaries are inspectable.
 */
export const CATEGORY_QUESTION = {
  type: "choice",
  instructions:
    "Choose the single queue that should own this customer inquiry. Judge the customer's primary intent, not the channel or tone. If two queues apply, pick the one that must act first to resolve the problem.",
  criteria: CATEGORY_DEFINITIONS,
} as const;

/**
 * Question 2 — Score. Jev returns a continuous index over the criteria array.
 * The application maps it to urgency 1..4 (round(score) + 1).
 */
export const URGENCY_QUESTION = {
  type: "score",
  instructions:
    "How urgent is this inquiry for the business? Use only the content of the message and the customer tier. Do not treat strong emotion alone as critical.",
  criteria: [
    "low — no customer impact, informational, feedback, or spam",
    "normal — routine request with a workaround or no hard deadline",
    "high — blocked workflow, money at risk, repeated failure, or a premium/business customer",
    "critical — outage, security compromise, legal threat/chargeback, safety issue, or complete loss of access for many users",
  ],
} as const;

/**
 * Question 3 — Boolean (noul). A safety gate that is deliberately orthogonal
 * to the category: it asks whether a human must look before any automated
 * action.
 */
export const NEEDS_HUMAN_QUESTION = {
  type: "boolean",
  instructions:
    "Does a human agent need to review this inquiry before the platform sends an automated reply or takes an automated action? Answer true for legal threats, chargebacks, account compromise, safety issues, press/legal contacts, or an explicit request for a person. Answer false for routine questions.",
} as const;

export const DECISION_QUESTIONS = {
  category: CATEGORY_QUESTION,
  urgency: URGENCY_QUESTION,
  needs_human: NEEDS_HUMAN_QUESTION,
} as const;

/** The JSON body sent to Jev (Playground: POST /api/evaluate). */
export interface JevRequestBody {
  state: string;
  questions: typeof DECISION_QUESTIONS;
}

/**
 * Builds the state string. Jev reads unstructured context, so the metadata is
 * rendered as labelled lines rather than nested JSON. Message content is not
 * modified or truncated here; input validation happens before this point.
 */
export function buildState(input: {
  message: string;
  channel: Channel;
  customerTier: CustomerTier;
  orderId?: string | undefined;
  /** Retrieved platform policy. Omitted in the A6 baseline, supplied in A7. */
  context?: readonly string[] | undefined;
}): string {
  const lines = [
    input.context?.length
      ? [
          "Relevant platform policy (retrieved, authoritative):",
          ...input.context.map((record) => `- ${record}`),
          "",
        ].join("\n")
      : null,
    `Channel: ${input.channel}`,
    `Customer tier: ${input.customerTier}`,
    input.orderId ? `Related order: ${input.orderId}` : null,
    "Customer message:",
    input.message,
  ];
  return lines
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function buildDecisionRequest(input: {
  message: string;
  channel: Channel;
  customerTier: CustomerTier;
  orderId?: string | undefined;
  context?: readonly string[] | undefined;
}): JevRequestBody {
  return {
    state: buildState(input),
    questions: DECISION_QUESTIONS,
  };
}
