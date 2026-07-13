// Phase-3b TS port of scope.py — deep-research stage-0 Scope: decompose a disease into
// complementary research angles. A thin wrapper over runAgent's forced-tool primitive (submit_angles).
// See docs/bun-migration-eval.md Phase 3 + deep-research-port-plan §5.
import { z } from "zod";

import { Budget, type CircuitBreaker, type OnMessage, runAgent, Semaphore } from "./orchestrate";

export const SCOPE_PROMPT =
  `Decompose this disease into complementary research angles for a DISEASE-OVERVIEW brief
that will focus downstream drug-target discovery. This is BACKGROUND CHARACTERIZATION of
the disease — NOT target nomination or scoring.

## Disease
{QUESTION}
{FOCUS}
## Task
Generate distinct, high-signal search queries that together characterize the disease from
these complementary angles. Cover every angle that applies; merge or drop one only if it is
clearly irrelevant for this disease:
1. Disease definition, subtypes & clinical classification
2. Affected tissues, cell types & key anatomy
3. Core pathological mechanisms (molecular & cellular)
4. Genetic architecture & heritability (risk loci to be identified by search) — the strongest target prior
5. Dysregulated pathways & gene families
6. Therapeutic landscape & clinical-trial status

For each angle: a \`label\`, a \`query\`, and a 1-2 sentence \`rationale\` for why it matters to
target discovery. Avoid redundancy.

Write each \`query\` as a SEARCH GOAL — describe WHAT to find for that angle, specific about the
DIMENSION and METHODS (e.g. GWAS / rare & LoF variants / single-cell / pathway enrichment /
approved drugs & trials). Do NOT pre-name specific genes, proteins, or drugs from prior
knowledge — discovering those is the downstream search's job; pre-baking unverified names
anchors the search and is not traceable.

Return the disease (verbatim or lightly normalized) and the angles. Call \`submit_angles\`
exactly once with {question, angles}; that is your only output (no prose answer, no
Sources list, no extra summary).`;

// submit_angles input schema (zod). The angle shape (label/query/rationale) is the essential
// contract; rationale optional — kept light to avoid over-rejecting (the prompt steers it).
export const ScopeAngle = z.object({ label: z.string(), query: z.string(), rationale: z.string().optional() });
export const SCOPE_SCHEMA = { question: z.string(), angles: z.array(ScopeAngle) };

export interface ScopeOpts {
  budget?: Budget;
  sem?: Semaphore;
  onMessage?: OnMessage;
  breaker?: CircuitBreaker; // fed the agent's outcome so a quota/rate-limit outage pauses (not a false empty)
  focus?: string; // optional user research focus — steers the angle set (Option A)
}

// The user's own research focus, injected between the disease and the angle checklist. The user is a
// domain expert who already knows the generic disease background, so when a focus is given the scope
// should CONCENTRATE on it rather than restate textbook overview. A focus that names a concrete
// target/gene/pathway/drug is allowed to be centered on (overriding the "don't pre-name" rule, which
// only bars the model from inventing names the user never gave).
export function focusBlock(focus?: string): string {
  const f = (focus ?? "").trim();
  if (!f) return "";
  return (
    `\n## User's research focus — PRIORITIZE THIS\n` +
    f +
    `\n\nThe user is a domain expert who already knows the generic disease background, so a textbook ` +
    `overview adds little. RESHAPE the angle set to concentrate on this focus: merge, drop, or re-scope ` +
    `the angles below so that together they directly serve it. If the focus names a specific target / ` +
    `gene / pathway / drug / modality / patient subtype, it is CORRECT to center angles on that named ` +
    `entity — that overrides the "do NOT pre-name" rule below, which only bars YOU from inventing names ` +
    `the user did not give. Do not invent OTHER unverified names beyond what the focus states.\n`
  );
}

/** Run the Scope phase. Returns {question, angles[], budget} or null if the agent never submitted. */
export async function scope(disease: string, opts: ScopeOpts = {}): Promise<Record<string, unknown> | null> {
  const budget = opts.budget ?? new Budget();
  const sem = opts.sem ?? new Semaphore(1);
  const prompt = SCOPE_PROMPT.replace("{QUESTION}", disease).replace("{FOCUS}", focusBlock(opts.focus));
  const [result] = await runAgent("scope", prompt, "submit_angles", SCOPE_SCHEMA, {}, budget, sem, {
    maxTurns: 6,
    onMessage: opts.onMessage,
    breaker: opts.breaker,
  });
  if (result) result.budget = budget.report();
  return result;
}
