import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { classifyInquiry } from "./classify.js";
import { retrieveKnowledge } from "./grounding.js";
import type { JevDecision } from "./jev.js";
import { JevTimeoutError, runJevDecision } from "./jev.js";
import { InputValidationError, type InquiryInput } from "./schema.js";

const app = new Hono();

/**
 * A7 improvement: retrieve the platform policy and add it to the Jev state.
 * The baseline A6 request sent no context; everything else is unchanged.
 */
function groundedDecide(input: InquiryInput) {
  const { context } = retrieveKnowledge(input.message);
  return runJevDecision({ ...input, context });
}

/**
 * Test hook: force a degraded path without touching production config.
 * SIMULATE_FAILURE=1        → model service error
 * SIMULATE_FAILURE=timeout  → timeout
 * SIMULATE_FAILURE=invalid  → syntactically valid but unusable model answer
 */
function simulatedDecision(): (() => Promise<JevDecision>) | undefined {
  const mode = process.env.SIMULATE_FAILURE;
  if (!mode) return undefined;

  if (mode === "timeout") {
    return async () => {
      throw new JevTimeoutError(5000);
    };
  }
  if (mode === "invalid") {
    return async () => ({
      category: "spam",
      categoryConfidence: 0.99,
      urgencyScore: 1,
      needsHumanProbability: 0.1,
      model: "simulated",
      latencyMs: 0,
      warnings: [],
    });
  }
  return async () => {
    throw new Error("Simulated Jev outage");
  };
}

app.get("/health", (c) =>
  c.json({
    status: "ok",
    transport: process.env.JEV_TRANSPORT ?? "playground",
    degraded: Boolean(process.env.SIMULATE_FAILURE),
  }),
);

app.post("/api/classify", async (c) => {
  const body = await c.req.json().catch(() => null);
  const started = performance.now();

  try {
    const result = await classifyInquiry(body, {
      decide: simulatedDecision() ?? groundedDecide,
    });
    // Log metadata only. The customer message never enters the logs.
    console.log(
      JSON.stringify({
        event: "classified",
        inquiryId: result.inquiryId,
        category: result.category,
        source: result.source,
        confidence: result.confidence,
        needsHuman: result.needsHuman,
        latencyMs: result.latencyMs,
        totalMs: Math.round(performance.now() - started),
      }),
    );
    return c.json(result);
  } catch (error) {
    if (error instanceof InputValidationError) {
      return c.json(
        {
          error: "invalid_input",
          issues: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        400,
      );
    }
    console.error(
      JSON.stringify({
        event: "unhandled_error",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return c.json({ error: "internal_error" }, 500);
  }
});

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Decision API listening on http://localhost:${info.port}`);
  if (process.env.SIMULATE_FAILURE) {
    console.log(
      `WARNING: degraded mode active (SIMULATE_FAILURE=${process.env.SIMULATE_FAILURE})`,
    );
  }
});
