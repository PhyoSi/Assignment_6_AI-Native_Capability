import { z } from "zod";
import {
  CATEGORIES,
  CHANNELS,
  CUSTOMER_TIERS,
} from "./config.js";

/**
 * Input contract.
 * Deliberately strict: the platform rejects bad input at the edge instead of
 * sending it to the model. Messages are synthetic in the test suite; in
 * production the API logs metadata only, never the message body.
 */
export const InquiryInput = z
  .object({
    message: z
      .string()
      .trim()
      .min(5, "message must be at least 5 characters")
      .max(2000, "message must be at most 2000 characters")
      .refine(
        (value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value),
        "message contains control characters",
      )
      .refine(
        (value) => value.replace(/\s/g, "").length > 0,
        "message must not be blank",
      ),
    channel: z.enum(CHANNELS).default("email"),
    customerTier: z.enum(CUSTOMER_TIERS).default("standard"),
    orderId: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{3,32}$/, "orderId must be 3-32 alphanumeric characters")
      .optional(),
  })
  .strict();

export type InquiryInput = z.infer<typeof InquiryInput>;

export const CategorySchema = z.enum(CATEGORIES);
export const UrgencySchema = z.number().int().min(1).max(4);

export const REVIEW_REASONS = [
  "low_confidence",
  "model_unavailable",
  "model_timeout",
  "invalid_model_response",
  "ambiguous_fallback",
  "category_other",
  "critical_urgency",
  "human_requested_by_model",
] as const;

export type ReviewReason = (typeof REVIEW_REASONS)[number];

/**
 * Output contract returned by the platform API.
 * `confidence` is the model's probability for the chosen category. It is
 * null whenever the deterministic fallback produced the answer, because the
 * fallback has no calibrated probability and must not pretend to have one.
 */
export const Classification = z
  .object({
    inquiryId: z.string(),
    category: CategorySchema,
    urgency: UrgencySchema,
    needsHuman: z.boolean(),
    confidence: z.number().min(0).max(1).nullable(),
    source: z.enum(["jev", "fallback"]),
    reviewReasons: z.array(z.enum(REVIEW_REASONS)),
    routing: z.object({
      queue: z.string(),
      slaHours: z.number().positive(),
    }),
    model: z.string().nullable(),
    latencyMs: z.number().nonnegative().nullable(),
  })
  .strict();

export type Classification = z.infer<typeof Classification>;

/** A single answer object as returned by Jev (permissive on purpose). */
export const RawAnswer = z
  .object({
    type: z.string().optional(),
    choice: z.string().optional(),
    score: z.number().optional(),
    probability: z.number().optional(),
    probabilities: z.record(z.string(), z.number()).optional(),
    confidence: z.number().optional(),
  })
  .passthrough();

export const RawJevResponse = z
  .object({
    // Playground wraps answers in `result`; the official API does not.
    result: z
      .object({
        answers: z.record(z.string(), RawAnswer),
        confidence: z.record(z.string(), z.number()).optional(),
        warnings: z.array(z.string()).optional(),
        usage: z
          .object({
            inputTokens: z.number().optional(),
            outputTokens: z.number().optional(),
            totalTokens: z.number().optional(),
          })
          .optional(),
      })
      .optional(),
    answers: z.record(z.string(), RawAnswer).optional(),
    confidence: z.record(z.string(), z.number()).optional(),
    usage: z
      .object({
        inputTokens: z.number().optional(),
        outputTokens: z.number().optional(),
        totalTokens: z.number().optional(),
      })
      .optional(),
    model: z.string().optional(),
    latencyMs: z.number().optional(),
  })
  .passthrough();

export type RawJevResponse = z.infer<typeof RawJevResponse>;

export class InputValidationError extends Error {
  readonly status = 400;
  readonly issues: z.ZodIssue[];

  constructor(error: z.ZodError) {
    super("Invalid input");
    this.name = "InputValidationError";
    this.issues = error.issues;
  }
}
