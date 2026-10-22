import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { classifyInquiry } from "../src/classify.js";
import { buildDecisionRequest, type Category } from "../src/config.js";
import { retrieveKnowledge, loadKnowledgeBase } from "../src/grounding.js";
import {
  JevTimeoutError,
  JevUnavailableError,
  runJevDecision,
} from "../src/jev.js";
import type { JevDecision } from "../src/jev.js";
import type { Classification } from "../src/schema.js";

/**
 * A7 evaluation harness.
 *
 * Baseline  = A6 request: state + questions, no retrieved policy.
 * Improved  = identical request + retrieved policy records in the state.
 *
 * T07/T08 force a model failure so the deterministic fallback is evaluated;
 * every other case must be answered by Jev itself (source=jev).
 */

type Version = "baseline" | "improved";
type FailureMode = "unavailable" | "timeout" | null;

interface Expected {
  category: Category;
  urgency: number | null;
  needsHuman: boolean;
  source: "jev" | "fallback";
}

interface EvalCase {
  id: string;
  type: "normal" | "edge" | "fallback" | "difficult";
  input: {
    message: string;
    channel: string;
    customerTier: string;
    orderId?: string;
  };
  expected: Expected;
  expectedReviewFallback: string;
  reason: string;
  forceFailure: FailureMode;
}

interface CaseFile {
  version: number;
  cases: EvalCase[];
}

interface RunResult {
  caseId: string;
  type: string;
  version: Version;
  run: number;
  contextIds: string[];
  contextScores: Array<{ id: string; score: number; matched: string[] }>;
  promptState: string;
  expected: Expected;
  output: Classification;
  rawDecision: JevDecision | null;
  wallMs: number;
  attempts: number;
  latencyExcluded: boolean;
  pass: boolean;
  strictPass: boolean;
  failures: string[];
  strictFailures: string[];
  timestamp: string;
}

const CASES_PATH = join(process.cwd(), "eval", "eval-cases.json");
const OUT_DIR = join(process.cwd(), "eval");
const PRICE_PER_INPUT_TOKEN = 0.042 / 1_000_000; // published Jev input rate, USD

const RUNS = Number(process.env.EVAL_RUNS ?? 3);
const PACING_MS = Number(process.env.EVAL_PACING_MS ?? 6500);
const RETRY_WAIT_MS = Number(process.env.EVAL_RETRY_WAIT_MS ?? 20_000);
const MAX_ATTEMPTS = Number(process.env.EVAL_MAX_ATTEMPTS ?? 5);
const REQUESTED_VERSIONS = (process.env.EVAL_VERSIONS ?? "baseline,improved")
  .split(",")
  .map((value) => value.trim())
  .filter((value): value is Version => value === "baseline" || value === "improved");
const CASE_FILTER = (process.env.EVAL_CASES ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const caseFile = JSON.parse(readFileSync(CASES_PATH, "utf8")) as CaseFile;
const cases = caseFile.cases.filter(
  (testCase) => CASE_FILTER.length === 0 || CASE_FILTER.includes(testCase.id),
);

if (cases.length === 0) {
  throw new Error("No evaluation cases selected");
}

const knowledgeBase = loadKnowledgeBase();

function p95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(0.95 * sorted.length) - 1;
  return Math.round(sorted[Math.max(0, index)] ?? 0);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return Math.round(sorted[middle] ?? 0);
  const left = sorted[middle - 1] ?? 0;
  const right = sorted[middle] ?? 0;
  return Math.round((left + right) / 2);
}

function evaluate(
  testCase: EvalCase,
  output: Classification,
  strict: boolean,
): string[] {
  const failures: string[] = [];
  if (output.category !== testCase.expected.category) {
    failures.push(
      `category ${output.category} != ${testCase.expected.category}`,
    );
  }
  if (output.needsHuman !== testCase.expected.needsHuman) {
    failures.push(
      `needsHuman ${output.needsHuman} != ${testCase.expected.needsHuman}`,
    );
  }
  if (output.source !== testCase.expected.source) {
    failures.push(`source ${output.source} != ${testCase.expected.source}`);
  }
  if (testCase.expected.source === "fallback" && output.confidence !== null) {
    failures.push("fallback must not report a confidence");
  }
  if (
    strict &&
    testCase.expected.urgency !== null &&
    output.urgency !== testCase.expected.urgency
  ) {
    failures.push(`urgency ${output.urgency} != ${testCase.expected.urgency}`);
  }
  return failures;
}

function isRetryable(error: unknown): boolean {
  return (
    error instanceof JevUnavailableError &&
    (error.status === undefined || error.status === 429 || error.status >= 500)
  );
}

async function callModel(
  input: EvalCase["input"],
  context: string[] | undefined,
  onAttempt: () => void,
): Promise<JevDecision> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    onAttempt();
    try {
      return await runJevDecision({
        message: input.message,
        channel: input.channel as never,
        customerTier: input.customerTier as never,
        ...(input.orderId ? { orderId: input.orderId } : {}),
        ...(context ? { context } : {}),
      });
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === MAX_ATTEMPTS) throw error;
      console.log(
        `    retryable error (${error instanceof Error ? error.message : "unknown"}); waiting ${RETRY_WAIT_MS / 1000}s`,
      );
      await sleep(RETRY_WAIT_MS);
    }
  }
  throw lastError;
}

function signature(output: Classification): string {
  return `${output.category}|${output.source}|${output.needsHuman}`;
}

function summarise(results: RunResult[], version: Version) {
  const caseSummaries = cases.map((testCase) => {
    const runs = results.filter((result) => result.caseId === testCase.id);
    const first = runs[0]?.output;
    const passAll = runs.length === RUNS && runs.every((result) => result.pass);
    const strictAll = runs.length === RUNS && runs.every((result) => result.strictPass);
    const consistent =
      new Set(runs.map((result) => signature(result.output))).size === 1;
    return {
      caseId: testCase.id,
      type: testCase.type,
      expected: testCase.expected,
      firstOutput: first ?? null,
      passAll,
      strictAll,
      consistent,
      passCount: runs.filter((result) => result.pass).length,
      runs: runs.length,
    };
  });

  const usableLatency = results.filter((result) => !result.latencyExcluded);
  const modelCalls = results.filter((result) => result.rawDecision !== null);
  const modelLatency = modelCalls
    .filter((result) => !result.latencyExcluded)
    .map((result) => result.rawDecision?.latencyMs ?? 0);
  const inputTokens = modelCalls.map(
    (result) => result.rawDecision?.usage?.inputTokens ?? 0,
  );
  const totalTokens = inputTokens.reduce((sum, value) => sum + value, 0);
  const avgInputTokensPerTask = totalTokens / Math.max(1, results.length);
  const avgInputTokensPerModelCall = totalTokens / Math.max(1, modelCalls.length);
  const accuracy =
    (caseSummaries.filter((summary) => summary.passAll).length /
      caseSummaries.length) *
    100;
  const strictAccuracy =
    (caseSummaries.filter((summary) => summary.strictAll).length /
      caseSummaries.length) *
    100;
  const runAccuracy =
    (results.filter((result) => result.pass).length /
      Math.max(1, results.length)) *
    100;

  return {
    version,
    cases: caseSummaries,
    accuracy,
    strictAccuracy,
    runAccuracy,
    caseConsistency:
      caseSummaries.filter((summary) => summary.consistent).length /
      caseSummaries.length,
    latency: {
      samples: usableLatency.length,
      p50: median(usableLatency.map((result) => result.wallMs)),
      p95: p95(usableLatency.map((result) => result.wallMs)),
      modelSamples: modelLatency.length,
      modelP50: median(modelLatency),
      modelP95: p95(modelLatency),
    },
    cost: {
      modelCalls: modelCalls.length,
      totalInputTokens: totalTokens,
      avgInputTokensPerTask,
      avgInputTokensPerModelCall,
      usdPerTask: avgInputTokensPerTask * PRICE_PER_INPUT_TOKEN,
      usdPerThousandTasks: avgInputTokensPerTask * PRICE_PER_INPUT_TOKEN * 1000,
      pricePerMillionInputTokens: 0.042,
      outputCost: 0,
    },
    failures: results
      .filter((result) => !result.pass)
      .map((result) => ({
        caseId: result.caseId,
        run: result.run,
        actual: result.output.category,
        needsHuman: result.output.needsHuman,
        source: result.output.source,
        failures: result.failures,
      })),
  };
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\s+/g, " ");
}

function actualLabel(output: Classification | null): string {
  if (!output) return "n/a";
  return `${output.category}, u${output.urgency}, ${output.needsHuman ? "human" : "no human"}, ${output.source} (conf ${output.confidence ?? "n/a"})`;
}

async function runVersion(version: Version): Promise<{
  summary: ReturnType<typeof summarise>;
  results: RunResult[];
}> {
  console.log(`\n=== ${version.toUpperCase()} (${RUNS} runs/case) ===`);
  const results: RunResult[] = [];
  const resultsPath = join(OUT_DIR, `results-${version}.json`);

  // Warm-up call is excluded from the measurements to remove cold-start bias.
  if (process.env.EVAL_SKIP_WARMUP !== "1") {
    const warmupCase = cases[0];
    if (warmupCase) {
      console.log(`Warm-up with ${warmupCase.id}`);
      try {
        const warmupGrounding =
          version === "improved"
            ? retrieveKnowledge(warmupCase.input.message).context
            : undefined;
        await callModel(warmupCase.input, warmupGrounding, () => {});
      } catch (error) {
        console.log(
          `Warm-up failed (continuing): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      await sleep(PACING_MS);
    }
  }

  for (const testCase of cases) {
    for (let run = 1; run <= RUNS; run += 1) {
      const grounding =
        version === "improved"
          ? retrieveKnowledge(testCase.input.message)
          : null;
      const contextIds = grounding?.ids ?? [];
      const contextScores =
        grounding?.selected.map((entry) => ({
          id: entry.record.id,
          score: entry.score,
          matched: entry.matchedKeywords,
        })) ?? [];

      let attempts = 0;
      let rawDecision: JevDecision | null = null;
      const decide = async (): Promise<JevDecision> => {
        if (testCase.forceFailure === "unavailable") {
          attempts += 1;
          throw new JevUnavailableError("Forced outage (A7 evaluation)", 503);
        }
        if (testCase.forceFailure === "timeout") {
          attempts += 1;
          throw new JevTimeoutError(5000);
        }
        return callModel(testCase.input, grounding?.context, () => {
          attempts += 1;
        });
      };

      const started = performance.now();
      const output = await classifyInquiry(
        testCase.input,
        {
          inquiryId: `${testCase.id}-${version}-${run}`,
          decide,
          onDecision: (decision) => {
            rawDecision = decision;
          },
        },
      );
      const wallMs = Math.round(performance.now() - started);

      const failures = evaluate(testCase, output, false);
      const strictFailures = evaluate(testCase, output, true);
      const latencyExcluded = attempts > 1 || testCase.forceFailure !== null;

      const result: RunResult = {
        caseId: testCase.id,
        type: testCase.type,
        version,
        run,
        contextIds,
        contextScores,
        promptState: buildDecisionRequest({
          message: testCase.input.message,
          channel: testCase.input.channel as never,
          customerTier: testCase.input.customerTier as never,
          ...(testCase.input.orderId ? { orderId: testCase.input.orderId } : {}),
          ...(grounding ? { context: grounding.context } : {}),
        }).state,
        expected: testCase.expected,
        output,
        rawDecision,
        wallMs,
        attempts,
        latencyExcluded,
        pass: failures.length === 0,
        strictPass: strictFailures.length === 0,
        failures,
        strictFailures,
        timestamp: new Date().toISOString(),
      };
      results.push(result);

      writeFileSync(
        resultsPath,
        JSON.stringify(
          {
            version,
            runsPerCase: RUNS,
            complete: false,
            generatedAt: new Date().toISOString(),
            results,
          },
          null,
          2,
        ) + "\n",
      );

      console.log(
        `[${version}] ${testCase.id} ${run}/${RUNS} → ${actualLabel(output)} ` +
          `| ${result.pass ? "PASS" : "FAIL"} | ${wallMs}ms`,
      );
      if (testCase.forceFailure === null) await sleep(PACING_MS);
    }
  }

  const summary = summarise(results, version);
  writeFileSync(
    resultsPath,
    JSON.stringify(
      {
        version,
        runsPerCase: RUNS,
        complete: true,
        generatedAt: new Date().toISOString(),
        model: results.find((result) => result.rawDecision)?.rawDecision?.model ?? null,
        knowledgeBaseVersion: knowledgeBase.version,
        price: {
          usdPerMillionInputTokens: 0.042,
          source: "Published TypeSafe/Jev input rate; output free",
        },
        summary,
        results,
      },
      null,
      2,
    ) + "\n",
  );

  console.log(
    `Accuracy ${summary.accuracy.toFixed(0)}% | strict ${summary.strictAccuracy.toFixed(0)}% | ` +
      `p95 ${summary.latency.p95 ?? "n/a"}ms | avg in ${summary.cost.avgInputTokensPerTask.toFixed(0)} tok`,
  );

  return { summary, results };
}

function comparisonMarkdown(
  baseline: ReturnType<typeof summarise> | null,
  improved: ReturnType<typeof summarise> | null,
): string {
  const line = "|---|---:|---:|---:|";
  const row = (
    label: string,
    before: number | null,
    after: number | null,
    suffix: string,
    precision = 0,
  ): string => {
    if (before === null || after === null) return `| ${label} | n/a | n/a | n/a |`;
    const delta = after - before;
    const sign = delta > 0 ? "+" : "";
    return `| ${label} | ${before.toFixed(precision)}${suffix} | ${after.toFixed(precision)}${suffix} | ${sign}${delta.toFixed(precision)}${suffix} |`;
  };

  const caseLine = (summary: ReturnType<typeof summarise>) =>
    summary.cases
      .map(
        (testCase) =>
          `${testCase.caseId} ${testCase.passAll ? "pass" : "fail"} (${actualLabel(testCase.firstOutput)})`,
      )
      .join("; ");

  const improvedCases =
    baseline && improved
      ? improved.cases
          .filter((after, index) => after.passAll && !baseline.cases[index]?.passAll)
          .map((entry) => entry.caseId)
      : [];
  const worsenedCases =
    baseline && improved
      ? improved.cases
          .filter((after, index) => !after.passAll && baseline.cases[index]?.passAll)
          .map((entry) => entry.caseId)
      : [];
  const stillFailing =
    improved?.cases.filter((entry) => !entry.passAll).map((entry) => entry.caseId) ?? [];

  return `# A7 Evaluation Summary

Generated: ${new Date().toISOString()}

Capability: A6 customer inquiry classification, same questions and fallback.
Controlled change: retrieved platform policy context (baseline sends none).
Runs per case: ${RUNS}. A case passes only when **all ${RUNS} runs** match the expected category, human-review flag, and decision source. Strict accuracy also checks urgency.

## Before / after

| Metric | Baseline | Improved | Change |
|---|---:|---:|---:|
${row("Accuracy (case-level, all runs)", baseline?.accuracy ?? null, improved?.accuracy ?? null, "%")}
${row("Accuracy (strict, includes urgency)", baseline?.strictAccuracy ?? null, improved?.strictAccuracy ?? null, "%")}
${row("Accuracy (run-level)", baseline?.runAccuracy ?? null, improved?.runAccuracy ?? null, "%")}
${row("p95 latency (measured requests, ms)", baseline?.latency.p95 ?? null, improved?.latency.p95 ?? null, " ms")}
${row("p95 latency (model calls, ms)", baseline?.latency.modelP95 ?? null, improved?.latency.modelP95 ?? null, " ms")}
${row("Avg input tokens / task", baseline?.cost.avgInputTokensPerTask ?? null, improved?.cost.avgInputTokensPerTask ?? null, "", 0)}
${row("Est. cost / task (USD)", baseline?.cost.usdPerTask ?? null, improved?.cost.usdPerTask ?? null, "", 8)}
${row("Est. cost / 1,000 tasks (USD)", baseline?.cost.usdPerThousandTasks ?? null, improved?.cost.usdPerThousandTasks ?? null, "", 4)}

Cost is an estimate: actual measured input tokens × USD 0.042 per 1M input tokens (output free). The keyless Playground does not bill this account, so no invoice exists.

## Per-case results

| ID | Type | Expected | Baseline actual | Base | Improved actual | Improved |
|---|---|---|---|---|---|---|
${cases
  .map((testCase, index) => {
    const before = baseline?.cases[index];
    const after = improved?.cases[index];
    const expected = `${testCase.expected.category}/u${testCase.expected.urgency ?? "n-a"}/${testCase.expected.needsHuman ? "human" : "no-human"}/${testCase.expected.source}`;
    return `| ${testCase.id} | ${testCase.type} | ${expected} | ${actualLabel(before?.firstOutput ?? null)} | ${before?.passAll ? "Pass" : "Fail"} | ${actualLabel(after?.firstOutput ?? null)} | ${after?.passAll ? "Pass" : "Fail"} |`;
  })
  .join("\n")}

## Analysis

**Improved cases:** ${improvedCases.length > 0 ? improvedCases.join(", ") : "none"}
**Worse cases:** ${worsenedCases.length > 0 ? worsenedCases.join(", ") : "none"}
**Still failing:** ${stillFailing.length > 0 ? stillFailing.join(", ") : "none"}

### Baseline

${caseLine(baseline ?? ({} as ReturnType<typeof summarise>))}

### Improved

${caseLine(improved ?? ({} as ReturnType<typeof summarise>))}

## Retrieval evidence

${cases
  .map((testCase) => {
    const retrieval = retrieveKnowledge(testCase.input.message);
    const detail = retrieval.selected
      .map(
        (entry) =>
          `${entry.record.id} (${entry.score}; ${entry.matchedKeywords.join(", ") || "always-on"})`,
      )
      .join("; ");
    return `- **${testCase.id}**: ${detail}`;
  })
  .join("\n")}

## Measurement method

- ${RUNS} repetitions per case per version; a warm-up call was excluded.
- Latency is wall-clock around \`classifyInquiry\`, excluding rate-limit retries and forced-failure samples.
- Fallback cases T07/T08 force HTTP 503 / timeout; latency for them is not included in the model-latency metric.
- Model latency is the upstream \`latencyMs\` returned by Jev.
- Token usage is the upstream \`usage.inputTokens\`; cost uses USD 0.042 per 1M input tokens, output free.
- ${improved?.cost.modelCalls ?? 0} improved model calls and ${baseline?.cost.modelCalls ?? 0} baseline model calls were recorded.
`;
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  // Keep the submission copy of the dataset at the workspace root.
  copyFileSync(CASES_PATH, join(process.cwd(), "..", "eval-cases.json"));

  const summaries: Partial<Record<Version, ReturnType<typeof summarise>>> = {};

  for (const version of REQUESTED_VERSIONS) {
    const { summary } = await runVersion(version);
    summaries[version] = summary;
  }

  if (REQUESTED_VERSIONS.length === 2) {
    const markdown = comparisonMarkdown(
      summaries.baseline ?? null,
      summaries.improved ?? null,
    );
    writeFileSync(join(OUT_DIR, "summary.md"), markdown);
    writeFileSync(join(process.cwd(), "..", "eval-summary.md"), markdown);
    console.log("\nWrote eval/summary.md and eval-summary.md");
  }
}

await main();
