import { useCallback, useEffect, useState } from 'react'
import { ddaApi } from '@/api/dda'
import type { CampaignSummary, CampaignView, DdaConfig, PipelineStage, ReportResponse, StageDetail, StepEvent } from '@/types/dda'

/** Backend config (model, real-mode availability) — for the session header / settings. */
export function useConfig() {
    const [config, setConfig] = useState<DdaConfig | null>(null)
    useEffect(() => {
        ddaApi.config().then(setConfig).catch(() => setConfig(null))
    }, [])
    return { config }
}

/** Pipeline metadata (static for a given backend). */
export function usePipeline() {
    const [stages, setStages] = useState<PipelineStage[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    useEffect(() => {
        ddaApi.pipeline().then((r) => setStages(r.stages)).catch((e) => setError(String(e)))
    }, [])
    return { stages, error }
}

/** Campaign list (for the run picker). Polls so new runs + done-counts stay live. */
export function useCampaigns(pollMs = 4000) {
    const [campaigns, setCampaigns] = useState<CampaignSummary[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const refetch = useCallback(() => {
        ddaApi.campaigns().then((r) => setCampaigns(r.campaigns)).catch((e) => setError(String(e)))
    }, [])
    useEffect(() => {
        refetch()
        const id = setInterval(refetch, pollMs)
        return () => clearInterval(id)
    }, [refetch, pollMs])
    return { campaigns, error, refetch }
}

/** Live campaign view: one initial fetch, then SSE updates until the run is terminal. */
export function useCampaignView(campaign: string | null) {
    const [view, setView] = useState<CampaignView | null>(null)
    const [error, setError] = useState<string | null>(null)
    useEffect(() => {
        if (!campaign) return
        setView(null)
        setError(null)
        let es: EventSource | null = null
        ddaApi
            .campaign(campaign)
            .then((v) => {
                setView(v)
                es = ddaApi.subscribe(campaign, setView) // keep live during an in-progress run
            })
            .catch((e) => setError(String(e)))
        return () => es?.close()
    }, [campaign])
    return { view, error }
}

/** One stage's full detail (output + verdict), refetched when selection changes. */
export function useStageDetail(campaign: string | null, stage: string | null) {
    const [detail, setDetail] = useState<StageDetail | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    useEffect(() => {
        if (!campaign || !stage) return
        let cancelled = false
        let timer: ReturnType<typeof setTimeout> | undefined
        setLoading(true)
        setError(null)
        const load = () => {
            ddaApi
                .stage(campaign, stage)
                .then((d) => {
                    if (cancelled) return
                    setDetail(d)
                    if (d.status === 'in_progress' || d.status === 'queued') timer = setTimeout(load, 2500)
                })
                .catch((e) => !cancelled && setError(String(e)))
                .finally(() => !cancelled && setLoading(false))
        }
        load()
        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [campaign, stage])
    return { detail, loading, error }
}

/** Captured Agent SDK step stream for one stage (SSE: existing events then live tail). */
/** Poll the deep-research Search phase (status + report). Polls while running, stops when
 *  the run is terminal. `refresh` re-reads immediately (call right after starting a search). */
export function useReport(campaign: string | null, pollMs = 3000) {
    const [data, setData] = useState<ReportResponse | null>(null)
    const refresh = useCallback(() => {
        if (!campaign) return
        ddaApi.report(campaign).then(setData).catch(() => {})
    }, [campaign])
    useEffect(() => {
        setData(null)
        if (!campaign) return
        let alive = true
        const tick = () => {
            ddaApi.report(campaign).then((r) => {
                if (!alive) return
                setData(r)
                if (r.status.state === 'running' || r.status.state === 'none') {
                    // keep polling; 'none' too, in case a search is about to start
                }
            }).catch(() => {})
        }
        tick()
        const id = setInterval(tick, pollMs)
        return () => { alive = false; clearInterval(id) }
    }, [campaign, pollMs])
    return { report: data, refresh }
}

export function useStageEvents(campaign: string | null, stage: string | null) {
    const [events, setEvents] = useState<StepEvent[]>([])
    useEffect(() => {
        setEvents([])
        if (!campaign || !stage) return
        const es = ddaApi.subscribeStageEvents(campaign, stage, (e) => {
            setEvents((prev) =>
                prev.some((p) => p.seq === e.seq) ? prev : [...prev, e].sort((a, b) => a.seq - b.seq)
            )
        })
        return () => es.close()
    }, [campaign, stage])
    return { events }
}
