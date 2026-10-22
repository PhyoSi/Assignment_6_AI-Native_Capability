import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Minimal local knowledge base and lexical retrieval.
 *
 * A vector database is not needed for five queue policies: the vocabulary is
 * small, the labels are known, and an auditable keyword score is easier to
 * debug than an embedding similarity. The two policy records are always
 * supplied; the three queue records are selected by term overlap.
 */

export interface KnowledgeRecord {
  id: string;
  title: string;
  queue: string;
  alwaysOn: boolean;
  keywords: string[];
  content: string;
}

export interface KnowledgeBase {
  version: number;
  description: string;
  records: KnowledgeRecord[];
}

export interface RetrievedRecord {
  record: KnowledgeRecord;
  score: number;
  matchedKeywords: string[];
}

export interface GroundingResult {
  selected: RetrievedRecord[];
  /** One line per record, ready to insert into the Jev state. */
  context: string[];
  /** Selected IDs, for evidence and logs. */
  ids: string[];
}

const KB_PATH = fileURLToPath(
  new URL("../knowledge/knowledge-base.json", import.meta.url),
);

let cached: KnowledgeBase | undefined;

export function loadKnowledgeBase(): KnowledgeBase {
  if (!cached) {
    cached = JSON.parse(readFileSync(KB_PATH, "utf8")) as KnowledgeBase;
  }
  return cached;
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function scoreRecord(
  record: KnowledgeRecord,
  message: string,
): { score: number; matched: string[] } {
  const matched: string[] = [];
  let score = 0;

  for (const keyword of record.keywords) {
    const phrase = normalise(keyword);
    if (phrase.length === 0 || !message.includes(phrase)) continue;
    matched.push(keyword);
    // Multi-word phrases are more specific than a single token.
    score += phrase.includes(" ") ? 2 : 1;
  }

  return { score, matched };
}

export function retrieveKnowledge(
  text: string,
  options: { topK?: number } = {},
): GroundingResult {
  const topK = options.topK ?? 3;
  const message = normalise(text);
  const { records } = loadKnowledgeBase();

  const alwaysOn = records
    .filter((record) => record.alwaysOn)
    .map((record) => ({
      record,
      score: 0,
      matchedKeywords: [] as string[],
    }));

  const ranked = records
    .filter((record) => !record.alwaysOn)
    .map((record) => {
      const { score, matched } = scoreRecord(record, message);
      return { record, score, matchedKeywords: matched };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id))
    .slice(0, topK);

  const selected = [...alwaysOn, ...ranked];
  const context = selected.map(
    ({ record }) => `[${record.id}] ${record.title}: ${record.content}`,
  );

  return {
    selected,
    context,
    ids: selected.map(({ record }) => record.id),
  };
}
