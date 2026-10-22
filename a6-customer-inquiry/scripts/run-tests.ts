import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildDecisionRequest } from "../src/config.js";
import { classifyInquiry } from "../src/classify.js";
import type { JevDecision } from "../src/jev.js";
import { JevUnavailableError, runJevDecision } from "../src/jev.js";
import { TEST_CASES } from "../src/test-cases.js";
import type { Classification } from "../src/schema.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The public Playground endpoint is rate-limited. The evidence run retries
 * 429/5xx (the production fallback path is unaffected) so that a transient
 * limit does not poison the recorded results.
 */
async function decideWithRetry(
  input: Parameters<typeof runJevDecision>[0],
): Promise<JevDecision> {
  const maxAttempts = 4;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await runJevDecision(input);
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof JevUnavailableError &&
        (error.status === undefined || error.status === 429 || error.status >= 500);
      if (!retryable || attempt === maxAttempts) break;
      const waitMs = 8000 * attempt;
      console.log(`\n    rate-limited; retrying in ${waitMs / 1000}s …`);
      await sleep(waitMs);
    }
  }
  throw lastError;
}


interface Row {
  id: string;
  input: string;
  expected: string;
  result: Classification;
  rawDecision: JevDecision | null;
  pass: boolean;
  failures: string[];
}

const EVIDENCE_DIR = join(process.cwd(), "evidence");
mkdirSync(EVIDENCE_DIR, { recursive: true });

function escapeForTable(message: string): string {
  return message.replace(/\s+/g, " ").replace(/\|/g, "\\|");
}

function evaluate(
  testCase: (typeof TEST_CASES)[number],
  result: Classification,
): string[] {
  const failures: string[] = [];
  if (!testCase.expectedCategories.includes(result.category)) {
    failures.push(
      `category ${result.category} not in [${testCase.expectedCategories.join(", ")}]`,
    );
  }
  if (
    testCase.expectedUrgencyMin !== undefined &&
    result.urgency < testCase.expectedUrgencyMin
  ) {
    failures.push(
      `urgency ${result.urgency} < ${testCase.expectedUrgencyMin}`,
    );
  }
  if (
    testCase.expectedNeedsHuman !== undefined &&
    result.needsHuman !== testCase.expectedNeedsHuman
  ) {
    failures.push(
      `needsHuman ${result.needsHuman} != ${testCase.expectedNeedsHuman}`,
    );
  }
  return failures;
}

const rows: Row[] = [];

for (const [index, testCase] of TEST_CASES.entries()) {
  const label = `[${index + 1}/${TEST_CASES.length}] ${testCase.id}`;
  process.stdout.write(`${label} … `);

  let rawDecision: JevDecision | null = null;
  const result = await classifyInquiry(
    {
      message: testCase.message,
      channel: testCase.channel,
      customerTier: testCase.customerTier,
      ...(testCase.orderId ? { orderId: testCase.orderId } : {}),
    },
    {
      inquiryId: testCase.id,
      decide: decideWithRetry,
      onDecision: (decision) => {
        rawDecision = decision;
      },
    },
  );

  const failures = evaluate(testCase, result);
  const pass = failures.length === 0;
  rows.push({
    id: testCase.id,
    input: testCase.message,
    expected: testCase.expectedCategories.join(" or "),
    result,
    rawDecision,
    pass,
    failures,
  });

  console.log(
    `${pass ? "PASS" : "FAIL"} → ${result.category} ` +
      `(conf ${result.confidence ?? "n/a"}, urgency ${result.urgency}, ` +
      `source ${result.source})`,
  );
  if (!pass) {
    console.log(`           ${failures.join("; ")}`);
  }
}

const passed = rows.filter((row) => row.pass).length;
const generatedAt = new Date().toISOString();

// 1. Raw evidence, including the untouched model answer.
writeFileSync(
  join(EVIDENCE_DIR, "jev-runs.json"),
  JSON.stringify(
    {
      generatedAt,
      transport: process.env.JEV_TRANSPORT ?? "playground",
      model: rows.find((row) => row.rawDecision)?.rawDecision?.model ?? null,
      summary: { total: rows.length, passed, failed: rows.length - passed },
      runs: rows.map((row) => ({
        caseId: row.id,
        input: {
          message: row.input,
          expected: row.expected,
        },
        rawModelDecision: row.rawDecision,
        platformOutput: row.result,
        pass: row.pass,
      })),
    },
    null,
    2,
  ) + "\n",
);

// 2. Human-readable table for the report.
const table = [
  "| # | Input | Expected decision | Actual decision | Confidence | Urgency | Human review | Pass/Fail |",
  "|---|---|---|---|---|---|---|---|",
  ...rows.map(
    (row, index) =>
      `| ${index + 1} | ${escapeForTable(row.input)} | ${row.expected} | ${row.result.category} ` +
      `| ${row.result.confidence ?? "n/a (fallback)"} ` +
      `| ${row.result.urgency}/4 | ${row.result.needsHuman ? "yes" : "no"} ` +
      `| ${row.pass ? "Pass" : `Fail — ${row.failures.join("; ")}`} |`,
  ),
];

writeFileSync(
  join(EVIDENCE_DIR, "test-results.md"),
  [
    "# Jev customer-inquiry classification — test results",
    "",
    `Generated: ${generatedAt}`,
    `Transport: ${process.env.JEV_TRANSPORT ?? "playground"} (real model execution)`,
    `Result: ${passed}/${rows.length} passed`,
    "",
    ...table,
    "",
    "Full raw answers: `evidence/jev-runs.json`.",
    "",
  ].join("\n"),
);

// 3. Copy-paste requests for re-running each case in the browser Playground.
writeFileSync(
  join(process.cwd(), "playground", "requests.json"),
  JSON.stringify(
    TEST_CASES.map((testCase) => ({
      caseId: testCase.id,
      request: buildDecisionRequest({
        message: testCase.message,
        channel: testCase.channel,
        customerTier: testCase.customerTier,
        ...(testCase.orderId ? { orderId: testCase.orderId } : {}),
      }),
    })),
    null,
    2,
  ) + "\n",
);

console.log(`\n${passed}/${rows.length} passed`);
console.log("Wrote evidence/jev-runs.json, evidence/test-results.md, playground/requests.json");

if (passed !== rows.length) {
  process.exitCode = 1;
}
