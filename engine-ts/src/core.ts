// Phase-1 TS port of the deep-research pure-logic core — faithful 1:1 of
// src/dd_agent/research/deep_research.py (norm_url / source_key / dedup_results / rank_claims /
// survives) + orchestrate.py (Budget). No IO, no SDK, no model. Parity verified against the
// Python unit tests (see core.test.ts, mirrors tests/test_deep_research.py). See
// docs/bun-migration-eval.md Phase 1.

/** Read an int from env, clamped to [lo,hi]; falls back to `def` on missing/garbage. Lets the
 * deep-research workload knobs be tuned via env / settings.json (DD_DR_*) instead of being hardcoded
 * — they are the dominant drivers of how many agent sessions a run spawns. */
export function clampInt(raw: string | undefined, def: number, lo: number, hi: number): number {
  const n = parseInt(raw ?? "", 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
}

// Workload knobs (defaults preserve prior behavior). Boot-time (env read at startup);
// DD_DR_MAX_CLAIMS / DD_DR_MAX_FETCH are ALSO read live inside research() so the Settings UI takes
// effect on the next run without a restart. DD_DR_VOTES / DD_DR_REFUTE need an engine restart.
export const VOTES_PER_CLAIM = clampInt(process.env.DD_DR_VOTES, 3, 1, 5);
export const REFUTATIONS_REQUIRED = clampInt(process.env.DD_DR_REFUTE, Math.ceil(VOTES_PER_CLAIM / 2), 1, VOTES_PER_CLAIM);
export const MAX_FETCH = clampInt(process.env.DD_DR_MAX_FETCH, 15, 1, 100);
export const MAX_VERIFY_CLAIMS = clampInt(process.env.DD_DR_MAX_CLAIMS, 25, 1, 80);
export const MAX_DB_RAW = 80_000;

export const REL_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
export const IMP_RANK: Record<string, number> = { central: 0, supporting: 1, tangential: 2 };
export const QUAL_RANK: Record<string, number> = { primary: 0, secondary: 1, blog: 2, forum: 3, unreliable: 4 };
export const CONF_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

export function normUrl(u: string): string {
  try {
    const p = new URL(u);
    let host = p.hostname || "";
    if (host.startsWith("www.")) host = host.slice(4);
    return (host + p.pathname.replace(/\/+$/, "")).toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}

export interface SearchResult {
  url?: string;
  doi?: string;
  title?: string;
  snippet?: string;
  relevance?: string;
  source_type?: string;
  [k: string]: unknown;
}

/** Dedup identity: papers by DOI, web/database by normalized URL. */
export function sourceKey(r: SearchResult): string {
  const doi = (r.doi || "").trim().toLowerCase();
  return doi ? "doi:" + doi : normUrl(r.url || "");
}

export interface SeenEntry {
  angle: string;
  title?: string;
}

/**
 * Port of the blueprint's per-searcher dedup. MUTATES seen / slots / dupes / budgetDropped.
 * `slots` is a 1-element tuple (shared mutable fetch budget). Returns the novel results to fetch.
 * High-relevance (rank 0) bypasses the budget gate; rank >= 1 is dropped once slots run out.
 */
export function dedupResults(
  results: SearchResult[],
  angle: string,
  seen: Record<string, SeenEntry>,
  slots: [number],
  dupes: unknown[],
  budgetDropped: unknown[],
): SearchResult[] {
  const ordered = [...results].sort(
    (a, b) => (REL_RANK[a.relevance ?? ""] ?? 3) - (REL_RANK[b.relevance ?? ""] ?? 3),
  );
  const novel: SearchResult[] = [];
  for (const r of ordered) {
    const key = sourceKey(r);
    if (key in seen) {
      dupes.push({ ...r, angle, dupOf: seen[key] });
      continue;
    }
    if (slots[0] <= 0 && (REL_RANK[r.relevance ?? ""] ?? 3) >= 1) {
      budgetDropped.push({ ...r, angle });
      continue;
    }
    seen[key] = { angle, title: r.title };
    slots[0] -= 1;
    novel.push(r);
  }
  return novel;
}

export interface Claim {
  importance?: string;
  sourceQuality?: string;
  [k: string]: unknown;
}

/**
 * Rank by (importance, source quality), then verify AT LEAST the whole top tier
 * (central + primary) so the highest-value claims are never dropped. `limit` is the floor,
 * 80 the safety ceiling on the expensive verify phase.
 */
export function rankClaims(claims: Claim[], limit = MAX_VERIFY_CLAIMS): Claim[] {
  const ranked = [...claims].sort((a, b) => {
    const ia = IMP_RANK[a.importance ?? ""] ?? 3;
    const ib = IMP_RANK[b.importance ?? ""] ?? 3;
    if (ia !== ib) return ia - ib;
    return (QUAL_RANK[a.sourceQuality ?? ""] ?? 5) - (QUAL_RANK[b.sourceQuality ?? ""] ?? 5);
  });
  const nCp = claims.filter((c) => c.importance === "central" && c.sourceQuality === "primary").length;
  const cap = Math.min(Math.max(nCp, limit), 80);
  return ranked.slice(0, cap);
}

export interface Verdict {
  refuted?: boolean;
  [k: string]: unknown;
}

/**
 * Survive only if adjudicated: a quorum of valid votes AND fewer than REFUTATIONS_REQUIRED
 * refuting. Too many abstentions = unverified, must NOT pass. Mirrors Python's `if v` truthiness:
 * a null/undefined vote OR an empty {} (a malformed/empty submit) counts as an abstention.
 */
export function survives(verdicts: Array<Verdict | null | undefined>): boolean {
  const valid = verdicts.filter((v): v is Verdict => v != null && Object.keys(v).length > 0);
  const refuted = valid.filter((v) => v.refuted).length;
  return valid.length >= REFUTATIONS_REQUIRED && refuted < REFUTATIONS_REQUIRED;
}

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
}

/**
 * Token accounting across phases (port of orchestrate.Budget). totalTokens=null → no cap (work is
 * bounded structurally by MAX_FETCH/MAX_VERIFY_CLAIMS/VOTES). usd is advisory only — the SDK prices
 * as if Claude, unreliable on 3rd-party backends.
 */
export class Budget {
  totalTokens: number | null;
  byPhase: Record<string, { in: number; out: number; cache: number; usd: number; calls: number }> = {};

  constructor(totalTokens: number | null = null) {
    this.totalTokens = totalTokens;
  }

  add(phase: string, usage: Usage = {}, usd = 0): void {
    const b = (this.byPhase[phase] ??= { in: 0, out: 0, cache: 0, usd: 0, calls: 0 });
    b.in += usage.input_tokens ?? 0;
    b.out += usage.output_tokens ?? 0;
    b.cache += usage.cache_read_input_tokens ?? 0;
    b.usd += usd ?? 0;
    b.calls += 1;
  }

  spent(): number {
    return Object.values(this.byPhase).reduce((s, p) => s + p.in + p.out, 0);
  }

  exhausted(): boolean {
    return !!this.totalTokens && this.spent() >= this.totalTokens;
  }

  report() {
    return { spent_tokens: this.spent(), by_phase: this.byPhase };
  }
}
