# Plan: move from Deno to Bun, and later items

Status 2026-10-13: decided (owner, dated in the text below), not started. No DECISIONS row records the runtime change yet; S1 still says Deno 2. The move waits on the LS++ port being finished and `packages/liftoscript` retired as the oracle. Carried here unchanged, apart from this title and header, from an untracked `docs/roadmap.md` in the main checkout. The central roadmap is `docs/ROADMAP.md`.

Work that is decided but not done, in the order it happens. Choices still to be made go in `docs/decisions-pending.md`; choices already made go in `docs/DECISIONS.md`. An item leaves this file when it ships.

## Move from Deno to Bun

Decided 2026-10-13 (owner): replace Deno with Bun. The move waits until the LS++ port is finished and `packages/liftoscript` is retired as the oracle. Until then the repo stays on Deno. Fallback if the first check below fails: Node with Vitest and tsx.

### Why Bun

One binary covers what Deno does here: `bun test`, `bun fmt` (Prettier-compatible output, reads `.prettierrc`), `bun lint` (ESLint and typescript-eslint rule sets, configured in `bunfig.toml`), `bun check` (type checker), `Bun.serve` and `bun:sqlite`. Anthropic bought Bun in December 2025 and kept it MIT-licensed with public development. Checked against the Bun 1.4.3 docs on 2026-10-13; none of the commands were run here, and Bun is not installed on this machine.

Risks:
- Bun 1.4 (2026-08-20) is the first release written in Rust.
- Bun runs JavaScriptCore. Deno and Node run V8, and the Rust ports are matched to V8 behavior (`crates/qala-lspp/src/js.rs` takes expected values from V8, for example `Math.round(-2.5)`). Waiting for LS++ removes the largest oracle from that comparison. Float-heavy goldens that stay TS (Kalman filter, decay) can differ in the last digit between engines.

### What Deno touches today (counts from 2026-10-13, main at 4758658)

- Tests: 295 `Deno.test` declarations in 53 files, 24 imports of `@std/assert` using five functions (`assertEquals`, `assert`, `assertThrows`, `assertNotEquals`, `assertAlmostEquals`), about 40 fs and socket calls inside tests. 10 of the 295 are liftoscript's.
- Server: 34 `Deno.*` calls outside tests. `sync.ts` (16) and `ws.ts` (4) hold 20 of them, and S11 replaces both files. The rest are in `static.ts`, `tiles.ts`, `elevation.ts` and `mod.ts`.
- Scripts: 16 files in `scripts/` plus 5 `gen_*.ts` in `crates/qala-lspp/testdata/unit/`. 29 distinct `Deno.*` names across server and scripts. About 10 of the 16 scripts are liftoscript-specific and go with the oracle.
- Workspace: root `deno.json` (14 tasks, fmt and lint scopes), a `deno.json` per package, `deno.lock`, 8 workspace members.
- Rust bridge: `scripts/build_wasm.sh` emits one `wasm-bindgen --target web` build in `target/wasm-out/web/`. Vite loads it by URL; Deno (`server/lspp.ts`, `scripts/wasm_smoke.ts`) loads it with `init({ module_or_path: bytes })`.
- Deploy: `deploy/qala.service` runs `deno serve ... server/main.ts`. That file has never existed in git history, and `server/mod.ts` starts itself under `import.meta.main`, so the unit couldn't start as written (fixed 2026-10-13: it now runs `deno run ... server/mod.ts`).
- Docs: `docs/plan-accounts-logins.md` is written against Deno's `node:sqlite`, argon2 through npm compat and the JSR build of `@simplewebauthn/server`.

### Start gate

The LS++ port is complete and `packages/liftoscript` is retired as the oracle. Not blocked by the gate: reading `baseUrl` from `LLM_GATEWAY_URL` in `server/llm.ts` (works on Deno today).

### Steps, in order

1. First check. Record the current `deno test` pass count. Install Bun and re-read its docs (it will be a newer version by then). Run the tests that remain, regenerate any TS oracle output that still exists and diff it against Deno's. If no TS oracle is left, this is just the pass count. Byte-identical output (or last-digit float differences that can be explained) and a matching pass count mean go. Anything else means stop and revisit.
2. Tooling base. `bunfig.toml` with `[fmt]` and `[lint]` settings, a root `package.json` with workspaces, the `@std/assert` alias to `@jsr/std__assert@1.0.19` (with `@jsr:registry=https://npm.jsr.io`), `bun.lock`.
3. Pure packages. Codemod `Deno.test(` to `test(` from `bun:test` in `engine`, `generator`, `run`, `llm`, then `apps/web/src/logic`. Match `**/*_test.ts` so no file is renamed. Confirm the pass count still matches.
4. Scripts and wasm. Port the scripts that survive the LS++ retirement: `dem_fetch`, `tiles_extract`, `tokens_to_kotlin`, `lucide_to_kotlin`, and look at `golden_engine.ts` and `wasm_smoke.ts`. `Deno.args` becomes `process.argv.slice(2)`, `Deno.exit` becomes `process.exit`, the one `Deno.Command` becomes `child_process`. `build_wasm.sh` is already off `--target deno` (it builds `--target web` only, 2026-10-14); check under Bun that `server/lspp.ts` and `wasm_smoke.ts` still load it, reading the bytes through `Bun.file` instead of `Deno.readFile`. The 7 GB heap flag in `gen_liftoscript_testdata.sh` only matters if a heavy generator survives. Rerun the Rust fixtures through `scripts/cargo-test-safe.sh`.
5. S11, then the server. Land record sync so `sync.ts` and `ws.ts` disappear. Port the rest of `server/` to `Bun.serve` and `node:fs` (`Deno.open` with `SeekMode` becomes `fs.open` and positional reads), and port `server/*_test.ts` (they use `Deno.serve` and `Deno.connect`).
6. Cut over. Point `deploy/qala.service` at Bun. Run `bun fmt` once as its own commit and add it to `.git-blame-ignore-revs`. Drop `deno.json` and `deno.lock`. Update README and PLAN. Rewrite the Deno-specific parts of `docs/plan-accounts-logins.md`.
7. Record it. Amend S1 in `docs/DECISIONS.md` and write `docs/adr/0004` for the runtime change.

### Open

- When does Deno stop being usable? Waiting for LS++ only works if it stays usable until the gate opens. The installed 2.9.7 binary keeps running, but new installs and any CI image would not.
- Do the engine, core, run and generator TS packages retire with LS++, or later under S6? Whatever stays TS is what the first check still has to diff.
- Is the VPS from S22 live yet? If the server has only ever run on callisto, the unit-file fix carries no deploy risk.

## Later

### Elixir model gateway

A small Elixir service between the app server and the model hosts (llama-server :8080, E4B-mm :8083, whisper.cpp :8082, Sonoro and MinerU :7880), for queueing, fairness, streaming and fallback as the user count grows. Not part of the Deno exit. Elixir and Erlang are not installed on this machine.

Why it is later: the proxy is not a bottleneck today (one GPU box, E4B about 0.85 s per clip, a handful of users), so a semaphore in the app server does the same job. Build it when queue waits pass a couple of seconds, a second model host appears, or several people stream coach chat at once.

Seam, any time: in `server/llm.ts`, read `baseUrl` from an env var such as `LLM_GATEWAY_URL` and pass `X-Qala-*` headers through. `ChatOptions` already takes `baseUrl` and an injectable `fetchFn`.

Split of work:
- App server: session auth and the user id, signs each call to the gateway, keeps prompts, schemas, matching and LS++ emit in `packages/llm`, maps gateway failures to the existing 502 `{ degraded: true }` body.
- Gateway: per-backend queues and concurrency limits (slots from llama-server `--parallel`), per-user fairness and priority (interactive over batch), SSE passthrough that aborts upstream when the client drops, health checks and circuit breaking, the E4B-to-whisper fallback.
- Model hosts on callisto: unchanged.

Contract sketch:
- `POST /v1/chat/completions` to llama-server, pass-through, streams with `stream: true`.
- `POST /v1/transcribe` to E4B-mm then whisper.cpp, wav in, `{ text, backend }` out.
- `POST /v1/pdf` to Sonoro and MinerU, batch priority with its own queue.
- `GET /healthz`, per backend: `up`, `degraded` or `down`, plus in-flight, queued and free slots.
- Auth between the services: `X-Qala-User`, `X-Qala-Ts`, `X-Qala-Sig` (HMAC-SHA256 over user and timestamp, shared secret), plus `X-Qala-Priority: interactive|batch`. The gateway binds only to the private interface and never sees a cookie or passkey.
- Errors: a down, slow or erroring backend returns 502 with `{ ok: false, degraded: true, error, backend }`. One new case: 429 with `Retry-After` when a user's queue cap is hit; the web client would need to handle it.

Process layout: an OTP application with a Registry, a Task.Supervisor for in-flight upstream requests, an ETS token-bucket limiter, one supervised process per backend (`:chat`, `:stt`, `:stt_fallback`, `:pdf`) and a Bandit and Plug router. Req for streaming upstream calls, `:telemetry` for queue depth and latency.

Where it runs: on callisto next to the GPUs, with the VPS app server calling in over a private link (Tailscale, WireGuard or an SSH tunnel). This is the open item in ADR 0002: the VPS cannot reach callisto's loopback, so `/api/llm/chat` there returns 502 degraded today. S22 drops Tailscale for users, which a server-to-server link does not affect.

A Phoenix app for the whole server was considered and rejected: it re-ports auth, tiles and elevation, and cannot share `qala-core` without Rustler NIFs.

### Other later items

- Try Vite under Bun so Node can drop out of the repo. Keep Node for the web build if anything breaks.
- Swap `tsc --noEmit` for `bun check` once the two agree on this repo.
- Revisit a Rust server (S6) once the runtime move is done.
