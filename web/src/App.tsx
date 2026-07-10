import { type ReactNode, useEffect, useRef, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { LoadingState } from '@/components/LoadingState'
import { StepCards, ToolMetrics } from '@/components/StepCards'
import { Sidebar } from '@/components/Sidebar'
import { SessionHeader } from '@/components/SessionHeader'
import { ChatPanel } from '@/components/ChatPanel'
import { Markdown } from '@/components/Markdown'
import { SelectionPopup } from '@/components/SelectionPopup'
import { FilesPage } from '@/components/FilesDialog'

import { ddaApi, doiRef } from '@/api/dda'
import { useTheme } from '@/lib/settings'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useToast } from '@/lib/toast-context'
import { useCampaigns, useCampaignView, useReport, useStageDetail, useStageEvents } from '@/hooks/useDda'
import type {
    CampaignStage,
    DeepFinding,
    DeepReport,
    Evidence,
    Reference,
    ReferencesResponse,
    ReportResponse,
    ScopeAngle,
    StageStatus,
    TargetCandidate,
} from '@/types/dda'
import {
    STATUS_VARIANT, STATUS_LABEL, STAGE_LABEL, STAGE_DESC, MODALITY_LABEL, KIND_LABEL, SCORE_LABEL,
    stageLabel, fmtDur, refNFor, confVariant,
    DB_BIO_TYPES, dbBioType, parseRawBlocks, stripHtml, DB_TOOL_BLOCKS, DB_SKIP_COLS, DB_PREFER_COLS,
    dbColumns, dbCell, pruneDbFacts, fmtRaw,
} from '@/lib/reportShared'
import { DeepReportView, CandidateCard, Bibliography } from '@/components/report/reportView'
import { DeepResearchPage, StageRail, StageDetail, ScopeAngles } from '@/components/pipeline/pipelineViews'





export function App() {
    useTheme() // apply persisted theme on load
    const isMobile = useIsMobile() // for the full-screen chat overlay on phones
    const { addToast } = useToast()

    const { campaigns, error: cErr, refetch } = useCampaigns()
    // `campaign` is URL-driven (hapi parity): '/' = index (no run), '/c/$campaign' = detail. Selecting
    // a run navigates (push), so back/forward, refresh-persist and deep-links work. No auto-open on
    // index — the list page is the landing, matching hapi's /sessions index.
    const navigate = useNavigate()
    const params = useParams({ strict: false }) as { campaign?: string }
    const campaign = params.campaign ?? null
    const setCampaign = (c: string | null) => {
        void (c ? navigate({ to: '/c/$campaign', params: { campaign: c } }) : navigate({ to: '/' }))
    }
    // Prune a dangling selection: if the campaign in the URL no longer exists after a refetch
    // (e.g. a delete), navigate back to the index so stale detail UI can't linger.
    useEffect(() => {
        if (campaign && campaigns && !campaigns.some((c) => c.campaign === campaign)) {
            setSelected(null)
            setCampaign(null)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [campaigns, campaign])

    const { view, error: vErr } = useCampaignView(campaign)
    const { report, refresh: refreshReport } = useReport(campaign)
    const searchState = report?.status.state ?? 'none'
    const [selected, setSelected] = useState<string | null>(null)
    const SEARCH_TAB = '__search__'   // 深度研究 (live progress)
    const REPORT_TAB = '__report__'   // 检索简报 (narrative + db data + claims)
    // when the report first lands, jump to the report tab — once per run
    const autoReportRun = useRef<number | undefined>(undefined)
    useEffect(() => {
        const run = report?.status.run
        if (report?.report && run != null && autoReportRun.current !== run && selected === SEARCH_TAB) {
            autoReportRun.current = run
            setSelected(REPORT_TAB)
        }
    }, [report?.report, report?.status.run, selected])
    const onStartSearch = (angles: ScopeAngle[]) => {
        if (!campaign) return
        ddaApi
            .startSearch(campaign, angles)
            .then(() => {
                setSelected(SEARCH_TAB)
                refreshReport()
            })
            .catch(() => {})
    }
    const onJumpToAngle = (angle: string) => {
        setSelected(SEARCH_TAB)
        window.setTimeout(() => {
            const key = angle.slice(0, 28)
            const el =
                document.getElementById(`dd-session-search · ${key}`) ??
                (Array.from(document.querySelectorAll('[id^="dd-session-"]')).find((e) => e.id.includes(angle.slice(0, 18))) as
                    | HTMLElement
                    | undefined) ??
                null
            el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }, 120)
    }
    const [chatOpen, setChatOpen] = useState(true)
    const [filesOpen, setFilesOpen] = useState<string | null>(null)
    const [pendingRefs, setPendingRefs] = useState<string[]>([])
    const addRef = (text: string) => {
        setPendingRefs((p) => [...p, text])
        setChatOpen(true)
    }
    useEffect(() => {
        if (!view) return
        const done = view.stages.filter((s) => s.status === 'done')
        const pick = done.length ? done[done.length - 1].name : view.stages[0]?.name ?? null
        setSelected((cur) => cur ?? pick)
    }, [view])

    const apiDown = Boolean(cErr || vErr)

    const selectedRun = campaign
        ? campaigns?.find((c) => c.campaign === campaign) ?? {
              campaign,
              disease: null,
              title: null,
              stages: 0,
              done: 0,
              exhausted: 0,
              updated_at: null,
          }
        : null

    const handleMutate = (deleted?: string) => {
        if (deleted && deleted === campaign) {
            setSelected(null)
            setCampaign(null)
        }
        refetch()
    }

    // real is always true now (the "实时" toggle was removed); the disease has already
    // passed the intake pre-check in the dialog, so skip_intake avoids a redundant gate.
    const startRun = (disease: string) => {
        const slug = disease.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'run'
        const id = `${slug}-${Date.now().toString(36)}`
        ddaApi
            .startRun({ disease, campaign: id, real: true, skip_intake: true })
            .then(() => {
                setSelected(null)
                setCampaign(id)
                refetch()
                addToast({ title: '已新建运行', body: disease })
            })
            .catch(() => addToast({ title: '新建运行失败', body: '请稍后重试' }))
    }

    return (
        <div className="flex h-dvh w-full overflow-hidden" style={{ background: 'var(--app-bg)', color: 'var(--app-fg)' }}>
            {/* List pane (hapi mechanism): full-width on mobile when no run; hidden < lg once a run
                is open. Self-managed inside Sidebar via its `selected` prop. */}
            <Sidebar
                campaigns={campaigns}
                apiDown={apiDown}
                selected={campaign}
                onSelect={(c) => {
                    setSelected(null)
                    setCampaign(c)
                }}
                onStartRun={startRun}
                onMutate={handleMutate}
            />

            {/* Detail pane: hidden < lg when no run (the list shows), shown once a run is open. */}
            <main className={`${campaign ? 'flex' : 'hidden lg:flex'} min-w-0 flex-1 flex-col overflow-y-auto`}>
                {selectedRun && (
                    <SessionHeader
                        run={selectedRun}
                        onBack={() => {
                            setSelected(null)
                            setCampaign(null)
                        }}
                        onMutate={handleMutate}
                        onOpenFiles={() => setFilesOpen(campaign)}
                        onToggleChat={() => setChatOpen((v) => !v)}
                    />
                )}

                <div id="dd-main" className="mx-auto flex w-full max-w-content flex-col gap-5 p-4 lg:p-6">
                    {!campaign && (
                        <Card className="p-6 text-sm text-[var(--app-hint)]">
                            从左侧选择一个运行,或点右上 ＋ 新建一个疾病项目并运行。
                        </Card>
                    )}

                    {view && (
                        <StageRail
                            stages={view.stages}
                            selected={selected}
                            onSelect={setSelected}
                            extra={[
                                // 深度研究 = live progress tab
                                ...(searchState !== 'none'
                                    ? [{
                                          id: SEARCH_TAB,
                                          label: '深度研究',
                                          badge:
                                              searchState === 'running' ? '进行中'
                                              : searchState === 'stopping' ? '停止中'
                                              : searchState === 'stopped' ? '已停止'
                                              : searchState === 'done' ? '完成'
                                              : searchState === 'paused' ? '已暂停'
                                              : '失败',
                                      }]
                                    : []),
                                // 检索简报 = narrative + db data + claims
                                ...(report?.report ? [{ id: REPORT_TAB, label: '检索简报' }] : []),
                            ]}
                        />
                    )}

                    {campaign && selected === SEARCH_TAB && (
                        <DeepResearchPage campaign={campaign} report={report} />
                    )}
                    {campaign && selected === REPORT_TAB && report?.report && (
                        <DeepReportView report={report.report} onJumpToAngle={onJumpToAngle} />
                    )}
                    {campaign && selected && selected !== SEARCH_TAB && selected !== REPORT_TAB && (
                        <StageDetail
                            campaign={campaign}
                            stage={selected}
                            searchState={searchState}
                            onSearch={onStartSearch}
                        />
                    )}

                    {campaign && !report?.report && <Bibliography campaign={campaign} />}
                </div>
            </main>

            {chatOpen && campaign && (
                <div className={isMobile ? 'fixed inset-0 z-50 flex bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]' : 'contents'}>
                    <ChatPanel
                        mobile={isMobile}
                        key={`${campaign}-${report?.status.run ?? 'scope'}`}
                        campaign={campaign}
                        run={report?.status.run}
                        onClose={() => setChatOpen(false)}
                        attachments={pendingRefs}
                        onRemoveAttachment={(i) => setPendingRefs((p) => p.filter((_, j) => j !== i))}
                        onClearAttachments={() => setPendingRefs([])}
                    />
                </div>
            )}

            <SelectionPopup onAdd={addRef} />
            <FilesPage campaign={filesOpen} disease={campaigns?.find(c => c.campaign === filesOpen)?.disease ?? null} onClose={() => setFilesOpen(null)} />
        </div>
    )
}
