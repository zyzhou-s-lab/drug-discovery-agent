---
paths:
  - "src/dd_agent/schemas.py"
  - "src/dd_agent/api.py"
  - "engine-ts/src/schemas.ts"
  - "engine-ts/src/config.ts"
  - "engine-ts/src/app.ts"
  - "web/src/types/dda.ts"
  - "web/src/api/dda.ts"
---

# Frontend ↔ Backend contract sync

The request/response contract is **hand-synced across four places**. Change one, and you
MUST update the others in the same commit, or a setting silently no-ops (see commit
`a794e2b`: the Settings 核验条数 was ignored by the backend) or a request 422s.

| Layer | File | Defines |
|-------|------|---------|
| Python backend | `src/dd_agent/schemas.py`, `src/dd_agent/api.py` | pydantic models + FastAPI routes |
| TS/Bun backend | `engine-ts/src/schemas.ts`, `config.ts`, `app.ts` | Zod schemas + Hono routes (must mirror api.py 1:1) |
| Frontend types | `web/src/types/dda.ts` | hand-written TS mirror of the above |
| Frontend client | `web/src/api/dda.ts` | the fetch calls that send/consume those shapes |

## Rules when you touch any of these files

1. **Change all mirrors together.** A field added to one backend schema must land in the
   other backend schema, the web type, and (if the UI sets it) the web client + settings form.
2. **The two backends must stay 1:1.** `engine-ts/src/app.ts` routes and Zod schemas mirror
   `api.py` and pydantic exactly — same paths, same field names, same status codes.
3. **Run the guards before committing** (the commit hook enforces this, but run them yourself):
   - `cd engine-ts && bun run typecheck && bun test` — includes `parity.test.ts` (py↔ts) and
     `config-contract.test.ts` (web ConfigUpdate ↔ backend schema, the no-op guard).
   - `cd web && npm run typecheck`
   - `pytest -q`
4. **New endpoint or payload?** Add a contract test in `engine-ts/src/app.test.ts` (request/
   response shape) and, for settings-style knobs, extend `config-contract.test.ts`. Follow the
   `api-design` skill for naming/status-code/error-shape conventions.
5. **After the change, verify end-to-end**, not just types (per the `verification-loop` and
   `ai-regression-testing` skills): the same model that wrote the change carries the same blind
   spot into its own review — a passing typecheck is NOT proof the knob is actually read. Trace
   the field from the UI form → client → route handler → the code that consumes it.
