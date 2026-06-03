// TS mirror of dd_agent's pydantic schemas + api.py responses.
// Kept in sync with src/dd_agent/schemas.py and src/dd_agent/api.py.

export type StageStatus = 'queued' | 'in_progress' | 'done' | 'exhausted'

export interface Evidence {
    kind: string // genetic | expression | network | literature | ...
    source: string // OpenTargets | OpenAlex | Semantic Scholar | ...
    detail: string
    ref: string // literature -> DOI ("10.1038/s41586-021-03819-2"); else index id/link
}

export interface TargetCandidate {
    symbol: string
    name: string | null
    modality: string | null // small_molecule | peptide | antibody | ...
    evidence: Evidence[]
    scores: Record<string, number> // association / tractability / constraint / safety
    rationale: string
}

export interface NodeOutput {
    stage: string
    summary: string
    artifacts: string[]
    candidates: TargetCandidate[]
    self_assessment: string
    open_questions: string[]
    data?: {
        kind?: string
        question?: string
        angles?: ScopeAngle[]
        budget?: { spent_tokens: number; by_phase?: Record<string, unknown> }
    }
}

export interface Verdict {
    converged: boolean
    score: number
    reasons: string[]
    missing: string[]
    retry_hint: string | null
}

export interface PipelineStage {
    name: string
    scatter: boolean
    angles: string[]
    max_attempts: number
}

export interface CampaignStage {
    name: string
    status: StageStatus
    attempts: number
    scatter: boolean
    angles: string[]
    updated_at: number | null
}

export interface CampaignView {
    campaign: string
    stages: CampaignStage[]
}

export interface CampaignSummary {
    campaign: string
    disease: string | null
    title: string | null
    stages: number
    done: number
    exhausted: number
    updated_at: number | null
}

export interface DdaConfig {
    model: string | null
    base_url_set: boolean
    real_available: boolean
}

export interface StageDetail {
    campaign: string
    stage: string
    status: StageStatus
    attempts: number
    output: NodeOutput | null
    verdict: Verdict | null
}

// Campaign-level APA7 bibliography (api.py /campaigns/{c}/references)
export interface Reference {
    n: number // 1-based citation number
    doi: string
    apa7: string // APA7 reference string; venue is *italicised* (markdown)
}

export interface ReferencesResponse {
    campaign: string
    count: number
    references: Reference[]
    unresolved: string[] // DOIs OpenAlex could not resolve
}

// Disease intake pre-check (api.py POST /intake/check -> intake.validate_disease)
export interface IntakeResult {
    accepted: boolean
    normalized_en: string // English, OpenTargets-aligned disease name
    efo_id: string // resolved EFO id (evidence it's a real disease), or ''
    reason: string // rejection reason when accepted=false
}

// deep-research stage-0 Scope (api.py POST /research/scope -> research.scope)
export interface ScopeAngle {
    label: string
    query: string
    rationale?: string
}

export interface ScopeResult {
    question: string
    angles: ScopeAngle[]
    budget?: { spent_tokens: number; by_phase: Record<string, unknown> }
    error?: string
}

// deep-research Search phase report (api.py /campaigns/{c}/report -> research.research())
export interface DeepFinding {
    claim: string
    confidence: 'high' | 'medium' | 'low'
    sources: string[]
    evidence: string
    vote?: string
}

export interface DeepReport {
    question: string
    summary: string
    findings: DeepFinding[]
    caveats?: string
    openQuestions?: string[]
    refuted?: { claim: string; vote: string; source: string }[]
    sources?: { url: string; quality: string; angle?: string; claimCount?: number }[]
    stats?: Record<string, number>
    budget?: { spent_tokens: number; by_phase?: Record<string, unknown> }
}

export interface ReportResponse {
    campaign: string
    status: { state: 'none' | 'running' | 'done' | 'error'; stats?: Record<string, number>; error?: string }
    report: DeepReport | null
}

// One captured Agent SDK step (events.py / worker._emit_stream)
export type StepEventType = 'session_start' | 'thinking' | 'text' | 'tool_use' | 'tool_result' | 'result' | 'progress'

export interface StepEvent {
    seq: number
    ts: number
    stage: string
    label: string // scatter angle ("genetic"…) or "literature"/"selection"
    type: StepEventType
    // tool_use
    name?: string
    input?: unknown
    tool_id?: string
    // tool_result
    content?: unknown
    is_error?: boolean
    // thinking / text
    text?: string
    // session_start
    prompt?: string
    // result
    cost?: number | null
    num_turns?: number | null
    // progress (deep-research phase tree)
    done?: number
    total?: number
}
