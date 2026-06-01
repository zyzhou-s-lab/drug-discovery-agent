# dda-frontend-starter

A Vite + React 19 + Tailwind 4 frontend for the **drug-discovery-agent (dda)**,
built on Tier-A presentation components lifted **verbatim** from
[`tiann/hapi`](https://github.com/tiann/hapi) `web/`.

`src/App.tsx` is a **live discovery dashboard**: it reads the dd_agent index over a
small HTTP/SSE API (`src/api/dda.ts` + `src/hooks/useDda.ts`) and renders the
dry-AMD pipeline — stage rail, per-stage candidates (symbol / modality / scores /
evidence with PMID links) and the judge verdict — using the lifted Card / Badge /
Button / CodeBlock / LoadingState. It proves both that (a) the HAPI component set
has **no coupling to HAPI's backend** (nothing here imports `@hapi/protocol`), and
(b) those components map cleanly onto dda's real data model.

## Run the full demo (frontend + backend)

```bash
./run-demo.sh        # seeds dry-AMD data → uvicorn API :8099 → vite :5173
```

Requires a dd_agent checkout with its venv (default `../dda` or `/home/zyzhou/dda`,
override with `DDA_DIR`). Then open http://localhost:5173.

Backend manually (in the dd_agent checkout):
```bash
pip install -e '.[api]'
python scripts/seed_demo.py --db /tmp/dd-demo/state.sqlite --artifacts /tmp/dd-demo/artifacts
DD_DB=/tmp/dd-demo/state.sqlite DD_ARTIFACTS=/tmp/dd-demo/artifacts \
  uvicorn dd_agent.api:app --port 8099
```
Frontend manually:
```bash
npm install && npm run dev      # vite proxies /api → :8099 (see vite.config.ts)
npm run typecheck               # tsc --noEmit
```

### dd_agent integration (the non-HAPI files)
| File | Role |
|---|---|
| `src/types/dda.ts` | TS mirror of dd_agent's pydantic schemas + api responses |
| `src/api/dda.ts` | fetch client + SSE subscribe + PubMed-id parser |
| `src/hooks/useDda.ts` | `usePipeline` / `useCampaigns` / `useCampaignView` (SSE) / `useStageDetail` |
| `src/App.tsx` | the discovery dashboard |
| backend `src/dd_agent/api.py` | FastAPI read API + SSE + run trigger (added to dda) |
| backend `scripts/seed_demo.py` | seeds the offline dry-AMD campaign |

The demo data is **seed/replay** (faithful to the documented M1–M3b run; real PMIDs).
Stage 4 (target-validation) shows `queued` because it is M4, not yet implemented.
To populate a live run instead: `POST /api/campaigns {disease, real:true}` with API keys set.

## ⚠️ License — AGPL-3.0

The component source under `src/components`, `src/lib`, `src/hooks` is copied from
HAPI, which is **AGPL-3.0-only**. Copyleft + network clause applies: if you serve
a frontend built from this code over a network, you must release the combined
source under AGPL. The scaffolding I wrote (`App.tsx`, `main.tsx`, configs, this
README) is yours to relicense, but the lifted files are not. If you need to avoid
AGPL, the `src/components/ui/*` primitives are a standard shadcn pattern — regenerate
them with the shadcn CLI instead of copying.

## What's included (the closed Tier-A set, 35 lifted files)

| Group | Files |
|---|---|
| Core | `lib/utils.ts` (`cn`), `lib/use-translation.ts` + `lib/i18n-context.tsx` + `lib/locales/*` |
| UI primitives | `components/ui/{button,card,dialog,badge,Toast,ConfirmDialog}.tsx` |
| Status | `components/{Spinner,LoadingState}.tsx`, `components/{Offline,Reconnecting,Syncing}Banner.tsx` + `hooks/useOnlineStatus.ts` |
| Files | `components/{FileIcon}.tsx` |
| Code / markdown render | `lib/shiki.ts`, `components/CodeBlock.tsx`, `components/assistant-ui/{shiki-highlighter,mermaid-diagram}.tsx` + `hooks/useCopyToClipboard.ts` + `lib/clipboard.ts` |
| Diff | `components/DiffView.tsx` + `hooks/usePointerFocusRing.ts` |
| Terminal | `components/Terminal/TerminalView.tsx` + `lib/terminalFont.ts` + `hooks/useTerminalFontSize.ts` |
| PWA | `components/InstallPrompt.tsx` + `hooks/{usePWAInstall,usePlatform,useTelegram}.ts` |

### The only edits made to lifted files

- `components/assistant-ui/{shiki-highlighter,mermaid-diagram}.tsx`: their single
  `import type { SyntaxHighlighterProps } from '@assistant-ui/react-markdown'` was
  repointed to a local `./types.ts` so the heavy `@assistant-ui` markdown stack is
  **not** a dependency. Everything else is byte-for-byte from HAPI.
- `src/index.css`: dropped the one `@import "katex/.../katex.min.css"` line (KaTeX
  is only used by the excluded full MarkdownRenderer).

## What's deliberately NOT here (Tier B — needs a data layer)

These reuse HAPI's *visuals* but are coupled to its session API; port them only
after dda exposes its own endpoints:

- `DirectoryTree.tsx` / `WorkspaceBrowser.tsx` — swap `useSessionDirectory` +
  `ApiClient` for a dda `GET /index/tree`.
- `MarkdownRenderer.tsx` + `assistant-ui/markdown-text.tsx` — pull in
  `AssistantChat/context`, router navigation, and 4 custom remark plugins; trim
  those or use a plain `react-markdown` setup.
- The entire `chat/` reducer + `ToolCard/` stack — valuable later for rendering a
  live Claude Agent SDK node transcript, but it's a port, not a copy.

## Theme

Styling is driven entirely by the `--app-*` CSS variables defined in
`src/index.css` (light defaults + a `[data-theme="dark"]` block). No shadcn
`@theme` color tokens are required. Toggle dark mode by setting
`document.documentElement.dataset.theme = 'dark'`.

## Provenance

Lifted from `tiann/hapi@main`, `web/src/**`. Re-pull with the same paths to update.
