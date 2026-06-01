// Thin client for the dd_agent read API. Base path is /api, proxied by Vite
// (vite.config.ts) to the uvicorn backend so there are no CORS/host concerns in dev.
import type {
    CampaignSummary,
    CampaignView,
    DdaConfig,
    PipelineStage,
    StageDetail,
    StepEvent,
} from '@/types/dda'

const BASE = '/api'

async function getJson<T>(path: string): Promise<T> {
    const res = await fetch(`${BASE}${path}`)
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`)
    return res.json() as Promise<T>
}

export const ddaApi = {
    pipeline: () => getJson<{ stages: PipelineStage[] }>('/pipeline'),
    config: () => getJson<DdaConfig>('/config'),
    campaigns: () => getJson<{ campaigns: CampaignSummary[] }>('/campaigns'),
    campaign: (c: string) => getJson<CampaignView>(`/campaigns/${encodeURIComponent(c)}`),
    stage: (c: string, s: string) =>
        getJson<StageDetail>(`/campaigns/${encodeURIComponent(c)}/stages/${encodeURIComponent(s)}`),

    startRun: (body: { disease: string; campaign: string; real?: boolean }) =>
        fetch(`${BASE}/campaigns`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        }).then((r) => r.json()),

    // SSE: pushes a fresh CampaignView on every stage_state change; auto-closes on `done`.
    subscribe: (c: string, onView: (v: CampaignView) => void): EventSource => {
        const es = new EventSource(`${BASE}/campaigns/${encodeURIComponent(c)}/events`)
        es.onmessage = (e) => {
            try {
                onView(JSON.parse(e.data) as CampaignView)
            } catch {
                /* ignore malformed frame */
            }
        }
        es.addEventListener('done', () => es.close())
        return es
    },

    // captured Agent SDK step stream for one stage
    stageEvents: (c: string, s: string) =>
        getJson<{ events: StepEvent[] }>(
            `/campaigns/${encodeURIComponent(c)}/stages/${encodeURIComponent(s)}/events`
        ),
    // SSE: streams existing step events then tails new ones; auto-closes on `done`.
    subscribeStageEvents: (c: string, s: string, onEvent: (e: StepEvent) => void): EventSource => {
        const es = new EventSource(
            `${BASE}/campaigns/${encodeURIComponent(c)}/stages/${encodeURIComponent(s)}/events/stream`
        )
        es.onmessage = (e) => {
            try {
                onEvent(JSON.parse(e.data) as StepEvent)
            } catch {
                /* ignore */
            }
        }
        es.addEventListener('done', () => es.close())
        return es
    },
}

/** Resolve a PubMed id from an evidence ref/source like "PMID:15761122" or "PubMed:15761122". */
export function pubmedId(ref: string, source: string): string | null {
    const m = `${ref} ${source}`.match(/(?:PMID|PubMed)[:\s]?(\d{5,9})/i)
    return m ? m[1] : null
}
