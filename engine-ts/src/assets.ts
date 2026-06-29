// Per-campaign structured ASSET layer — TS port of research/assets.py. Clean, typed projections of a
// stage's output, written next to the report so the downstream COMPUTE / ANALYSIS steps (nomination →
// validation / perturbation) consume a stable contract instead of re-parsing the large report.json.
//
// NOT a cross-session index — it is the inter-stage data hand-off, one assets/ dir per campaign, one
// file per asset kind:
//   {artifacts}/{campaign}/assets/
//     ├── sources.json          # overview: source/literature list + numbered bibliography
//     ├── database_facts.json   # overview: structured database/ontology records (EFO/MONDO/GWAS…)
//     └── candidates.json       # nomination: ranked TargetCandidate[] (genes validation perturbs)
// Each file is a self-describing envelope ({campaign, stage, count, <payload>}). Writes are atomic
// and idempotent (a re-run overwrites its own assets). See issue #30.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
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

/** Project a deep-research overview report into the compute-facing assets: sources.json (the
 * literature/source list + numbered bibliography) and database_facts.json (the structured
 * database/ontology records). Returns the paths written. Idempotent. */
export function writeOverviewAssets(report: any, artifactsRoot: string, campaign: string): string[] {
  const d = assetsDir(artifactsRoot, campaign);
  const question = report?.question ?? null; // explicit null so the key is always present (≡ assets.py report.get)
  const sources = report?.sources ?? [];
  const references = report?.references ?? [];
  const facts = report?.databaseFacts ?? [];

  const srcPath = join(d, "sources.json");
  const dbPath = join(d, "database_facts.json");
  writeAtomic(srcPath, { campaign, stage: "disease-overview", question, count: sources.length, sources, references });
  writeAtomic(dbPath, { campaign, stage: "disease-overview", question, count: facts.length, facts });
  return [srcPath, dbPath];
}

/** Generic single-asset writer (issue #30 §C) — write `payload` to {assets}/{name}.json with the
 * campaign stamped in, atomically. The primitive behind research()'s incremental per-stage
 * checkpoints (sources / database_facts / verified), so a crashed run still leaves the structured
 * data its predecessor stages produced. Returns the path written. */
export function writeAsset(artifactsRoot: string, campaign: string, name: string, payload: Record<string, unknown>): string {
  // every asset file is JSON — ensure a .json suffix (a bare "sources" → "sources.json"); loadAsset
  // applies the identical rule, so the two are symmetric.
  const file = name.endsWith(".json") ? name : name + ".json";
  const path = join(assetsDir(artifactsRoot, campaign), file);
  // JSON deep clone before write — consistent with writeCandidates; also rejects a non-serializable
  // payload (circular) by throwing here, which research's doPersist catches + surfaces via ev.
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
