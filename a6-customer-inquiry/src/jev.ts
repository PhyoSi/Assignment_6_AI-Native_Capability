import "dotenv/config";
import { buildDecisionRequest, type Channel, type CustomerTier } from "./config.js";
import { RawJevResponse } from "./schema.js";

/**
 * Transport for the decision call.
 *
 * - `playground`: the keyless Jev Playground evaluator. Used for the evidence
 *   in this assignment because it runs the real model without an account.
 *   It is an independent third-party endpoint and must NOT be used in
 *   production: it has no SLA, no auth, and no contractual data handling.
 * - `api`: the official TypeSafe endpoint (POST /v1/systemone) with a key.
 *   This is the production transport.
 */
export type JevTransport = "playground" | "api";

const ENDPOINTS: Record<JevTransport, string> = {
  playground: "https://jevplayground.com/api/evaluate",
  api: "https://api.typesafe.ai/v1/systemone",
};

export interface JevDecision {
  category: string;
  categoryConfidence: number;
  urgencyScore: number;
  needsHumanProbability: number;
  model: string;
  latencyMs: number;
  warnings: string[];
}

export class JevUnavailableError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "JevUnavailableError";
  }
}

export class JevTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Jev did not answer within ${timeoutMs} ms`);
    this.name = "JevTimeoutError";
  }
}

export class JevInvalidResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JevInvalidResponseError";
  }
}

export interface JevCallInput {
  message: string;
  channel: Channel;
  customerTier: CustomerTier;
  orderId?: string | undefined;
}

export interface JevClientOptions {
  transport?: JevTransport;
  endpoint?: string;
  apiKey?: string | undefined;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function resolveTransport(value: string | undefined): JevTransport {
  if (value === undefined || value === "" || value === "playground") {
    return "playground";
  }
  if (value === "api") {
    return "api";
  }
  throw new Error(`Unsupported JEV_TRANSPORT: ${value}`);
}

/**
 * Calls Jev and normalises the two response envelopes into one internal shape.
 * Every failure mode is raised as a typed error so the caller can choose a
 * deterministic fallback instead of guessing.
 */
export async function runJevDecision(
  input: JevCallInput,
  options: JevClientOptions = {},
): Promise<JevDecision> {
  const transport = options.transport ?? resolveTransport(process.env.JEV_TRANSPORT);
  const endpoint =
    options.endpoint ?? process.env.JEV_ENDPOINT ?? ENDPOINTS[transport];
  const model = options.model ?? process.env.JEV_MODEL ?? "jev-latest";
  const timeoutMs = options.timeoutMs ?? Number(process.env.JEV_TIMEOUT_MS ?? 15_000);
  const apiKey = options.apiKey ?? process.env.TYPESAFE_API_KEY;
  const doFetch = options.fetchImpl ?? fetch;

  if (transport === "api" && !apiKey) {
    throw new JevUnavailableError(
      "TYPESAFE_API_KEY is not configured for the api transport",
    );
  }

  const body = buildDecisionRequest(input);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (transport === "api") {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const started = performance.now();
  let response: Response;
  try {
    response = await doFetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(
        transport === "api" ? { model, ...body } : body,
      ),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw new JevTimeoutError(timeoutMs);
    }
    throw new JevUnavailableError(
      `Jev request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const elapsedMs = Math.round(performance.now() - started);

  if (!response.ok) {
    throw new JevUnavailableError(
      `Jev returned HTTP ${response.status}`,
      response.status,
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new JevInvalidResponseError("Jev response was not valid JSON");
  }

  if (
    typeof json === "object" &&
    json !== null &&
    "ok" in json &&
    (json as { ok?: unknown }).ok === false
  ) {
    throw new JevUnavailableError("Jev returned ok:false");
  }

  console.log(
    JSON.stringify({
      event: "jev_call",
      transport,
      status: response.status,
      latencyMs: elapsedMs,
    }),
  );

  return normaliseResponse(json, { model, fallbackLatencyMs: elapsedMs });
}

interface NormaliseOptions {
  model: string;
  fallbackLatencyMs: number;
}

function normaliseResponse(
  json: unknown,
  options: NormaliseOptions,
): JevDecision {
  const parsed = RawJevResponse.safeParse(json);
  if (!parsed.success) {
    throw new JevInvalidResponseError("Jev response did not match the envelope schema");
  }

  const envelope = parsed.data;
  const answers = envelope.result?.answers ?? envelope.answers;
  if (!answers) {
    throw new JevInvalidResponseError("Jev response did not contain answers");
  }
  const confidenceMap = envelope.result?.confidence ?? envelope.confidence ?? {};

  const categoryAnswer = answers.category;
  if (!categoryAnswer || typeof categoryAnswer.choice !== "string") {
    throw new JevInvalidResponseError("Missing category.choice");
  }
  const categoryConfidence =
    categoryAnswer.confidence ??
    confidenceMap.category ??
    categoryAnswer.probabilities?.[categoryAnswer.choice];
  if (
    typeof categoryConfidence !== "number" ||
    !Number.isFinite(categoryConfidence)
  ) {
    throw new JevInvalidResponseError("Missing category confidence");
  }

  const urgencyAnswer = answers.urgency;
  if (!urgencyAnswer || typeof urgencyAnswer.score !== "number") {
    throw new JevInvalidResponseError("Missing urgency.score");
  }
  if (!Number.isFinite(urgencyAnswer.score)) {
    throw new JevInvalidResponseError("urgency.score is not finite");
  }

  const humanAnswer = answers.needs_human;
  if (!humanAnswer || typeof humanAnswer.probability !== "number") {
    throw new JevInvalidResponseError("Missing needs_human.probability");
  }
  if (!Number.isFinite(humanAnswer.probability)) {
    throw new JevInvalidResponseError("needs_human.probability is not finite");
  }

  return {
    category: categoryAnswer.choice,
    categoryConfidence,
    urgencyScore: urgencyAnswer.score,
    needsHumanProbability: humanAnswer.probability,
    model: envelope.model ?? options.model,
    latencyMs:
      typeof envelope.latencyMs === "number"
        ? envelope.latencyMs
        : options.fallbackLatencyMs,
    warnings: envelope.result?.warnings ?? [],
  };
}
