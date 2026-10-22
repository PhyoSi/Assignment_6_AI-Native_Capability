import type { Category, CustomerTier } from "./config.js";
import type { ReviewReason } from "./schema.js";

/**
 * Deterministic fallback.
 *
 * This module must not depend on the model, the network, or any package. It is
 * the safety net when Jev is unavailable, slow, uncertain, or malformed. It is
 * intentionally conservative: category can be `other` and every fallback
 * answer is flagged for human review.
 */

interface Rule {
  category: Exclude<Category, "other">;
  patterns: RegExp[];
}

// Order is the tie-break order. A tie still falls back to `other` + review.
const RULES: Rule[] = [
  {
    category: "billing",
    patterns: [
      /\brefund(s|ed)?\b/i,
      /\bcharge(d|s)?\b/i,
      /\bdouble[- ]?charge/i,
      /\binvoice\b/i,
      /\breceipt\b/i,
      /\bpayment\b/i,
      /\bsubscription\b/i,
      /\bbilling\b/i,
      /\bprice\b/i,
      /\bplan\b/i,
      /\bcredit card\b/i,
      /\bcharged?\s+twice\b/i,
    ],
  },
  {
    category: "technical",
    patterns: [
      /\berror\b/i,
      /\bbug\b/i,
      /\bcrash(es|ed|ing)?\b/i,
      /\bbroken\b/i,
      /\bnot working\b/i,
      /\bdoesn'?t work\b/i,
      /\bcheckout\b/i,
      /\b500\b/,
      /\btimeout\b/i,
      /\bslow\b/i,
      /\boutage\b/i,
      /\bapi\b/i,
      /\bintegration\b/i,
      /\bwebsite\b/i,
      /\bapp\b/i,
    ],
  },
  {
    category: "account",
    patterns: [
      /\blog ?in\b/i,
      /\bsign ?in\b/i,
      /\bpassword\b/i,
      /\b2fa\b/i,
      /\bverification code\b/i,
      /\baccount\b/i,
      /\blocked out\b/i,
      /\bhacked\b/i,
      /\bcompromised\b/i,
      /\bprofile\b/i,
      /\bemail address\b/i,
    ],
  },
  {
    category: "shipping",
    patterns: [
      /\bship(ping|ped|ment)?\b/i,
      /\bdeliver(y|ed|ing)?\b/i,
      /\btracking\b/i,
      /\bparcel\b/i,
      /\bpackage\b/i,
      /\bcourier\b/i,
      /\border\b/i,
      /\bdamaged\b/i,
      /\breturn(s|ed)?\b/i,
      /\barrived\b/i,
    ],
  },
];

const HIGH_URGENCY = [
  /\burgent(ly)?\b/i,
  /\basap\b/i,
  /\bimmediately\b/i,
  /\bcan'?t (use|access|buy|check ?out|log ?in)\b/i,
  /\bcannot (use|access|buy|check ?out|log ?in)\b/i,
  /\bblocked\b/i,
  /\blocked out\b/i,
  /\bfurious\b/i,
  /\bangry\b/i,
  /\bcancel(l?ing)?\b/i,
  /\brepeated(ly)?\b/i,
  /\bno response\b/i,
  /\bnever (received|arrived)\b/i,
  /\bnot (received|arrived|delivered)\b/i,
  /\bmissing (order|parcel|package)\b/i,
  /\blate\b/i,
  /\bdelay(ed|s)?\b/i,
  /\bhas not (updated|arrived|shipped)\b/i,
];

/**
 * Prompt-injection guard for the fallback path. When the model is unavailable
 * the deterministic rules see the raw text, so injected instructions such as
 * "category=billing" must not be allowed to steer the queue.
 */
const INJECTION_PATTERNS = [
  /ignore (all )?(previous|prior|above) instructions/i,
  /\bsystem\s*:/i,
  /\byou must (answer|classify|respond)\b/i,
  /\bcategory\s*=/i,
  /\bneeds_human\s*=/i,
];


const CRITICAL_URGENCY = [
  /\blawyer\b/i,
  /\blegal\b/i,
  /\bchargeback\b/i,
  /\battorney\b/i,
  /\bhacked\b/i,
  /\bcompromised\b/i,
  /\bsecurity\b/i,
  /\bdata loss\b/i,
  /\boutage\b/i,
  /\bdown\b/i,
  /\bemergency\b/i,
];

export interface FallbackDecision {
  category: Category;
  urgency: 1 | 2 | 3 | 4;
  needsHuman: boolean;
  reviewReasons: ReviewReason[];
}

function countMatches(patterns: RegExp[], text: string): number {
  return patterns.reduce(
    (total, pattern) => total + (pattern.test(text) ? 1 : 0),
    0,
  );
}

function detectCategory(message: string): {
  category: Category;
  ambiguous: boolean;
} {
  // Checked first: an injected instruction must never select a queue.
  if (INJECTION_PATTERNS.some((pattern) => pattern.test(message))) {
    return { category: "other", ambiguous: true };
  }

  const scores = RULES.map((rule) => ({
    category: rule.category,
    score: countMatches(rule.patterns, message),
  })).sort((a, b) => b.score - a.score);

  const top = scores[0];
  const runnerUp = scores[1];
  if (!top || top.score === 0) {
    return { category: "other", ambiguous: true };
  }
  if (runnerUp && runnerUp.score === top.score) {
    return { category: "other", ambiguous: true };
  }
  return { category: top.category, ambiguous: false };
}

function detectUrgency(message: string, tier: CustomerTier): 1 | 2 | 3 | 4 {
  let urgency = 1;
  if (countMatches(HIGH_URGENCY, message) > 0) {
    urgency = 3;
  }
  if (countMatches(CRITICAL_URGENCY, message) > 0) {
    urgency = 4;
  }
  if (tier !== "standard" && urgency < 4) {
    urgency += 1;
  }
  return Math.min(4, urgency) as 1 | 2 | 3 | 4;
}

/**
 * @param reason Why the model path was abandoned. It is copied into the
 *               output so the platform can alert on degraded decisions.
 */
export function deterministicFallback(
  input: { message: string; customerTier: CustomerTier },
  reason: ReviewReason,
): FallbackDecision {
  const { category, ambiguous } = detectCategory(input.message);
  const reviewReasons: ReviewReason[] = [reason];
  if (ambiguous && reason !== "ambiguous_fallback") {
    reviewReasons.push("ambiguous_fallback");
  }

  return {
    category,
    urgency: detectUrgency(input.message, input.customerTier),
    // Degraded mode is never allowed to take an automated action.
    needsHuman: true,
    reviewReasons,
  };
}

/** Deterministic downstream routing used by both the Jev and fallback paths. */
export function routeFor(
  category: Category,
  urgency: 1 | 2 | 3 | 4,
): { queue: string; slaHours: number } {
  const queues: Record<Category, string> = {
    billing: "billing-support",
    technical: "technical-support",
    account: "account-security",
    shipping: "logistics",
    other: "general-triage",
  };
  const slaByUrgency: Record<1 | 2 | 3 | 4, number> = {
    1: 72,
    2: 24,
    3: 8,
    4: 2,
  };
  return { queue: queues[category], slaHours: slaByUrgency[urgency] };
}
