// Report narrative — TS port of api.py _present_report. Turns the structured (English) deep-research
// report into a polished Chinese Markdown narrative (sections by angle + per-finding confidence +
// superscript citations). Returns "" on no findings / no credential / failure (never throws).
import { completeText } from "./llm";

const PRESENT_SYSTEM =
  "你是资深研究报告编辑。把用户给出的【已通过对抗式验证的结构化深度研究结果】整理、撰写成一份" +
  "详实、专业、可读性强的中文 Markdown 报告(不是清单,要有充分的叙述展开):\n" +
  "1) **按研究角度分节**:数据中每个「研究角度」对应报告的一个独立章节(二级标题)。" +
  "必须按照数据中给出的角度顺序和名称逐一撰写,每个角度一节,不多不少。" +
  "可表格化的内容(分类/映射/亚型/基因-表型对应等)用 Markdown 表格呈现。" +
  "**表格必须列出数据中出现的每一条目,禁止用省略号(…/...)或'等'省略任何行——宁可表长也要完整。**\n" +
  "2) 每条发现都【展开成完整段落】,充分利用给定的「详细证据」,解释其含义、机制及对药物靶点发现的意义," +
  "不要只复述一句话;标注置信度(高/中/低)。\n" +
  "3) 对关键启示/重要警示,用 Markdown 引用块(以 > 开头)+ 粗体小标题强调,像综述里的 callout。**全文不要使用任何 emoji。**\n" +
  "4) 每条发现末尾的 <sup>数字</sup> 是引用编号,请【原样保留】;正文不要写出作者/期刊/DOI/PMID 等来源全名,引用一律用这些 <sup> 上标。" +
  "**严禁自行新增或重新编号引用——只能使用文本中已提供的 <sup> 编号。**基因名、蛋白、本体 ID、英文缩写保留原文,不要翻译。\n" +
  "5) 设「局限」与「开放问题」两节;若提供了被否决声明,加一节简述(透明性)。\n" +
  "6) 忠于给定内容,不得编造未提供的事实或来源。\n" +
  "7) **不要**包含「研究概览/统计」章节(由系统单独以卡片展示),也**不要**生成「参考文献」章节(由系统单独渲染)。\n" +
  "8) 只输出报告 Markdown 本身,不要任何前后缀说明或寒暄。";

/** A finding's sources → superscript citation of the matching numbered references (DOI/URL substring). */
function cite(f: any, refs: any[]): string {
  const srcs = (f.sources ?? []).map((s: any) => String(s).toLowerCase());
  const nums = [
    ...new Set(
      refs
        .filter(
          (r) =>
            (r.doi && srcs.some((s: string) => s.includes(String(r.doi).toLowerCase()))) ||
            (r.url && srcs.some((s: string) => s && (s.includes(r.url) || String(r.url).includes(s)))),
        )
        .map((r) => r.n as number),
    ),
  ].sort((a, b) => a - b);
  return nums.length ? `<sup>${nums.join(",")}</sup>` : "";
}

/** Build the digest fed to the editor LLM (api.py _present_report), capped at 60k chars. */
export function buildDigest(report: any, angles?: { label: string }[]): string {
  const findings: any[] = report.findings ?? [];
  const refs: any[] = report.references ?? [];
  const parts: string[] = [`## 执行摘要\n${report.summary ?? ""}`];

  // group findings by angle (the field if present, else positional fallback to the angles list)
  const angleLabels = (angles ?? []).map((a) => a.label);
  const hasAngle = findings.some((f) => f.angle);
  const groups = new Map<string, any[]>();
  findings.forEach((f, i) => {
    const a = hasAngle ? f.angle || "未分类" : angleLabels[i] ?? "未分类";
    const arr = groups.get(a) ?? [];
    arr.push(f);
    groups.set(a, arr);
  });
  for (const [angle, fs] of groups) {
    parts.push(`\n## 研究角度: ${angle}`);
    fs.forEach((f, i) => {
      parts.push(`${i + 1}. [${f.confidence}] ${f.claim}${cite(f, refs)}` + (f.evidence ? `\n   详细证据: ${f.evidence}` : ""));
    });
  }
  const refuted: any[] = report.refuted ?? [];
  if (refuted.length) parts.push("\n## 被对抗式核验否决的声明(供透明性)\n" + refuted.map((x) => `- ${x.claim}(票 ${x.vote})`).join("\n"));
  if (report.caveats) parts.push("\n## 局限\n" + String(report.caveats));
  if (report.openQuestions?.length) parts.push("\n## 开放问题\n" + report.openQuestions.map((q: string) => `- ${q}`).join("\n"));
  return parts.join("\n").slice(0, 60000);
}

export interface PresentDeps {
  complete?: (system: string, user: string) => Promise<string>; // injectable; defaults to completeText
}

/** Structured report → Chinese Markdown narrative. "" when there are no findings or no credential. */
export async function presentReport(report: any, disease: string, angles?: { label: string }[], deps: PresentDeps = {}): Promise<string> {
  if (!(report.findings ?? []).length) return "";
  const complete = deps.complete ?? ((s: string, u: string) => completeText(s, u, { maxTokens: 8192 }));
  return await complete(PRESENT_SYSTEM, `研究对象:${disease}\n\n${buildDigest(report, angles)}`);
}
