// Thin client for the dd_agent read API. Base path is /api, proxied by Vite
// (vite.config.ts) to the uvicorn backend so there are no CORS/host concerns in dev.
import type {
    CampaignSummary,
    CampaignView,
    DdaConfig,
    IntakeResult,
    PipelineStage,
    ReferencesResponse,
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
    references: (c: string) =>
        getJson<ReferencesResponse>(`/campaigns/${encodeURIComponent(c)}/references`),

    // Pre-flight disease validation (intake gate) — called on dialog submit so junk /
    // non-disease input is rejected BEFORE a run is created.
    intakeCheck: (disease: string): Promise<IntakeResult> =>
        fetch(`${BASE}/intake/check`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ disease }),
        }).then((r) => {
            if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
            return r.json() as Promise<IntakeResult>
        }),

    startRun: (body: { disease: string; campaign: string; real?: boolean; skip_intake?: boolean }) =>
        fetch(`${BASE}/campaigns`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        }).then((r) => r.json()),

    rename: (c: string, title: string) =>
        fetch(`${BASE}/campaigns/${encodeURIComponent(c)}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title }),
        }).then((r) => r.json()),
    remove: (c: string) =>
        fetch(`${BASE}/campaigns/${encodeURIComponent(c)}`, { method: 'DELETE' }).then((r) => r.json()),

    files: (c: string) =>
        getJson<{ campaign: string; root: string; files: { path: string; size: number }[] }>(
            `/campaigns/${encodeURIComponent(c)}/files`
        ),
    fileRaw: (c: string, path: string) =>
        getJson<{ path: string; content: string }>(
            `/campaigns/${encodeURIComponent(c)}/files/raw?path=${encodeURIComponent(path)}`
        ),

    // streaming /btw chat: POST + read the text/plain body incrementally
    chatStream: async (
        c: string,
        messages: { role: string; content: string }[],
        onChunk: (text: string) => void
    ): Promise<void> => {
        const res = await fetch(`${BASE}/campaigns/${encodeURIComponent(c)}/chat`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ messages }),
        })
        if (!res.body) {
            onChunk(await res.text())
            return
        }
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            if (value) onChunk(dec.decode(value, { stream: true }))
        }
    },

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

/** Extract a bare DOI from an evidence ref/source ("10.x", "doi:10.x", or a doi.org URL). */
export function doiRef(ref: string, source: string): string | null {
    const m = `${ref} ${source}`.match(/10\.\d{4,9}\/[^\s"]+/)
    return m ? m[0].toLowerCase().replace(/[.,;]+$/, '') : null
}
