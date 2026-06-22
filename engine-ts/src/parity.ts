// Phase-5 cutover parity check — a STRUCTURAL diff of two deep-research reports (Python vs TS) for
// the same campaign. The LLM content (claims, sources, summary text) varies run-to-run, so we never
// compare values; we compare SHAPE: the top-level keys, the element keys of the array fields
// (findings/sources/references/databaseFacts/refuted), and the stats keys. If the shapes match, the
// TS engine is producing a report the frontend + downstream read identically. See bun-migration-eval Phase 5.

function keysOf(o: unknown): string[] {
  return o && typeof o === "object" && !Array.isArray(o) ? Object.keys(o).sort() : [];
}

/** Element keys of an array field — the UNION across elements (a single sample can miss optional
 * keys). NB: a field PRESENT on one report but MISSING on the other is caught by the top-level-keys
 * diff, not here (here we only compare element shape when BOTH sides have the array). */
function arrayElemKeys(arr: unknown): string[] {
  if (!Array.isArray(arr) || !arr.length) return [];
  const all = new Set<string>();
  for (const el of arr) for (const k of keysOf(el)) all.add(k);
  return [...all].sort();
}

function diffSets(label: string, a: string[], b: string[]): string[] {
  const setA = new Set(a);
  const setB = new Set(b);
  const onlyA = a.filter((k) => !setB.has(k));
  const onlyB = b.filter((k) => !setA.has(k));
  if (!onlyA.length && !onlyB.length) return [];
  return [`${label}: only in A=[${onlyA.join(",")}] only in B=[${onlyB.join(",")}]`];
}

function isPlainObject(o: unknown): o is Record<string, unknown> {
  return !!o && typeof o === "object" && !Array.isArray(o);
}

export interface ParityResult {
  ok: boolean;
  diffs: string[];
}

const ARRAY_FIELDS = ["findings", "sources", "references", "databaseFacts", "refuted"] as const;

/** Structural parity of report A (e.g. Python) vs report B (e.g. TS). ok=true ⇒ same shape. */
export function reportParity(a: unknown, b: unknown): ParityResult {
  // guard: a non-object (null / number / a non-JSON-object file) must not silently pass parity
  if (!isPlainObject(a) || !isPlainObject(b)) {
    return { ok: false, diffs: ["inputs must be plain JSON objects (got a non-object)"] };
  }
  const diffs: string[] = [];
  diffs.push(...diffSets("top-level keys", keysOf(a), keysOf(b)));
  for (const f of ARRAY_FIELDS) {
    // only compare when BOTH have the field present (a salvage report may omit some)
    if (a[f] !== undefined && b[f] !== undefined) {
      diffs.push(...diffSets(`${f}[] element keys`, arrayElemKeys(a[f]), arrayElemKeys(b[f])));
    }
  }
  diffs.push(...diffSets("stats keys", keysOf(a.stats), keysOf(b.stats)));
  diffs.push(...diffSets("budget keys", keysOf(a.budget), keysOf(b.budget)));
  return { ok: diffs.length === 0, diffs };
}
