// Parity tests for the Phase-2b HTTP tools — the PURE transform/parse logic (no network), from
// fixtures shaped like the real OpenTargets / OpenAlex / S2 responses. Mirrors the behaviour of
// tools/opentargets.py + tools/paperfetch.py.
import { expect, test } from "bun:test";

import { parseAssociatedTargets, parseTargetProfile } from "./opentargets";
import { apa7Author, apa7Authors, clean, formatApa7, merge, normDoi, normOpenalex, normS2, reconstructAbstract } from "./paperfetch";

// ── OpenTargets ──
const ASSOC = {
  disease: {
    id: "EFO_0001365",
    name: "AMD",
    associatedTargets: {
      count: 2,
      rows: [
        { target: { id: "ENSG1", approvedSymbol: "CFH", approvedName: "complement factor H" },
          score: 0.85, datatypeScores: [{ id: "genetic_association", score: 0.9 }, { id: "rna_expression", score: 0.3 }] },
        { target: { id: "ENSG2", approvedSymbol: "FOO", approvedName: "foo" },
          score: 0.7, datatypeScores: [{ id: "genetic_association", score: 0.4 }, { id: "rna_expression", score: 0.8 }] },
      ],
    },
  },
};

test("parseAssociatedTargets ranks by the sortBy datatype (desc)", () => {
  const r = parseAssociatedTargets(ASSOC, "genetic_association");
  expect(r.rows.map((x) => x.symbol)).toEqual(["CFH", "FOO"]);
  expect(r.rows[0]!.sort_score).toBe(0.9);
  expect(r.rows[0]!.genetic).toBe(0.9);
  expect(r.rows[0]!.overall).toBe(0.85);
  expect(r.disease).toBe("AMD");
  expect(r.efo_id).toBe("EFO_0001365");
  // re-rank by a different datatype
  expect(parseAssociatedTargets(ASSOC, "rna_expression").rows.map((x) => x.symbol)).toEqual(["FOO", "CFH"]);
});

test("parseTargetProfile filters SM tractability + maps constraint/safety", () => {
  const tp = parseTargetProfile({
    target: {
      id: "ENSG1", approvedSymbol: "CFH", approvedName: "complement factor H",
      tractability: [
        { modality: "SM", value: true, label: "Approved Drug" },
        { modality: "SM", value: false, label: "Discovery" }, // value=false → out
        { modality: "AB", value: true, label: "Antibody" }, // not SM → out
      ],
      geneticConstraint: [{ constraintType: "lof", score: 1.2, oe: 0.3, upperBin: 2 }],
      safetyLiabilities: [{ event: "hepatotoxicity", datasource: "x" }],
    },
  }) as any;
  expect(tp.sm_tractability).toEqual(["Approved Drug"]);
  expect(tp.genetic_constraint.lof.upperBin).toBe(2);
  expect(tp.safety_liabilities).toEqual(["hepatotoxicity"]);
  expect(tp.has_known_drug).toBe(true);
});

// ── paperfetch ──
test("normDoi strips scheme prefixes + lowercases", () => {
  expect(normDoi("https://doi.org/10.1/AbC")).toBe("10.1/abc");
  expect(normDoi("doi:10.2/X")).toBe("10.2/x");
  expect(normDoi(null)).toBe("");
});

test("clean strips HTML tags + unescapes entities", () => {
  expect(clean("CFH and <i>AMD</i> &amp; risk")).toBe("CFH and AMD & risk");
  expect(clean("H&#8322;O")).toBe("H₂O");
});

test("reconstructAbstract rebuilds from the inverted index", () => {
  expect(reconstructAbstract({ Hello: [0], world: [1] })).toBe("Hello world");
  expect(reconstructAbstract(null)).toBe("");
});

test("normOpenalex maps a work record", () => {
  const p = normOpenalex({
    doi: "https://doi.org/10.1/AbC",
    ids: { pmid: "https://pubmed.ncbi.nlm.nih.gov/12345/" },
    title: "CFH and <i>AMD</i>",
    publication_year: 2020,
    primary_location: { source: { display_name: "Nature" } },
    authorships: [{ author: { display_name: "Jane Doe" } }, { author: { display_name: "" } }],
    cited_by_count: 42,
    open_access: { is_oa: true },
    abstract_inverted_index: { Hello: [0], world: [1] },
  });
  expect(p.doi).toBe("10.1/abc");
  expect(p.pmid).toBe("12345");
  expect(p.title).toBe("CFH and AMD");
  expect(p.venue).toBe("Nature");
  expect(p.authors).toEqual(["Jane Doe"]);
  expect(p.is_oa).toBe(true);
  expect(p.abstract).toBe("Hello world");
  expect(p.source).toBe("openalex");
});

test("normS2 maps a paper record", () => {
  const p = normS2({
    externalIds: { DOI: "10.1/XyZ", PubMed: 999 },
    journal: { name: "Cell" },
    title: "S2 paper",
    year: 2021,
    authors: [{ name: "Bob" }, {}],
    citationCount: 5,
    openAccessPdf: { url: "x" },
    abstract: "abs",
    tldr: { text: "summary" },
  });
  expect(p.doi).toBe("10.1/xyz");
  expect(p.pmid).toBe("999");
  expect(p.venue).toBe("Cell");
  expect(p.authors).toEqual(["Bob"]);
  expect(p.is_oa).toBe(true);
  expect(p.tldr).toBe("summary");
});

test("merge dedups by DOI + backfills empty fields + unions sources", () => {
  const a = normOpenalex({ doi: "10.1/x", title: "T", publication_year: 2020 });
  const b = normS2({ externalIds: { DOI: "10.1/X" }, title: "T", abstract: "from s2" });
  const m = merge([a], [b]);
  expect(m.length).toBe(1); // same DOI, case-insensitive
  expect(m[0]!.source).toBe("openalex+semantic_scholar");
  expect(m[0]!.abstract).toBe("from s2"); // backfilled (openalex had none)
});

test("APA7 author + author-list + reference formatting", () => {
  expect(apa7Author("James S. Jumper")).toBe("Jumper, J. S.");
  expect(apa7Author("Madonna")).toBe("Madonna");
  expect(apa7Authors(["A B", "C D"])).toBe("B, A., & D, C.");
  expect(formatApa7({ authors: ["Jane Doe"], year: 2020, title: "A study.", venue: "Nature", doi: "10.1/x" })).toBe(
    "Doe, J. (2020). A study. *Nature*. https://doi.org/10.1/x",
  );
});
