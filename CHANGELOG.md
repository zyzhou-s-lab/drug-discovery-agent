# Changelog

本项目所有重要变更都记录于此。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.0](https://github.com/zyzhou-s-lab/drug-discovery-agent/compare/v0.0.2...v0.1.0) (2026-07-14)


### Features

* **api:** wire DD_DR_BUDGET token-cost fuse into deep-research runs ([#22](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/22)) ([4cc07be](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/4cc07be33cecdc3e094adb71028b7242553e962d))
* **assets:** per-campaign compute-facing asset layer ([#28](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/28)) ([d65f54e](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/d65f54e44ee2b73cf6af19ffa017a505321ac1e2))
* **engine-ts:** [#30](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/30) phase 1 — port the per-campaign asset layer ([#40](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/40)) ([8fe7bdf](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/8fe7bdf0c32db5d64c4acb10b5c32b0cc62f2d56))
* **engine-ts:** [#30](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/30) phase 2 — incremental per-stage asset persistence ([#42](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/42)) ([258e215](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/258e215199c4ae90aed486565b34b1b51a1070c8))
* **engine-ts:** [#30](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/30) phase 3 — per-angle map-reduce synthesis ([#43](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/43)) ([558010e](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/558010e86e807faac3a8b91654ffdb8ff6421600))
* **engine-ts:** circuit breaker — auto-pause a run when the provider is rate-limited ([#49](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/49)) ([9ea6661](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/9ea6661278c7b99a5f6cab0faf8e1baa3d4a52af))
* **engine-ts:** cutover phase 1 — port the read/CRUD endpoints ([#44](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/44)) ([ed90d84](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/ed90d84038ca714f7fb0bc41beee445fc688cda7))
* **engine-ts:** cutover phase 2 — agent step-stream + per-stage SSE ([#45](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/45)) ([d2b05cb](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/d2b05cbeb20599525abf41c9b3942c3a1d2df142))
* **engine-ts:** cutover phase 3a — side-chat (LLM) endpoint ([#46](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/46)) ([035464a](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/035464aaf83ea9110b71051e16765f1e4410d91c))
* **engine-ts:** cutover phase 3b — intake gate (disease validation) ([#47](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/47)) ([30501e0](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/30501e091477c0df02ab06b71e7382bed7d310fe))
* **engine-ts:** cutover phase 3c — pipeline run + report narrative (+ arch mermaid) ([#48](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/48)) ([b5ba7a1](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/b5ba7a170960e7f8bb6df37ffddd58f03d314f03))
* **engine-ts:** lossless pre-verify claim dedup ([e0a489f](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/e0a489fe3e57bab7c0006ac890967bc627d0ac11))
* **engine-ts:** per-sub-agent deepresearch/ artifacts (rename 01_discovery → deepresearch) ([fcdd47d](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/fcdd47d37242743c38a3c08fa14ce352222974e9))
* **engine-ts:** per-sub-agent deepresearch/ record + derive assets/ from it (CQRS) ([ddefca4](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/ddefca4de012ca86dd30ad0517d0d8350622a418))
* **engine-ts:** Phase 1 — TS pure-logic core + zod schemas ([#31](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/31)) ([b005cbe](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/b005cbeb167268a388e9bc9902508229376c477b))
* **engine-ts:** Phase 2 — storage (bun:sqlite) + HTTP tools ([#32](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/32)) ([3aea5c0](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/3aea5c0fd69e93021c1efe60294e7f3cd767e2c9))
* **engine-ts:** Phase 3a — runAgent forced-tool agent primitive ([#33](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/33)) ([1f79769](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/1f797699dcedfffce02ba9fd917a8602d7ae53b8))
* **engine-ts:** Phase 3b — scope + literature MCP tools ([#34](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/34)) ([a77b96a](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/a77b96a7caca337bc8a5d8d57764fe99a14a8ffa))
* **engine-ts:** Phase 3c — deep-research five-phase engine (research) ([#35](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/35)) ([70826ac](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/70826ace1bda03b5c181d8203b01f63afd756969))
* **engine-ts:** Phase 4a — read API on Hono ([#36](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/36)) ([3c3ed19](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/3c3ed19f1add08d03cef01da07fc205ca636ba9d))
* **engine-ts:** Phase 4b — config (settings.json) + SSE event stream ([#37](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/37)) ([a3a6aad](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/a3a6aad334ddccc79eb5c1a7d43913ac1f002d0b))
* **engine-ts:** Phase 4c — run trigger + server entry ([#38](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/38)) ([c61753a](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/c61753a7dd9bf1755d600f519ef3473e1a16bb8e))
* **engine-ts:** Phase 5 — report parity harness + cutover runbook ([#39](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/39)) ([df28264](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/df28264f8f426d2309b09e62b65dfd719d260053))
* **engine-ts:** pre-verify claim dedup (lossless) — verify each fact once ([8307dc0](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/8307dc0b75618a547237fcb03f2cc50b203616f2))
* **engine-ts:** user-level settings.json + persistent data dir (Claude-style) ([#51](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/51)) ([13bb966](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/13bb96637fa3f3144a3723e8162a698a0d4e38fa))
* **engine:** add genetics MCP server (gene info / ClinVar / GWAS) ([dccf48c](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/dccf48cb93cb96322204185b6a5cd45b15db04c2))
* **engine:** CLI runner + dev-workflow note (terminal run, pencil.dev for UI) ([#81](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/81)) ([3cc3f5e](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/3cc3f5ea829f7d78ebae7101d4e844aa85179c37))
* **engine:** enrich nominated targets with cross-DB gene evidence (structure/pathway/genetics) ([8486df3](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/8486df3d81dc86805679c55c06d9dc6b2316762c))
* **engine:** front-load a research-focus input that steers scope ([245074c](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/245074c173bcf6a298af9383439c1ef0a3b53146))
* **engine:** get_cellxgene_datasets + get_hca_projects MCP tools ([#76](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/76)) ([e5b6444](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/e5b644401da38998b0ec2bb4c66161e9c5fd6056))
* **engine:** get_clinical_trials MCP tool (ClinicalTrials.gov v2, new clinicaltrials server) ([e59f31d](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/e59f31d7e753e18b51a30f39f5327edcb9ff1f17))
* **engine:** get_opentarget_targets MCP tool (real target-disease data) ([#75](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/75)) ([05761cb](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/05761cba8d780a5d5200a2584f44366c537c2644))
* **engine:** resume-from-checkpoint -- continue a 429-paused run's tail instead of redoing it ([96fc771](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/96fc7711786310ca28038a1c391819985a721ab1))
* **engine:** resume-from-checkpoint hardening -- reconstruct from step records + clean view ([6b43f71](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/6b43f71ebbda39c346ab3ae5cfde9b4ac103db57))
* **engine:** route search/fetch through web-rooter MCP, drop dead WebSearch/WebFetch ([afc7d36](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/afc7d3687ccbdd007164e91aeb7d216ea19e3dc8))
* **engine:** steer FETCH agents to get_clinical_trials in the database PREFER list ([d846e1f](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/d846e1f4d801ba135d756f0a5ebbeec8905a1bbb))
* **engine:** wire target nomination -- ranked candidate targets as the output ([6538740](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/6538740c66b82276522a24bea42648243444fd5f))
* **nominate:** stage-1 deterministic OpenTargets target ranking (nomination M1) ([#25](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/25)) ([2b3f084](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/2b3f084142f22ca8a6c8489a14bcf8544ee450fa))
* **perturb_tools:** vendor scGen perturbation MCP tool (forward-looking infra) ([#24](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/24)) ([f173342](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/f17334232841fe4278e6ebbe3ac64ed4f6368ff9))
* **proxy:** in-process HTTP→SOCKS5 bridge to route agent web traffic ([#26](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/26)) ([ef34e1e](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/ef34e1e8db670da0593819a1b08908d3978318b5))
* **report:** literature-card list (title/authors/venue + verify status) ([#71](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/71)) ([7886954](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/7886954b875b42cb900d16d6ab701d6ae8615a71))
* **report:** restructure brief as per-angle Q&A ("研究报告") ([#64](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/64)) ([400b384](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/400b3849b3787f5b42c5e96d2b04850ad3e35277))
* settings 技能 + 工具 tabs backed by /api/capabilities (tools grouped by MCP server) ([0a605a1](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/0a605a17aa220308da7de08a41481bee7eb9b785))
* **settings:** user-configurable model endpoint + deep-research knobs ([#23](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/23)) ([272bcb0](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/272bcb03778f31a2e9c5874232cc719a06ac0397))
* tool expand (param schema) + enable/disable toggle (gates the pipeline) ([ef026a8](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/ef026a8a519eb4a830aac94068e95c5882f3e2ae))
* **web:** browser title 'dda agent' + favicon (uploaded logo) ([b61c7b1](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/b61c7b1f48aea7cabe83a8c78d8d84fe63df44e3))
* **web:** classify database-record badges by biological data type ([#73](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/73)) ([ef7d134](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/ef7d134ac76dc5466aa0851a2d4e6a7516007fad))
* **web:** clearer deep-research settings labels ([46d86f2](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/46d86f29c46311537d80003af79382dd4c6fec5b))
* **web:** codex-style settings — left nav (通用/模型/运行/关于) + right content ([13e8475](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/13e84750ab54570fb367dadbd4f42cdb97ff8c26))
* **web:** create runs under the canonical disease name (intake normalized_en) ([4e18632](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/4e18632a37191101091636088a3517f5f15c91e7))
* **web:** drop visible '设置' title in settings dialog (sr-only for a11y) ([7615e8f](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/7615e8fd1559d299da5016df0fb6d9429a3b7f86))
* **web:** explain the two deep-research settings (并发上限 / 核验条数) ([09c89f1](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/09c89f1d6039eb4d9cded34c946404632944267e))
* **web:** faithful deep-research report view (consume backend contract) ([4ca2e34](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/4ca2e346dcb25dc44a30d6facda4700257b343e3))
* **web:** faithful deep-research report view (consume backend contract) ([a50162a](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/a50162ad74ba347f75f53148c1aa151117cbcee1))
* **web:** favicon → transparent vector SVG (drop white-bg png) ([adefd1a](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/adefd1aabb70bdc93a164c847721598f8d0f1407))
* **web:** group Files view by deepresearch/ step and assets/ folder ([fc214b0](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/fc214b07669ebbedbd8ddaf050d383298f9b739a))
* **web:** mobile-responsive shell (P1 foundation + P2 layout) ([ea86bb8](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/ea86bb8c7e6a274d6d7da36529cff567c8ce0576))
* **web:** P1 mobile foundation — viewport, theme-color, safe-area enablement ([c89c7f7](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/c89c7f75133a0f51c6f164b1fda1db01660e89c6))
* **web:** P2 responsive shell — mobile sidebar drawer, chat overlay, safe-area ([3759f3b](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/3759f3b2cb5db63f45e043e900f2a948a9aee048))
* **web:** remove redundant Scope entry from sidebar ([dea8453](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/dea8453d9b75682e1c9932b14a5a52d64a8897e3))
* **web:** remove the standalone Scope (研究角度拆解) entry from the main sidebar ([bb37606](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/bb3760607db9a0f6d8d56c3801db4f6851bf0bda))
* **web:** render structured database records as tables (Open Targets style) ([#74](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/74)) ([ad0c554](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/ad0c554beb90ee21eb65d30cd207289d7d7ee083))
* **web:** restyle Settings dialog in the ChatGPT/Codex two-pane style ([55082ad](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/55082ad4c83ab6d237799f25518d3b05ed1abdd5))
* **web:** routing — index (campaign list) ↔ /c/:campaign detail (hapi parity) ([92f8229](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/92f8229aba922c6b332c0a8e104f4bd19034c4eb))
* **web:** simplify 新建项目 dialog copy (title/placeholder/confirm) ([fe80685](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/fe806853377fa3e37be50e5157a0824fbc14725a))
* **web:** StageRail equal-size buttons, inline status Badge; rename stages ([1162799](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/1162799da55ab4b9232929c7ed33eddf5c8f0e3d))
* **web:** structured file renderer (P1) ([4a51cf6](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/4a51cf68df23cc051f0a72b39372537a9c6f4c15))
* **web:** structured file renderer (P1) for deepresearch/ + assets/ in the Files view ([7b5ebb7](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/7b5ebb7c163d89b3b02594c0c6a267e9823cf9dd))
* **web:** Toast notifications provider (hapi parity) ([a87cd6f](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/a87cd6f2fcd0f4c6ed2610a7062956631220c300))


### Bug Fixes

* **engine-ts:** make deep-research workload knobs tunable (the Settings 核验条数 was a no-op) ([a794e2b](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/a794e2b616b89a918900a3a6e24954f9aa1f160c))
* **engine-ts:** treat provider 403/quota as a pause in intake + scope ([5301ee0](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/5301ee0087b3bf2d0094cd3408aff21a7a55c667))
* **engine-ts:** tunable deep-research workload knobs (核验条数 etc.) ([bd86afd](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/bd86afdd800b65dd4c205fde3bb9cb8be479a085))
* **engine:** back off & retry rate-limit (429/403 频限) instead of tripping ([#67](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/67)) ([cec24c1](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/cec24c1802d4da500b15ad74ba73b7d867cbf191))
* **engine:** cellxgene fetch timeout + disease-weighted relevance ([#77](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/77)) ([6e77d4e](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/6e77d4e743767c55d33eefb26dad71cf21ed3ac6))
* **engine:** keep native WebFetch — only WebSearch is dead on Kimi, not WebFetch ([75d57af](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/75d57afc32c97fe3ae859c448a3572114672d529))
* **engine:** make DD_DR_MAX_CLAIMS a hard ceiling on verify volume ([#68](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/68)) ([0380f81](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/0380f81a0fa043cc2c8bbede96d51a09b24cd638))
* **engine:** side-chat guardrail no longer blocks translating run content ([cd8e0ac](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/cd8e0ac24273b2b47c136a3d9be6b4991d4037a4))
* **engine:** skip WebFetch preflight so it works on non-Anthropic gateways ([#66](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/66)) ([76be844](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/76be844f83ee9ff4aaaebb0aa8a31f745c46513f))
* **engine:** trust Tailscale CGNAT (100.64/10) origin for CSRF guard ([30f36d4](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/30f36d4a81873817d50100a336541d424e9a7abe))
* **report:** candidate card readability -- drop subjective scores, show structure/GWAS as facts ([4124486](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/41244866984ba7a1a3cfeee06375aae30f2b3775))
* **web:** clear deleted campaign from center panel (delete-residual race) ([#20](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/20)) ([2e52202](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/2e52202324821636f92ac1062e9ff58258917a63))
* **web:** database card falls back to prose when no table columns render ([#78](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/78)) ([bfdfd72](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/bfdfd72ac5b628f3f17741b7394eef14985359ae))
* **web:** drop phantom "会话 · search" session card (phase-level events, no agent) ([d3e2dfb](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/d3e2dfb8e2e1917bb0063c309684ac83de161ef9))
* **web:** drop phantom session card from phase-level events ([a4967f8](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/a4967f8fb634f3d47ee66589373ad8dfd24bb558))
* **web:** Files view single-pane on mobile (list ↔ file content), so files are viewable ([9ce8091](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/9ce8091211036a24b8f7d562eb288309d2e06718))
* **web:** guard verdict score (paused/empty run crashed on undefined.toFixed) ([e975b34](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/e975b3469faeb3c393757a8441c1e7481150045d))
* **web:** guard verdict score (undefined.toFixed crash) ([0a78e4b](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/0a78e4bb98fba75e8b4e0ca4cc0b4e064bd8e581))
* **web:** hide numbered 参考文献 card when there is no narrative ([#80](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/80)) ([06d7330](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/06d733036d70f7e43d534f35c4d793326636eda2))
* **web:** mobile line-wrapping — drop font-mono on angle query; keep session title on one line ([cae06a3](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/cae06a35cd31c5ae17ab759b728682ce58bbe3b6))
* **web:** prune redundant scraped DB records + strip HTML from prose ([#79](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/79)) ([375821d](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/375821d575e17e0696e4df9e8363ec65775d10e9))
* **web:** report page readability -- overview first, human score labels, drop confidence tags ([6256967](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/6256967466c1a770f17e1a9131e946007a782869))
* **web:** resolve App.tsx merge-conflict markers from [#71](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/71) ([#72](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/72)) ([4b2e4eb](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/4b2e4eb98eb162f56a83a1f8a912672fcd6d6057))
* **web:** restore tailwind.config.ts (accidentally swept into [#81](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/81)'s git add -A) ([#82](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/82)) ([24d3e6d](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/24d3e6d8a8f842ebd25ce553b2b6d6b68f3dda23))
* **web:** session card back to one row on desktop (stats right, not a left 2nd line) ([ab7fea3](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/ab7fea336447da5b79603c9be7e148aa3d1c3b06))
* **web:** session card one-row on desktop ([e04c701](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/e04c701cfa2f5991c693c216aa39e19c1e8c0c8f))
* **web:** session-card alignment + compact header subtitle (mobile) ([45c8824](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/45c8824edae1e90c1e67fdd64080edae29d806e4))
* **web:** show 已暂停 (not 失败) for a quota/rate-limit-paused run ([35fe6dc](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/35fe6dc000ec94e9ec072363ac87c94f36c81688))
* **web:** stop the 深度研究 tab bouncing to 研究报告 on first click ([34ba28a](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/34ba28ad540cde9c04eb4f915e704d87a2ae81b1))
* **web:** 已暂停 badge for quota-paused runs (was mislabeled 失败) ([55f9f84](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/55f9f8419202b621d3640c1b77665867d3f7428d))


### Refactoring

* derive tool inventory by introspecting the real MCP defs (drop TOOL_SPECS) ([b9fc69a](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/b9fc69a89a9a5d18d9aceca47defe80094b48033))
* **engine-ts:** derive assets/ from deepresearch/ (single source of truth, CQRS) ([fe72604](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/fe72604e123170258d57685ded2be7b51258ee09))
* **engine:** single model/endpoint source (config.ts ANTHROPIC_*), drop per-stage DD_* overrides ([b617b14](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/b617b14ce0479bb7dcd09e118009db9cdbb84ccf))
* **settings:** wholesale settings.json + round-trip api_key ([#27](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/27)) ([e6ca0b2](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/e6ca0b2876bd0c7a1c0821ebffb0c2ac7f5683b9))
* single source of truth for tool descriptions (toolspec.ts) ([ebde01c](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/ebde01c4e03390052653d003375d501f862366a7))
* split the lit grab-bag MCP into focused per-source servers ([098d36a](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/098d36a5bfcda32be9d7e77d2447c2e3c40a3cfc))
* **web:** extract pipeline/stage views into components/pipeline/pipelineViews ([9ba0a02](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/9ba0a0214ffda51bd8a17b4750d9e347f162da91))
* **web:** extract report view + cards into components/report/reportView ([8f0da05](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/8f0da0541354e88d92eacc8592c9621a8e3eb5ee))
* **web:** extract shared report constants/helpers to lib/reportShared ([6e1702e](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/6e1702ed878c817cb29187be44341cbb18c03143))
* **web:** replicate hapi's exact mobile mechanism (single-pane swap, not a drawer) ([0db2f3d](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/0db2f3d986ef961cd1301124dc42c3e498a9435a))
* **web:** trim App.tsx imports to what it actually uses ([b8916ce](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/b8916ce5b7920a0ca3403097c296ae4d9ff30d75))


### Documentation

* audit + restructure design docs ([#50](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/50)) ([85f5b73](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/85f5b73ada477128e8667b650ee6b86b36897171))
* Bun/TS backend migration evaluation & plan ([#29](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/29)) ([0a5450c](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/0a5450cdb930091bbe498574f576a6115b4616c8))
* clean up stale references to Python backend and parity ([3c85a76](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/3c85a762ac301283fe6f586da05fd6fef458e20b))
* frontend QC playbook (run after every change) ([a0ca128](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/a0ca12837103eaf16ef175a8d9fb6a04392a4548))
* harness engineering analysis + dda gap assessment ([#69](https://github.com/zyzhou-s-lab/drug-discovery-agent/issues/69)) ([4beeaf2](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/4beeaf2411456b5d482256696a8175412ef1644c))
* mark engine-ts service persistence as done ([961af55](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/961af554c2648fa0741a8946c3de99b3062fb732))
* sync engine-ts deployment status ([4995f09](https://github.com/zyzhou-s-lab/drug-discovery-agent/commit/4995f09630fe31c29f003c39df4f8f10aa0e280e))

## [0.0.2](https://github.com/zyzhou-saffron/drug-discovery-agent/compare/v0.0.1...v0.0.2) (2026-06-16)


### Bug Fixes

* **ci:** bots must not end with open-ended "需要我帮你生成…吗" offers ([#15](https://github.com/zyzhou-saffron/drug-discovery-agent/issues/15)) ([b3cb7ff](https://github.com/zyzhou-saffron/drug-discovery-agent/commit/b3cb7ff53cb4f9c2469899b0b912d8d5eedfdca3))


### Documentation

* add CHANGELOG.md documenting Phase A (v0.0.1) ([#13](https://github.com/zyzhou-saffron/drug-discovery-agent/issues/13)) ([048f2b5](https://github.com/zyzhou-saffron/drug-discovery-agent/commit/048f2b533cfdaf41e9373f3cd16e230c863a654a))

## [Unreleased]

目前尚未发布带标签的正式版本。下方 `0.0.1` 汇总了 Phase A 开发期（2026-05-31 起）的全部工作。

## [0.0.1] - 2026-06-10

药物靶点发现 Agent harness（Phase A）。完整流水线：靶点发现 → 设计，配合深度研究引擎与可观测的 Web 前端。

### Added — 核心流水线

- 初始架构：药物靶点发现 agent harness、五阶段发现逻辑链（发现 → 文献证据 → 靶点筛选 → 验证 → 综合）。
- M0 骨架：零 API 的控制流（dummy worker）。
- M1：Agent SDK worker + 类型化 API judge + CLI（`--real` / `--only`）。
- OpenTargets GraphQL 客户端（仅依赖标准库），覆盖遗传学等检索角度。
- M2：stage-1 真实 scatter-gather（4 个角度，经 OT datatypes）。
- M3a：stage-2 文献证据 + 阶段间数据流。
- M3b：stage-3 靶点筛选（OpenTargets `target_profile`：tractability / constraint / safety / drugs）。
- M4a：stage-4 验证 —— planner + 动态 scatter + 加权 judge。
- stage-4 综合节点：加权裁决 + 冲突标记。
- stage-0：疾病概览 + 三层 fan-out。
- 疾病 intake gate（提交时校验疾病名），统一收敛到 `Runner.run` 单一入口。

### Added — 深度研究引擎（M1–M3）

- 深度研究 SDK 移植：Scope 阶段、独立页面、scope-only 流水线。
- M2 深度研究引擎：Search / Fetch / Verify / Synthesize 四阶段。
- M3：`source_type` 路由的 fetch，文献 / Web / 轻量数据库作为 agent 工具。
- 多来源检索 + DOI 引用 + APA7 参考文献（bibliography 来自已确认来源）。
- 中文叙述报告展现层 + 数据库原始记录 + 统一引用。
- StructuredOutput 校验 + 有界 nudge（对齐 Claude Code 的 `submit_*` schema 校验）。

### Added — Web 前端与可观测性

- M5 observer：读取 API（SSE）+ SDK 事件流 + Web UI（Vite 全栈）。
- 深度研究实时阶段进度面板；phase 行可折叠并作为 master-detail 选择器。
- 每个 agent 一张 session 卡片，展示 Prompt + Outcome + tokens（与 CC 对齐）。
- 运行重命名 / 删除、可调整大小的面板、右侧大纲、文件页。
- `/btw` 聊天面板（流式 + 持久化 + Markdown），聊天基于检索报告。
- 「重新检索」按钮：终态运行可携带 scope 角度重启。
- 协作式取消 / 停止：删除或停止运行会中断在途 agent。
- 通过 rehype-raw 支持 Markdown 中的原始 HTML 渲染。

### Added — CI 与机器人

- 在 PR 与 master 上运行 pytest 工作流。
- agentic PR review 工作流（Claude Code / MiMo + gh 工具）。
- mention 响应机器人（`@zyzhou` 召唤），可读取 PR 评论线程作为上下文。
- issue 自动响应机器人。

### Changed

- master 仅保留深度研究流程，移除旧的 discovery 流程与 disease-overview judge。
- judge 经由 `claude -p`（SDK 会话 + `submit_verdict` 工具）实现类型化输出；LLM judge 前增加确定性 gate（格式 / 完整性校验，零 API 成本）。
- CI 工作流与提示词文件名去除模型品牌标识。

### Fixed

- intake gate 在 `Runner.run` 内执行，修复 web/api 运行绕过仅 CLI gate 的问题。
- 文献工具网络超时不再抛错，避免 agent 死循环。
- 停止运行时硬取消在途搜索 agent；自愈孤立的搜索状态。
- 论文摘要经 Semantic Scholar 回退获取；限制工具调用次数以加速搜索 agent。
- 修正 OpenTargets 字段使用（移除 `knownDrugs`，从 tractability 推导 `has_known_drug`）。
- 多处前端状态修复（终止运行显示「已中断」、空 phase 卡片、null 安全等）。

[Unreleased]: https://github.com/zyzhou-saffron/drug-discovery-agent/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/zyzhou-saffron/drug-discovery-agent/releases/tag/v0.0.1
