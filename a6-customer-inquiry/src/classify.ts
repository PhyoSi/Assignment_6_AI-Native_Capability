import { randomUUID } from "node:crypto";
import {
  CATEGORIES,
  type Category,
} from "./config.js";
import {
  Classification,
  InputValidationError,
  InquiryInput,
  type InquiryInput as InquiryInputType,
  type ReviewReason,
} from "./schema.js";
import {
  JevInvalidResponseError,
  JevTimeoutError,
  runJevDecision,
  type JevDecision,
} from "./jev.js";
import { deterministicFallback, routeFor } from "./fallback.js";

/** Policy, not model output. Tuned in scripts/run-tests.ts. */
export const MIN_CATEGORY_CONFIDENCE = 0.6;
export const REVIEW_CONFIDENCE = 0.75;

export interface ClassifyDeps {
  /** Injectable for tests and fallback demonstrations. Defaults to the Jev client. */
  decide?: (input: InquiryInputType) => Promise<JevDecision>;
  /** Audit hook used by the evidence script to persist raw model answers. */
  onDecision?: (decision: JevDecision) => void;
  inquiryId?: string;
}

interface AcceptedDecision {
  category: Category;
  confidence: number;
  urgency: 1 | 2 | 3 | 4;
  needsHuman: boolean;
}

function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

/**
 * Validates the model's answer against the application's contract. Jev cannot
 * emit free text, but a stale model version, a proxy error, or a bad deploy
 * can still return a shape the platform must not trust.
 */
function validateDecision(decision: JevDecision): AcceptedDecision {
  if (!isCategory(decision.category)) {
    throw new JevInvalidResponseError(
      `Unknown category label: ${decision.category}`,
    );
  }
  const confidence = decision.categoryConfidence;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new JevInvalidResponseError("category confidence out of range");
  }
  // The score is an index over the four urgency criteria.
  const score = decision.urgencyScore;
  if (!Number.isFinite(score) || score < 0 || score > 3) {
    throw new JevInvalidResponseError("urgency score out of range");
  }
  const probability = decision.needsHumanProbability;
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new JevInvalidResponseError("needs_human probability out of range");
  }

  return {
    category: decision.category,
    confidence,
    urgency: Math.min(4, Math.max(1, Math.round(score) + 1)) as
      | 1
      | 2
      | 3
      | 4,
    needsHuman: probability >= 0.5,
  };
}

function reasonForError(error: unknown): ReviewReason {
  if (error instanceof JevTimeoutError) return "model_timeout";
  if (error instanceof JevInvalidResponseError) return "invalid_model_response";
  return "model_unavailable";
}

function dedupe(reasons: ReviewReason[]): ReviewReason[] {
  return [...new Set(reasons)];
}

function buildFallback(
  input: InquiryInputType,
  inquiryId: string,
  reason: ReviewReason,
  latencyMs: number | null,
): Classification {
  const fallback = deterministicFallback(input, reason);
  return Classification.parse({
    inquiryId,
    category: fallback.category,
    urgency: fallback.urgency,
    needsHuman: fallback.needsHuman,
    confidence: null,
    source: "fallback",
    reviewReasons: dedupe(fallback.reviewReasons),
    routing: routeFor(fallback.category, fallback.urgency),
    model: null,
    latencyMs,
  });
}

/**
 * Application-facing decision function.
 *
 * Jev decides → the platform validates and applies policy → the answer is
 * parsed against the output schema. Any model failure exits through the
 * deterministic fallback; no model output is ever trusted unchecked.
 */
export async function classifyInquiry(
  raw: unknown,
  deps: ClassifyDeps = {},
): Promise<Classification> {
  const parsed = InquiryInput.safeParse(raw);
  if (!parsed.success) {
    throw new InputValidationError(parsed.error);
  }
  const input = parsed.data;
  const inquiryId = deps.inquiryId ?? `inq_${randomUUID()}`;

  const started = performance.now();
  let decision: JevDecision;
  try {
    decision = await (deps.decide ?? runJevDecision)(input);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "decision_failed",
        inquiryId,
        error: error instanceof Error ? error.name : "UnknownError",
        detail: error instanceof Error ? error.message : String(error),
      }),
    );
    return buildFallback(
      input,
      inquiryId,
      reasonForError(error),
      Math.round(performance.now() - started),
    );
  }
  deps.onDecision?.(decision);

  let accepted: AcceptedDecision;
  try {
    accepted = validateDecision(decision);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "decision_invalid",
        inquiryId,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    return buildFallback(
      input,
      inquiryId,
      "invalid_model_response",
      decision.latencyMs,
    );
  }

  // Below this confidence the label is not safe to route automatically.
  if (accepted.confidence < MIN_CATEGORY_CONFIDENCE) {
    return buildFallback(
      input,
      inquiryId,
      "low_confidence",
      decision.latencyMs,
    );
  }

  const reviewReasons: ReviewReason[] = [];
  const modelRequestedHuman = accepted.needsHuman;
  if (accepted.confidence < REVIEW_CONFIDENCE) {
    reviewReasons.push("low_confidence");
  }
  if (accepted.category === "other") {
    reviewReasons.push("category_other");
    accepted.needsHuman = true;
  }
  if (accepted.urgency === 4) {
    reviewReasons.push("critical_urgency");
    accepted.needsHuman = true;
  }
  // Only record this when the model itself asked for a human, not when the
  // policy above forced a review.
  if (modelRequestedHuman) {
    reviewReasons.push("human_requested_by_model");
  }

  return Classification.parse({
    inquiryId,
    category: accepted.category,
    urgency: accepted.urgency,
    needsHuman: accepted.needsHuman,
    confidence: Number(accepted.confidence.toFixed(4)),
    source: "jev",
    reviewReasons: dedupe(reviewReasons),
    routing: routeFor(accepted.category, accepted.urgency),
    model: decision.model,
    latencyMs: decision.latencyMs,
  });
}
