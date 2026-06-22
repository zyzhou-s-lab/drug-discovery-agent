// Phase-5 cutover parity check — a STRUCTURAL diff of two deep-research reports (Python vs TS) for
// the same campaign. The LLM content (claims, sources, summary text) varies run-to-run, so we never
// compare values; we compare SHAPE: the top-level keys, the element keys of the array fields
// (findings/sources/references/databaseFacts/refuted), and the stats keys. If the shapes match, the
// TS engine is producing a report the frontend + downstream read identically. See bun-migration-eval Phase 5.

function keysOf(o: unknown): string[] {
  return o && typeof o === "object" && !Array.isArray(o) ? Object.keys(o).sort() : [];
}

/** Element keys of an array field — the UNION across elements (a single sample can miss optional keys). */
function arrayElemKeys(arr: unknown): string[] {
  if (!Array.isArray(arr) || !arr.length) return [];
  const all = new Set<string>();
  for (const el of arr) for (const k of keysOf(el)) all.add(k);
  return [...all].sort();
}

function diffSets(label: string, a: string[], b: string[]): string[] {
  const onlyA = a.filter((k) => !b.includes(k));
  const onlyB = b.filter((k) => !a.includes(k));
  if (!onlyA.length && !onlyB.length) return [];
  return [`${label}: only in A=[${onlyA.join(",")}] only in B=[${onlyB.join(",")}]`];
}

export interface ParityResult {
  ok: boolean;
  diffs: string[];
}

const ARRAY_FIELDS = ["findings", "sources", "references", "databaseFacts", "refuted"] as const;

/** Structural parity of report A (e.g. Python) vs report B (e.g. TS). ok=true ⇒ same shape. */
export function reportParity(a: any, b: any): ParityResult {
  const diffs: string[] = [];
  diffs.push(...diffSets("top-level keys", keysOf(a), keysOf(b)));
  for (const f of ARRAY_FIELDS) {
    // only compare when BOTH have the field present (a salvage report may omit some)
    if (a?.[f] !== undefined && b?.[f] !== undefined) {
      diffs.push(...diffSets(`${f}[] element keys`, arrayElemKeys(a[f]), arrayElemKeys(b[f])));
    }
  }
  diffs.push(...diffSets("stats keys", keysOf(a?.stats), keysOf(b?.stats)));
  return { ok: diffs.length === 0, diffs };
}
