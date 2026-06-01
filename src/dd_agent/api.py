"""Read API + run trigger over the Index (M5 observer, thin HTTP/SSE layer).

Design stance unchanged: this is a *read model* (CQRS) over the durable Index plus
a fire-and-forget run trigger. It does NOT reason and is NOT a node — it only
serializes what the Runner already wrote. The Runner stays the single writer.

Endpoints (all under /api):
  GET  /health
  GET  /pipeline                          declarative stage list (order + scatter angles)
  GET  /campaigns                         all runs with progress accounting
  GET  /campaigns/{c}                     stage states joined onto pipeline order
  GET  /campaigns/{c}/stages/{stage}      one stage: status + NodeOutput + Verdict
  GET  /campaigns/{c}/events              SSE: emits on any stage_state change
  POST /campaigns                         {disease, campaign, real?} -> background run

Config via env: DD_DB (sqlite path), DD_ARTIFACTS (artifact root).
"""
from __future__ import annotations

import asyncio
import json
import os
import threading

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .events import events_dir_var, read_stage_events
from .index import Index
from .pipeline import DISCOVERY_PIPELINE

DB_PATH = os.environ.get("DD_DB", "/tmp/dd/state.sqlite")
ARTIFACTS = os.environ.get("DD_ARTIFACTS", "/tmp/dd/artifacts")

app = FastAPI(title="dd-agent observer", version="0.1.0")
# Read-only cross-origin access for the Vite dev frontend. No credentials.
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

_index: Index | None = None


def get_index() -> Index:
    global _index
    if _index is None:
        _index = Index(DB_PATH, ARTIFACTS)
    return _index


def _pipeline_meta() -> list[dict]:
    return [
        {"name": s.name, "scatter": s.scatter, "angles": list(s.angles),
         "max_attempts": s.max_attempts}
        for s in DISCOVERY_PIPELINE
    ]


def _campaign_view(idx: Index, campaign: str) -> dict:
    """Join recorded stage_state onto the canonical pipeline order so not-yet-started
    stages still appear (status='queued')."""
    recorded = {stage: (status, attempts) for stage, status, attempts in idx.all_states(campaign)}
    stages = []
    for s in DISCOVERY_PIPELINE:
        status, attempts = recorded.get(s.name, ("queued", 0))
        stages.append({
            "name": s.name, "status": status, "attempts": attempts,
            "scatter": s.scatter, "angles": list(s.angles),
            "updated_at": idx.stage_updated_at(campaign, s.name),
        })
    return {"campaign": campaign, "stages": stages}


@app.get("/api/health")
async def health() -> dict:
    return {"ok": True, "db": DB_PATH, "artifacts": ARTIFACTS}


@app.get("/api/pipeline")
async def pipeline() -> dict:
    return {"stages": _pipeline_meta()}


@app.get("/api/config")
async def config() -> dict:
    """Backing data for the settings page (model, whether real runs are available)."""
    import importlib.util as _u

    has_sdk = _u.find_spec("claude_agent_sdk") is not None
    has_key = bool(os.environ.get("ANTHROPIC_AUTH_TOKEN") or os.environ.get("ANTHROPIC_API_KEY"))
    return {
        "model": os.environ.get("ANTHROPIC_MODEL"),
        "base_url_set": bool(os.environ.get("ANTHROPIC_BASE_URL")),
        "real_available": has_sdk and has_key,
    }


@app.get("/api/campaigns")
async def campaigns() -> dict:
    return {"campaigns": get_index().list_campaigns()}


@app.get("/api/campaigns/{campaign}")
async def campaign_detail(campaign: str) -> dict:
    return _campaign_view(get_index(), campaign)


@app.get("/api/campaigns/{campaign}/stages/{stage}")
async def stage_detail(campaign: str, stage: str) -> dict:
    idx = get_index()
    if not any(s.name == stage for s in DISCOVERY_PIPELINE):
        raise HTTPException(404, f"unknown stage {stage!r}")
    return {
        "campaign": campaign,
        "stage": stage,
        "status": idx.status(campaign, stage) or "queued",
        "attempts": idx.attempts(campaign, stage),
        "output": idx.output(campaign, stage),     # NodeOutput dict | None
        "verdict": idx.verdict(campaign, stage),   # Verdict dict | None
    }


@app.get("/api/campaigns/{campaign}/stages/{stage}/events")
async def stage_events(campaign: str, stage: str) -> dict:
    """The captured Agent SDK step stream (thinking / tool_use / tool_result / …)."""
    return {"events": read_stage_events(ARTIFACTS, campaign, stage)}


@app.get("/api/campaigns/{campaign}/stages/{stage}/events/stream")
async def stage_events_stream(campaign: str, stage: str, request: Request) -> StreamingResponse:
    """SSE: tail the stage's step-event log; pushes new events as the worker writes them."""
    idx = get_index()

    async def gen():
        sent = 0
        idle = 0
        while True:
            if await request.is_disconnected():
                break
            evs = read_stage_events(ARTIFACTS, campaign, stage)
            if len(evs) > sent:
                for e in evs[sent:]:
                    yield f"data: {json.dumps(e, ensure_ascii=False)}\n\n"
                sent = len(evs)
                idle = 0
            else:
                idle += 1
            if idx.status(campaign, stage) in ("done", "exhausted") and idle >= 3:
                yield "event: done\ndata: {}\n\n"
                break
            await asyncio.sleep(1.0)

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.get("/api/campaigns/{campaign}/events")
async def events(campaign: str, request: Request) -> StreamingResponse:
    """SSE: poll stage_state and push a fresh campaign view whenever anything changes.
    Closes when the client disconnects or the run reaches a terminal state."""
    idx = get_index()

    async def gen():
        last = None
        idle = 0
        while True:
            if await request.is_disconnected():
                break
            view = _campaign_view(idx, campaign)
            snapshot = json.dumps(view, sort_keys=True)
            if snapshot != last:
                last = snapshot
                idle = 0
                yield f"data: {json.dumps(view)}\n\n"
            else:
                idle += 1
            statuses = {s["status"] for s in view["stages"]}
            terminal = statuses <= {"done", "exhausted"} and "queued" not in statuses
            # stop once every stage is terminal and nothing changed for a couple ticks
            if terminal and idle >= 2:
                yield "event: done\ndata: {}\n\n"
                break
            await asyncio.sleep(1.0)

    return StreamingResponse(gen(), media_type="text/event-stream")


class RunRequest(BaseModel):
    disease: str
    campaign: str = "demo"
    real: bool = False


def _run_pipeline(campaign: str, disease: str, real: bool) -> None:
    """Run the whole pipeline in a dedicated thread with its OWN event loop and its
    OWN Index connection (WAL-safe alongside the API's read connection). This keeps
    the server's event loop free — a real run's synchronous LLM judge call would
    otherwise block every request/SSE for the duration of each judge call."""
    from .runner import Runner

    # tasks the Runner spawns inherit this ContextVar -> worker emits step events here
    events_dir_var.set(os.path.join(ARTIFACTS, campaign, "events"))
    run_idx = Index(DB_PATH, ARTIFACTS)
    if real:
        from .judge import api_judge
        from .worker import sdk_worker
        worker_fn, judge_fn = sdk_worker, api_judge
    else:
        from .judge import dummy_judge
        from .worker import dummy_worker
        worker_fn, judge_fn = dummy_worker, dummy_judge
    try:
        asyncio.run(Runner(run_idx, worker_fn, judge_fn, DISCOVERY_PIPELINE).run(campaign, disease))
    except Exception as exc:  # surface in the uvicorn log; the stage's state shows the failure
        print(f"[run {campaign}] failed: {exc!r}")
    finally:
        run_idx.close()


@app.post("/api/campaigns")
async def start_run(req: RunRequest) -> dict:
    """Fire-and-forget: run the pipeline in a background thread, return immediately.
    Progress is observed via GET /campaigns/{c} or the SSE /events stream."""
    get_index().record_campaign(req.campaign, req.disease)  # so it groups by disease immediately
    threading.Thread(
        target=_run_pipeline, args=(req.campaign, req.disease, req.real), daemon=True
    ).start()
    return {"campaign": req.campaign, "disease": req.disease, "real": req.real, "started": True}
