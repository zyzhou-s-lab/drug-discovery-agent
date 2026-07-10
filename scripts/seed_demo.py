"""Seed an illustrative dry-AMD discovery campaign into an Index (offline demo data).

Why: real stage-1..3 runs need the Agent SDK + API keys + live OpenTargets/Europe PMC
calls and take minutes. For a frontend demo we persist ONE realistic campaign that
mirrors the documented M1-M3b results (PROGRESS.md): genetics-first nomination ->
real-PMID literature -> druggability/constraint/safety selection. The frontend reads
this read-only; nothing here calls an LLM.

Human-readable text is Chinese (the UI is Chinese); gene symbols / PMIDs / score keys
stay as-is. Complement (CFH/C3/CFB/CFI/C9) + ARMS2/HTRA1 are the established dry-AMD
loci, and every literature PMID is a real, verified AMD paper (Klein/Edwards/Hageman
2005, Yates 2007 NEJM, Fritsche 2016 Nat Genet GWAS). Stage-4 target-validation is
intentionally left 'queued' — it is M4, not yet implemented.

Run:  python scripts/seed_demo.py --db /tmp/dd-demo/state.sqlite --artifacts /tmp/dd-demo/artifacts
"""
from __future__ import annotations

import argparse

from dd_agent.index import Index
from dd_agent.schemas import Evidence, NodeOutput, TargetCandidate, Verdict

CAMPAIGN = "dryamd-seed"
DISEASE = "干性 AMD（地图样萎缩）"


def _ev(kind: str, source: str, detail: str = "", ref: str = "") -> Evidence:
    return Evidence(kind=kind, source=source, detail=detail, ref=ref)


# --- stage 1: target-hypothesis (scatter over 4 angles -> merged & ranked) ---
def stage1() -> NodeOutput:
    c = [
        TargetCandidate(symbol="CFH", name="补体因子 H", modality="small_molecule",
            evidence=[_ev("genetic", "OpenTargets", "遗传关联 0.92（Y402H, rs1061170）"),
                      _ev("network", "OpenTargets", "通路：补体旁路途径"),
                      _ev("expression", "OpenTargets", "RPE/脉络膜高表达"),
                      _ev("literature", "OpenTargets", "与 AMD 高频共现")],
            scores={"association": 0.92}, rationale="干性 AMD 最强遗传信号；补体调控因子"),
        TargetCandidate(symbol="C3", name="补体 C3", modality="small_molecule",
            evidence=[_ev("genetic", "OpenTargets", "遗传关联 0.86（R102G）"),
                      _ev("network", "OpenTargets", "通路：补体中心节点"),
                      _ev("literature", "OpenTargets", "与 AMD 共现")],
            scores={"association": 0.86}, rationale="补体核心组分；通路汇聚节点"),
        TargetCandidate(symbol="ARMS2", name="年龄相关黄斑病易感基因 2", modality=None,
            evidence=[_ev("genetic", "OpenTargets", "遗传关联 0.79（A69S, rs10490924）")],
            scores={"association": 0.79}, rationale="AMD 第二大易感位点（10q26）"),
        TargetCandidate(symbol="HTRA1", name="HtrA 丝氨酸蛋白酶 1", modality="small_molecule",
            evidence=[_ev("genetic", "OpenTargets", "遗传关联 0.74（10q26，与 ARMS2 连锁）"),
                      _ev("expression", "OpenTargets", "RPE 表达异常")],
            scores={"association": 0.74}, rationale="10q26 位点的丝氨酸蛋白酶；酶类靶点可成药"),
        TargetCandidate(symbol="CFB", name="补体因子 B", modality="small_molecule",
            evidence=[_ev("genetic", "OpenTargets", "遗传关联 0.61"),
                      _ev("network", "OpenTargets", "通路：旁路途径 C3 转化酶")],
            scores={"association": 0.61}, rationale="旁路途径蛋白酶；存在保护性单倍型"),
        TargetCandidate(symbol="CFI", name="补体因子 I", modality="small_molecule",
            evidence=[_ev("genetic", "OpenTargets", "遗传关联 0.55（罕见编码变异）"),
                      _ev("network", "OpenTargets", "通路：补体调控")],
            scores={"association": 0.55}, rationale="罕见高外显率调控因子变异"),
        TargetCandidate(symbol="C9", name="补体 C9", modality="small_molecule",
            evidence=[_ev("genetic", "OpenTargets", "遗传关联 0.50（P167S）"),
                      _ev("network", "OpenTargets", "通路：膜攻击复合物")],
            scores={"association": 0.50}, rationale="MAC 末端组分"),
        TargetCandidate(symbol="C2", name="补体 C2", modality="small_molecule",
            evidence=[_ev("genetic", "OpenTargets", "遗传关联 0.48（保护性）"),
                      _ev("network", "OpenTargets", "通路：经典/凝集素途径 C3 转化酶")],
            scores={"association": 0.48}, rationale="保护性位点；经典途径"),
        TargetCandidate(symbol="APOE", name="载脂蛋白 E", modality=None,
            evidence=[_ev("genetic", "OpenTargets", "遗传关联 0.45（e2/e4）"),
                      _ev("literature", "OpenTargets", "玻璃膜疣中的脂质代谢")],
            scores={"association": 0.45}, rationale="脂质/玻璃膜疣生物学；e4 在 AMD 中呈保护性"),
        TargetCandidate(symbol="TIMP3", name="金属蛋白酶组织抑制因子 3", modality=None,
            evidence=[_ev("genetic", "OpenTargets", "遗传关联 0.40"),
                      _ev("expression", "OpenTargets", "Bruch 膜细胞外基质")],
            scores={"association": 0.40}, rationale="Bruch 膜的细胞外基质周转"),
        TargetCandidate(symbol="VTN", name="玻连蛋白", modality=None,
            evidence=[_ev("network", "OpenTargets", "通路：末端补体 / MAC 抑制"),
                      _ev("expression", "OpenTargets", "玻璃膜疣主要成分")],
            scores={"association": 0.33}, rationale="玻璃膜疣成分；补体调节因子"),
    ]
    return NodeOutput(
        stage="target-hypothesis",
        summary="[扇出] 4 个角度（遗传、表达、网络、文献）-> 合并去重得到 11 个候选靶点",
        candidates=c)


# --- stage 2: literature-evidence (real, verified AMD PMIDs) ---
def stage2(prior: list[TargetCandidate]) -> NodeOutput:
    lit = {
        "CFH": [("15761122", "Klein 2005 Science：CFH Y402H 多态性与 AMD"),
                ("15761120", "Edwards 2005 Science：CFH 变异升高 AMD 风险"),
                ("15870199", "Hageman 2005 PNAS：常见 CFH/HF1 单倍型与 AMD")],
        "C3": [("17634448", "Yates 2007 NEJM：补体 C3 变异与 AMD 风险")],
        "ARMS2": [("26691988", "Fritsche 2016 Nat Genet：大规模 AMD GWAS（34 个位点，含 ARMS2/HTRA1）")],
        "HTRA1": [("26691988", "Fritsche 2016 Nat Genet：10q26 ARMS2/HTRA1 位点")],
        "CFB": [("26691988", "Fritsche 2016 Nat Genet：CFB/C2 位点")],
        "C9": [("26691988", "Fritsche 2016 Nat Genet：C9 P167S 末端途径信号")],
    }
    out = []
    for c in prior:
        c2 = c.model_copy(deep=True)
        for pmid, title in lit.get(c.symbol, []):
            c2.evidence.append(_ev("literature", f"PubMed:{pmid}", title, ref=f"PMID:{pmid}"))
        out.append(c2)
    return NodeOutput(
        stage="literature-evidence",
        summary="为 10 个候选靶点附上真实、可追溯的 PMID（补体 + 10q26 位点）",
        candidates=out)


# --- stage 3: target-selection (druggability / constraint / safety triage) ---
def stage3() -> NodeOutput:
    sel = [
        TargetCandidate(symbol="C3", name="补体 C3", modality="peptide",
            evidence=[_ev("genetic", "OpenTargets", "关联度 0.86"),
                      _ev("literature", "PubMed:17634448", "Yates 2007 NEJM", ref="PMID:17634448"),
                      _ev("network", "OpenTargets", "补体中心节点 —— 临床验证:靶向 C3 的 pegcetacoplan 已获批用于地图样萎缩")],
            scores={"association": 0.86, "tractability": 0.55, "constraint": 0.7, "safety": 0.6},
            rationale="【选定·首选】补体通路汇聚节点;已有获批的 C3 靶向多肽药(pegcetacoplan)用于地图样萎缩,临床可验证"),
        TargetCandidate(symbol="CFH", name="补体因子 H", modality="antibody",
            evidence=[_ev("genetic", "OpenTargets", "关联度 0.92 —— 最强信号"),
                      _ev("literature", "PubMed:15761122", "Klein 2005 Science", ref="PMID:15761122")],
            scores={"association": 0.92, "tractability": 0.30, "constraint": 0.55, "safety": 0.5},
            rationale="【选定·生物药】遗传信号最强但小分子可成药性弱 -> 改用抗体/生物药(恢复补体调控),而非淘汰"),
        TargetCandidate(symbol="HTRA1", name="HtrA 丝氨酸蛋白酶 1", modality="small_molecule",
            evidence=[_ev("genetic", "OpenTargets", "关联度 0.74（10q26）"),
                      _ev("literature", "PubMed:26691988", "Fritsche 2016 Nat Genet", ref="PMID:26691988")],
            scores={"association": 0.74, "tractability": 0.60, "constraint": 0.5, "safety": 0.5},
            rationale="【选定·次选】10q26 位点上可成药的丝氨酸蛋白酶;适合小分子抑制"),
    ]
    return NodeOutput(
        stage="target-selection",
        summary="选定 C3(首选)、CFH(生物药模态)、HTRA1(次选);淘汰 CFB/CFI/C9/C2/APOE(更弱或可成药性不足)",
        candidates=sel,
        open_questions=["是否保留 CFB/CFI 作为联用方案?",
                        "在阶段 4 验证 HTRA1 催化位点的可成药性"])


def seed(db: str, artifacts: str) -> None:
    idx = Index(db, artifacts)
    s1, v1 = stage1(), Verdict(converged=True, score=0.9,
        reasons=["补体在多个角度反复出现", "合并得到 11 个候选"], missing=[])
    s2 = stage2(s1.candidates)
    v2 = Verdict(converged=True, score=0.85, reasons=["所引用的每个 PMID 均真实可追溯"],
                 missing=["表达/网络角度缺少 OpenTargets 之外的独立来源"])
    s3, v3 = stage3(), Verdict(converged=True, score=0.85,
        reasons=["多维度分诊(关联度 + 可成药性 + 遗传约束 + 安全性)",
                 "模态分支保留了强遗传信号的 CFH 作为生物药"], missing=[])

    for out, verdict in [(s1, v1), (s2, v2), (s3, v3)]:
        idx.record_attempt(CAMPAIGN, out.stage)
        idx.write_artifact(CAMPAIGN, out.stage, out.model_dump_json())
        idx.mark_done(CAMPAIGN, out.stage, out.model_dump(), verdict.model_dump())
    # stage-4 target-validation deliberately left 'queued' (M4, not yet implemented).
    print(f"seeded campaign '{CAMPAIGN}' (disease={DISEASE!r}) into {db}")
    for stage, status, attempts in idx.all_states(CAMPAIGN):
        print(f"  {stage:24} {status:10} attempts={attempts}")
    idx.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="/tmp/dd/state.sqlite")
    ap.add_argument("--artifacts", default="/tmp/dd/artifacts")
    args = ap.parse_args()
    seed(args.db, args.artifacts)
