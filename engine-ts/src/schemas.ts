// Phase-1 zod schemas — replace BOTH the Python pydantic models (src/dd_agent/schemas.py) AND the
// forced-tool JSON-Schema dicts (deep_research.py) AND orchestrate._schema_errors: zod does the
// structural validation natively (.safeParse). Designed to become the single source of truth shared
// with the frontend (kills the hand-maintained web/src/types/dda.ts mirror). See bun-migration-eval §5.
import { z } from "zod";

// ── forced submit_* input schemas (the engine's per-phase contracts) ──
export const SearchResultSchema = z.object({
  url: z.string().optional(), // web / database record-or-API URL
  doi: z.string().optional(), // paper sources
  title: z.string(),
  snippet: z.string().optional(),
  relevance: z.enum(["high", "medium", "low"]),
  source_type: z.enum(["web", "paper", "database"]),
});
export const SearchSchema = z.object({ results: z.array(SearchResultSchema).max(8) });

export const ClaimSchema = z.object({
  claim: z.string(),
  quote: z.string(),
  importance: z.enum(["central", "supporting", "tangential"]),
});
export const ExtractSchema = z.object({
  sourceQuality: z.enum(["primary", "secondary", "blog", "forum", "unreliable"]),
  publishDate: z.string().optional(),
  claims: z.array(ClaimSchema).max(5),
});

export const VerdictSubmitSchema = z.object({
  refuted: z.boolean(),
  evidence: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  counterSource: z.string().optional(),
});

export const FindingSchema = z.object({
  angle: z.string().optional(),
  claim: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  sources: z.array(z.string()),
  evidence: z.string(),
  vote: z.string().optional(),
});
export const ReportSchema = z.object({
  summary: z.string(),
  findings: z.array(FindingSchema),
  caveats: z.string(),
  openQuestions: z.array(z.string()).optional(),
});

// ── intake gate (disease validation) — the submit_intake forced-output tool ──
export const IntakeSchema = z.object({
  accepted: z.boolean(),
  normalized_en: z.string().default(""),
  efo_id: z.string().default(""),
  reason: z.string().default(""),
});

// ── per-angle map-reduce synthesis (#30 phase 3) ──
// MAP: one finding from a SINGLE angle's confirmed claims (angle injected by the caller).
export const AngleFindingSchema = z.object({
  claim: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  sources: z.array(z.string()),
  evidence: z.string(),
});
// REDUCE: the overview prose merged from the per-angle findings.
export const MergeSchema = z.object({
  summary: z.string(),
  caveats: z.string(),
  openQuestions: z.array(z.string()).optional(),
});

// ── shared data models (zod mirror of schemas.py) ──
export const EvidenceSchema = z.object({
  kind: z.string(),
  source: z.string(),
  detail: z.string().default(""),
  ref: z.string().default(""),
});
export const TargetCandidateSchema = z.object({
  symbol: z.string(),
  name: z.string().nullable().default(null),
  modality: z.string().nullable().default(null),
  evidence: z.array(EvidenceSchema).default([]),
  scores: z.record(z.string(), z.number()).default({}),
  rationale: z.string().default(""),
});

// ── nomination: submit_candidates forced-output — the ranked target list (hybrid: deterministic
// OpenTargets base + LLM enrichment). Reuses TargetCandidateSchema per candidate. ──
export const NominateSchema = z.object({ candidates: z.array(TargetCandidateSchema).default([]) });

export type SearchSubmit = z.infer<typeof SearchSchema>;
export type ExtractSubmit = z.infer<typeof ExtractSchema>;
export type VerdictSubmit = z.infer<typeof VerdictSubmitSchema>;
export type Report = z.infer<typeof ReportSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type TargetCandidate = z.infer<typeof TargetCandidateSchema>;
