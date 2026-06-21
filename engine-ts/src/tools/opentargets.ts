// Phase-2b TS port of tools/opentargets.py — OpenTargets Platform GraphQL client.
// The GraphQL response PARSING is split into pure functions (parseAssociatedTargets /
// parseTargetProfile) so it is unit-testable from a fixture without network; the fetch wrappers
// are thin. See docs/bun-migration-eval.md Phase 2.
const API = "https://api.platform.opentargets.org/api/v4/graphql";

// complement genes — the genetics-first anchor for dry AMD.
export const COMPLEMENT = new Set([
  "CFH", "CFI", "CFB", "CFD", "C2", "C3", "C9", "C3AR1",
  "CFHR1", "CFHR3", "CFHR4", "CFHR5", "VTN", "SERPING1",
]);

const round4 = (x: number) => Math.round((x ?? 0) * 1e4) / 1e4;

const SEARCH_Q = `
query Search($q: String!, $size: Int!) {
  search(queryString: $q, entityNames: ["disease"], page: {index: 0, size: $size}) {
    hits { id name entity }
  }
}`;

const ASSOC_Q = `
query Assoc($efoId: String!, $size: Int!) {
  disease(efoId: $efoId) {
    id
    name
    associatedTargets(page: {index: 0, size: $size}) {
      count
      rows {
        target { id approvedSymbol approvedName }
        score
        datatypeScores { id score }
      }
    }
  }
}`;

const TARGET_SEARCH_Q = `
query TS($q: String!) {
  search(queryString: $q, entityNames: ["target"], page: {index: 0, size: 1}) {
    hits { id name entity }
  }
}`;

const TARGET_Q = `
query T($id: String!) {
  target(ensemblId: $id) {
    id
    approvedSymbol
    approvedName
    tractability { modality value label }
    geneticConstraint { constraintType score oe upperBin }
    safetyLiabilities { event datasource }
  }
}`;

export async function gql(query: string, variables: Record<string, unknown>, timeoutMs = 30_000): Promise<any> {
  let resp: Response;
  try {
    resp = await fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new Error(`OpenTargets request failed: ${(e as Error).message}`);
  }
  if (!resp.ok) throw new Error(`OpenTargets HTTP ${resp.status}`); // parity: urlopen raises on non-2xx
  const payload: any = await resp.json();
  if (payload.errors) throw new Error(`OpenTargets GraphQL errors: ${JSON.stringify(payload.errors)}`);
  return payload.data ?? {};
}

export interface DiseaseHit {
  id: string;
  name: string;
}

export async function searchDisease(name: string, size = 5): Promise<DiseaseHit[]> {
  const data = await gql(SEARCH_Q, { q: name, size });
  return (data.search?.hits ?? []).map((h: any) => ({ id: h.id, name: h.name }));
}

export interface AssocRow {
  symbol: string | null;
  name: string | null;
  target_id: string | null;
  overall: number;
  genetic: number;
  sort_score: number;
  datatypes: Record<string, number>;
}

/** Pure: GraphQL `data` → ranked rows by the `sortBy` datatype score (desc). Unit-testable. */
export function parseAssociatedTargets(data: any, sortBy: string) {
  const disease = data.disease ?? {};
  const rows: AssocRow[] = [];
  for (const r of disease.associatedTargets?.rows ?? []) {
    const dts: Record<string, number> = {};
    for (const d of r.datatypeScores ?? []) dts[d.id] = d.score;
    const tgt = r.target ?? {};
    const dtRounded: Record<string, number> = {};
    for (const [k, v] of Object.entries(dts)) dtRounded[k] = round4(v as number);
    rows.push({
      symbol: tgt.approvedSymbol ?? null,
      name: tgt.approvedName ?? null,
      target_id: tgt.id ?? null,
      overall: round4(r.score ?? 0),
      genetic: round4(dts.genetic_association ?? 0),
      sort_score: round4(dts[sortBy] ?? 0),
      datatypes: dtRounded,
    });
  }
  rows.sort((a, b) => b.sort_score - a.sort_score);
  return { disease: disease.name ?? null, efo_id: disease.id ?? null, sort_by: sortBy, rows };
}

export async function diseaseAssociatedTargets(efoId: string, size = 50, sortBy = "genetic_association") {
  return parseAssociatedTargets(await gql(ASSOC_Q, { efoId, size }), sortBy);
}

/** Pure: target GraphQL `data` → druggability/safety triage profile. Unit-testable. */
export function parseTargetProfile(data: any) {
  const t = data.target ?? {};
  const smTract: string[] = (t.tractability ?? [])
    .filter((b: any) => b.modality === "SM" && b.value)
    .map((b: any) => b.label);
  const constraint: Record<string, { score: unknown; oe: unknown; upperBin: unknown }> = {};
  for (const c of t.geneticConstraint ?? []) {
    constraint[c.constraintType] = { score: c.score, oe: c.oe, upperBin: c.upperBin };
  }
  return {
    symbol: t.approvedSymbol,
    target_id: t.id,
    sm_tractability: smTract,
    genetic_constraint: constraint,
    safety_liabilities: (t.safetyLiabilities ?? []).map((s: any) => s.event),
    has_known_drug: smTract.some((lbl) => {
      const l = (lbl || "").toLowerCase();
      return l.includes("approved") || l.includes("clinical");
    }),
  };
}

export async function targetProfile(symbol: string): Promise<Record<string, unknown>> {
  const s = await gql(TARGET_SEARCH_Q, { q: symbol });
  const hits = s.search?.hits ?? [];
  if (!hits.length) return {};
  return parseTargetProfile(await gql(TARGET_Q, { id: hits[0].id }));
}
