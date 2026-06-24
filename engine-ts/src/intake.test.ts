// Intake-gate tests: the deterministic gate + validateDisease with an injected forced-tool agent
// (no SDK/network), incl. the CJK-codepoint fallback.
import { expect, test } from "bun:test";

import { intakeGate, validateDisease } from "./intake";

const fakeRunAgent = (submitValue: any) => (async () => [submitValue, []]) as any;
const noSearch = (async () => []) as any;

test("intakeGate: empty / too-long / no-alnum rejected; real names pass (incl. CJK)", () => {
  expect(intakeGate("")).toBe("empty input");
  expect(intakeGate("   ")).toBe("empty input");
  expect(intakeGate("x".repeat(201))).toContain("too long");
  expect(intakeGate("!!!")).toContain("no alphanumeric");
  expect(intakeGate("Alzheimer")).toBeNull();
  expect(intakeGate("阿尔茨海默病")).toBeNull();
});

test("validateDisease: gate reject short-circuits (agent never called)", async () => {
  let called = false;
  const r = await validateDisease("", { runAgent: ((..._a: any) => { called = true; return [null, []]; }) as any });
  expect(r.accepted).toBe(false);
  expect(r.reason).toContain("gate");
  expect(called).toBe(false);
});

test("validateDisease: agent accepts → returns the verdict", async () => {
  const r = await validateDisease("Alzheimer", {
    runAgent: fakeRunAgent({ accepted: true, normalized_en: "Alzheimer disease", efo_id: "EFO_0000249", reason: "EFO hit" }),
    searchDisease: noSearch,
  });
  expect(r.accepted).toBe(true);
  expect(r.efo_id).toBe("EFO_0000249");
  expect(r.normalized_en).toBe("Alzheimer disease");
});

test("validateDisease: agent never submits → rejected", async () => {
  const r = await validateDisease("Alzheimer", { runAgent: fakeRunAgent(null), searchDisease: noSearch });
  expect(r.accepted).toBe(false);
  expect(r.reason).toContain("did not call submit_intake");
});

test("validateDisease: CJK fallback — garbled non-ASCII name → codepoint translate + OT lookup", async () => {
  const r = await validateDisease("阿尔茨海默病", {
    runAgent: fakeRunAgent({ accepted: true, normalized_en: "Болезнь", efo_id: "", reason: "garbled" }), // non-ASCII
    translateCodepoints: (async () => "Alzheimer disease") as any,
    searchDisease: (async () => [{ id: "EFO_0000249", name: "Alzheimer disease" }]) as any,
  });
  expect(r.accepted).toBe(true);
  expect(r.efo_id).toBe("EFO_0000249");
  expect(r.reason).toContain("codepoints");
});

test("validateDisease: CJK rejected + fallback fails → rejected with explanation", async () => {
  const r = await validateDisease("乱码输入", {
    runAgent: fakeRunAgent({ accepted: false, normalized_en: "", efo_id: "", reason: "not a disease" }),
    translateCodepoints: (async () => null) as any,
    searchDisease: noSearch,
  });
  expect(r.accepted).toBe(false);
  expect(r.reason).toContain("fallback translation failed");
});

test("intakeGate accepts non-CJK non-ASCII scripts (Japanese/Korean) — Unicode-aware", () => {
  expect(intakeGate("がん")).toBeNull(); // Japanese
  expect(intakeGate("암")).toBeNull(); // Korean
});

test("validateDisease: a throwing fallback searchDisease never 500s — degrades to rejected", async () => {
  const r = await validateDisease("阿尔茨海默病", {
    runAgent: fakeRunAgent({ accepted: true, normalized_en: "Болезнь", efo_id: "", reason: "garbled" }),
    translateCodepoints: (async () => "Alzheimer disease") as any,
    searchDisease: (async () => { throw new Error("OT down"); }) as any,
  });
  expect(r.accepted).toBe(false);
  expect(r.reason).toContain("fallback translation failed");
});
