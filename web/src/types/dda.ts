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
    base_url: string | null
    base_url_set: boolean
    api_key: string // round-tripped so the form prefills; gated by the same CSRF guard as writes
    api_key_set: boolean
    concurrency: number
    max_claims: number
    real_available: boolean
}

// Capability inventory (GET /capabilities) — surfaced in the settings page (技能 + 工具/MCP).
export interface ToolInfo {
    name: string
    desc: string
}
export interface ToolGroup {
    server: string
    kind: 'mcp' | 'builtin'
    label: string
    tools: ToolInfo[]
}
export interface Capabilities {
    skills: { name: string; desc: string }[]
    toolGroups: ToolGroup[]
}

// Full settings sent to POST /config (wholesale overwrite — the body IS the new settings.json).
// Every field is required (an incomplete body is a 422); a blank string clears that override.
export interface ConfigUpdate {
    model: string
    base_url: string
    api_key: string
    concurrency: number
    max_claims: number
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
    angle?: string // research angle this finding addresses (REPORT_SCHEMA.findings[].angle)
    claim: string
    confidence: 'high' | 'medium' | 'low'
    sources: string[]
    evidence: string
    vote?: string
}

export interface DeepReport {
    question: string
    summary: string
    narrative?: string // presentation layer: polished Chinese Markdown report (api._present_report)
    findings: DeepFinding[]
    caveats?: string
    openQuestions?: string[]
    refuted?: { claim: string; vote: string; source: string }[]
    sources?: { url: string; quality: string; angle?: string; claimCount?: number }[]
    // unified numbered bibliography over ALL cited sources (paper→apa7 / database+web→title+url)
    references?: { n: number; kind?: string; doi?: string; apa7?: string; title?: string; url?: string }[]
    // literature-card read model: one paper per card + our verify status (deep_research.buildLiterature)
    literature?: { doi: string; title: string; authors: string[]; venue: string; year: number | null; status: 'confirmed' | 'refuted' | 'uncited'; vote?: string; claim?: string; angle?: string }[]
    webSources?: { title?: string; url: string }[]
    dbSources?: { title?: string; url: string }[]
    // raw database records — always preserved & shown; status = its verify outcome (confirmed/refuted/unverified)
    databaseFacts?: { claim?: string; quote?: string; source?: string; doi?: string; quality?: string; status?: string; raw?: string }[]
    stats?: Record<string, number>
    budget?: { spent_tokens: number; by_phase?: Record<string, unknown> }
}

export interface ReportResponse {
    campaign: string
    status: {
        state: 'none' | 'running' | 'stopping' | 'stopped' | 'done' | 'paused' | 'error'
        stats?: Record<string, number>
        error?: string
        reason?: string // why it auto-paused (provider rate-limit / quota)
        run?: number // changes per (re)start so the frontend resets its event view
    }
    report: DeepReport | null
}

// One captured Agent SDK step (events.py / worker._emit_stream)
export type StepEventType = 'session_start' | 'thinking' | 'text' | 'tool_use' | 'tool_result' | 'result' | 'progress'
    // diagnostics emitted by the deep-research engine (events.py): MCP tool failures + agent
    // retry/giving-up. Consumed by ToolMetrics and the "工具调用详情" panel in App.tsx.
    | 'tool_error' | 'agent_retry' | 'agent_error'

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
    result?: string | null // the agent's final outcome text
    tokens?: number // total tokens (input+output) for the agent
    // progress (deep-research phase tree)
    done?: number
    total?: number
    // tool_error
    tool?: string
    error?: string
    // agent_retry / agent_error
    attempt?: number
    max_retries?: number
    reason?: string
    backoff_sec?: number
    attempts?: number
    last_error?: string
}
