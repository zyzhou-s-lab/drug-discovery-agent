// Per-campaign structured layers. TWO layers live here, with a deliberate read/write split (CQRS):
//
//   deepresearch/  = WRITE MODEL / source of truth. One folder per workflow step, one JSON per
//                    sub-agent, written incrementally as each agent finishes (crash-safe). Lossless
//                    audit trail. (writeStepItem; see DEEPRESEARCH_SUBDIR below.)
//   assets/        = READ MODEL / compute-facing contract. Clean, by-kind projections the downstream
//                    COMPUTE / ANALYSIS steps (nomination → validation / perturbation) consume
//                    instead of re-parsing report.json. DERIVED from deepresearch/ (deriveAssets), so
//                    it can never drift from the source of truth and is rebuildable at any time:
//   {artifacts}/{campaign}/assets/
//     ├── sources.json          # overview: source/literature list + numbered bibliography
//     ├── database_facts.json   # overview: structured database/ontology records (EFO/MONDO/GWAS…)
//     ├── verified.json         # the 3-vote confirmed/refuted ledger
//     ├── findings.json         # per-angle synthesized findings
//     └── candidates.json       # nomination: ranked TargetCandidate[] (genes validation perturbs)
// Each file is a self-describing envelope ({campaign, stage/step, count, <payload>}). Writes are
// atomic and idempotent (a re-run overwrites its own files). See issue #30.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const ASSETS_SUBDIR = "assets";

export function assetsDir(artifactsRoot: string, campaign: string): string {
  return join(artifactsRoot, campaign, ASSETS_SUBDIR);
}

// Per-step deep-research record (issue: per-sub-agent artifacts). Distinct from the assets/ layer:
// assets/ is the clean compute-facing hand-off (one file per asset KIND); deepresearch/ is the audit
// trail of every sub-agent, grouped by the five workflow steps —
//   {artifacts}/{campaign}/deepresearch/
//     ├── 01_scope/       scope.json                  (single scope agent)
//     ├── 02_search/      00_<angle>.json …           (one per angle's search agent)
//     ├── 03_fetch/       00_<source>.json …          (one per source's fetch/extract agent)
//     ├── 04_verify/      00_<claim>.json …           (one per claim's 3-vote verification)
//     └── 05_synthesize/  00_<angle>.json … merge.json (per-angle map + the reduce/merge)
// Steps are multi-agent (search/fetch/verify), hence a FOLDER per step rather than one file.
export const DEEPRESEARCH_SUBDIR = "deepresearch";

/** Directory holding one deep-research step's per-sub-agent files, e.g. .../deepresearch/02_search/. */
export function stepDir(artifactsRoot: string, campaign: string, step: string): string {
  return join(artifactsRoot, campaign, DEEPRESEARCH_SUBDIR, step);
}

/** Filesystem-safe slug from an arbitrary label: lowercase, runs of non-alphanumerics → '-',
 * trimmed of leading/trailing dashes, capped. Empty/garbage input → "item" so a name always exists.
 * (Digits survive, so a "00_" ordering prefix becomes "00-…".) */
export function slugify(s: string, max = 64): string {
  const out = String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return out || "item";
}

/** Write ONE sub-agent's output as deepresearch/{step}/{slug(key)}.json, atomically + idempotently
 * (a re-run overwrites its own file). The payload is wrapped in a self-describing envelope
 * ({campaign, step, key, ...payload}). `key` is the human label (e.g. "00_genetic-architecture");
 * it is slugified for the filename but preserved verbatim in the envelope. Returns the path. */
export function writeStepItem(
  artifactsRoot: string,
  campaign: string,
  step: string,
  key: string,
  payload: Record<string, unknown>,
): string {
  const path = join(stepDir(artifactsRoot, campaign, step), slugify(key) + ".json");
  // JSON deep-clone before write (≡ writeAsset): also rejects a non-serializable payload by throwing
  // here, which research's doPersistStep catches + surfaces via the event stream.
  writeAtomic(path, { campaign, step, key, ...JSON.parse(JSON.stringify(payload)) });
  return path;
}

/** Atomic write (tmp + rename); never leave an orphan .tmp behind on failure. */
function writeAtomic(path: string, obj: unknown): void {
  const tmp = path + ".tmp";
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf-8");
    renameSync(tmp, path);
  } catch (e) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* best-effort cleanup */
    }
    throw e;
  }
}

/** Read every {step}/*.json under deepresearch/, sorted by file name. The "NN_" ordering prefix
 * makes the lexical sort match execution / angle order. Missing dir → []; a corrupt file is skipped
 * (faithful to loadAsset's tolerance), so a partial/crashed deepresearch still derives cleanly. */
function readStep(artifactsRoot: string, campaign: string, step: string): any[] {
  const dir = stepDir(artifactsRoot, campaign, step);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(dir, f), "utf-8"));
      } catch {
        return null; // corrupt/partial file → skip
      }
    })
    .filter((x): x is any => x != null);
}

/** Derive the compute-facing assets/ contract by REDUCING the deepresearch/ per-sub-agent record —
 * the single source of truth. assets/ is never written in parallel from memory, so it cannot drift
 * from deepresearch/ (and can be rebuilt at any time, e.g. after a crash, by re-reading the steps).
 *
 * `references` is the run's bibliography (a cross-source, network-enriched projection computed once
 * by research() and threaded through; not reconstructable from a single step file). Writes
 * sources.json / database_facts.json / verified.json / findings.json. Returns the paths written. */
export function deriveAssets(artifactsRoot: string, campaign: string, references: any[] = []): string[] {
  const question = readStep(artifactsRoot, campaign, "01_scope")[0]?.question ?? null;
  const fetched = readStep(artifactsRoot, campaign, "03_fetch"); // {url,title,angle,source_type,doi,sourceQuality,claims[]}
  const verifies = readStep(artifactsRoot, campaign, "04_verify"); // {claim,source,doi,angle,quote,survives,vote,verdicts}
  const findingItems = readStep(artifactsRoot, campaign, "05_synthesize").filter((f) => f.key !== "merge");

  // sources.json — fetched-source list (+ the bibliography)
  const sources = fetched.map((s) => ({ url: s.url, quality: s.sourceQuality, angle: s.angle, claimCount: (s.claims ?? []).length }));

  // verify-status index (claim|source → confirmed/refuted/unverified), shared by facts + verified
  const ok = new Set(verifies.filter((v) => v.survives).map((v) => v.claim + "|" + v.source));
  const no = new Set(verifies.filter((v) => !v.survives).map((v) => v.claim + "|" + v.source));
  const statusOf = (claim: string, src: string) => (ok.has(claim + "|" + src) ? "confirmed" : no.has(claim + "|" + src) ? "refuted" : "unverified");

  // database_facts.json — database-typed claims from fetch, annotated with their verify status
  const facts: any[] = [];
  for (const s of fetched) {
    for (const c of s.claims ?? []) {
      if (c.source_type !== "database") continue;
      const src = c.sourceUrl ?? s.url;
      facts.push({ claim: c.claim, quote: c.quote, source: src, doi: c.doi ?? s.doi, quality: s.sourceQuality, status: statusOf(c.claim, src), raw: c.raw });
    }
  }

  // verified.json — the confirmed/refuted ledger from the 3-vote verification
  const confirmed = verifies.filter((v) => v.survives).map((v) => ({ claim: v.claim, source: v.source, quote: v.quote, vote: v.vote }));
  const refuted = verifies.filter((v) => !v.survives).map((v) => ({ claim: v.claim, vote: v.vote, source: v.source }));

  // findings.json — per-angle findings in angle order (files already lexically sorted by NN_ prefix)
  const findings = findingItems.map((f) => ({ angle: f.angle, claim: f.claim, confidence: f.confidence, sources: f.sources, evidence: f.evidence }));

  return [
    writeAsset(artifactsRoot, campaign, "sources", { stage: "disease-overview", question, count: sources.length, sources, references }),
    writeAsset(artifactsRoot, campaign, "database_facts", { stage: "disease-overview", question, count: facts.length, facts }),
    writeAsset(artifactsRoot, campaign, "verified", { stage: "deep-research", question, count: confirmed.length, confirmed, refuted }),
    writeAsset(artifactsRoot, campaign, "findings", { stage: "deep-research", question, count: findings.length, findings }),
  ];
}

/** Generic single-asset writer (issue #30 §C) — write `payload` to {assets}/{name}.json with the
 * campaign stamped in, atomically. The primitive deriveAssets() uses to emit each reduced asset
 * (sources / database_facts / verified / findings). Returns the path written. */
export function writeAsset(artifactsRoot: string, campaign: string, name: string, payload: Record<string, unknown>): string {
  // every asset file is JSON — ensure a .json suffix (a bare "sources" → "sources.json"); loadAsset
  // applies the identical rule, so the two are symmetric.
  const file = name.endsWith(".json") ? name : name + ".json";
  const path = join(assetsDir(artifactsRoot, campaign), file);
  // JSON deep clone before write — consistent with writeCandidates; also rejects a non-serializable
  // payload (circular) by throwing here.
  writeAtomic(path, { campaign, ...JSON.parse(JSON.stringify(payload)) });
  return path;
}

/** Write nomination's ranked TargetCandidate[] as candidates.json — the gene list (+ scores,
 * modality, evidence) the validation / perturbation step consumes. Returns the path written. */
export function writeCandidates(
  candidates: any[],
  artifactsRoot: string,
  campaign: string,
  opts: { efoId?: string; sortBy?: string } = {},
): string {
  // JSON deep clone so a later mutation of the caller's objects can't leak into the (already
  // serialized) asset; JSON-clone (not structuredClone) matches the eventual serialization exactly
  // and can't throw DataCloneError on a function/Symbol that an `any` candidate might carry.
  const rows = candidates.map((c) => (c && typeof c === "object" ? JSON.parse(JSON.stringify(c)) : c));
  const path = join(assetsDir(artifactsRoot, campaign), "candidates.json");
  writeAtomic(path, { campaign, stage: "nomination", efo_id: opts.efoId ?? "", sort_by: opts.sortBy ?? "", count: rows.length, candidates: rows });
  return path;
}

/** Read one asset by file name (e.g. 'database_facts.json'); null if absent/unreadable. The entry
 * point for a downstream compute step to pick up an upstream stage's hand-off. */
export function loadAsset(artifactsRoot: string, campaign: string, name: string): any | null {
  const file = name.endsWith(".json") ? name : name + ".json"; // accept "sources" or "sources.json" (≡ writeAsset)
  const p = join(assetsDir(artifactsRoot, campaign), file);
  if (!existsSync(p)) return null; // absent → null (skip constructing/catching an ENOENT)
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return null; // present but unreadable/corrupt → null (faithful to assets.py's OSError|ValueError)
  }
}
