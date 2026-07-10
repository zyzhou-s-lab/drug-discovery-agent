# Dev workflow — where things get built

Decided convention (keep the loop short; don't design UI by hand-editing + redeploy + screenshot).

## Running the pipeline → terminal CLI
Run a full campaign from the terminal, no HTTP/web needed:

```bash
cd engine-ts
bun src/cli.ts "<disease>"
# fast iteration knobs (env):
DD_DR_MAX_ANGLES=2 DD_DR_MAX_FETCH=3 DD_DR_VOTES=1 bun src/cli.ts "<disease>"
# background (survives disconnect):
nohup bun src/cli.ts "<disease>" > run.log 2>&1 &   # tail -f run.log
```

`cli.ts` writes the same artifacts the server does (`report.json` + `deepresearch/` +
`search_status.json` + an index row), so the web app can render the milestone read-only at
`/c/<campaign>`. Business logic is iterated here — in-process, no front-back overhead.

## UI → design in pencil.dev, not hand-edited loops
The web (`web/`, Vite + React + Tailwind) is the milestone viewer. **Iterate it in
[pencil.dev](https://www.pencil.dev/)** — an in-IDE design canvas that compiles to React — instead of
the edit-App.tsx → tsc → deploy → screenshot loop. pencil is for the visual/component layout; the
**interaction state machine is code** (spec states + transitions first, then implement).

No terminal TUI (Ink): pencil doesn't target the terminal, and the CLI's streaming progress + a
minimal prompt cover "select / watch" without a hand-written TUI.

## Priority
UI is a milestone viewer; put effort into the business chain (target nomination, pipeline
reliability, weaving structured tool data into synthesis), not pixel polish.
