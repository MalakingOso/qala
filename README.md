# Qala

Qala is a self-hosted app for lifting and running. Programs are written as
LS++ text, an adaptive engine adjusts the plan from check-ins and
logged sessions, and a local coach model explains the numbers. Runs are
recorded in the same app and feed the same fatigue model as lifting.

## Status

Working v1 on the web (the desktop shell and a frozen phone PWA, both on sample
data), and a native Android app in progress. `docs/ROADMAP.md` says where each
track stands and what it waits on. The original plan is `docs/PLAN.md`, the
design system `docs/DESIGN.md`, and the decision log `docs/DECISIONS.md`. The
Android app has run on the emulator only. The device gates (a 2 h locked-screen
run, Spotify ducking, a killed service resuming) are in `docs/android-native.md`
section 5 and haven't been run on the phone.

## Layout

- `packages/liftoscript/`: liftosaur's grammars and evaluator, vendored with
  the same file names so upstream diffs stay readable. The TS oracle; the
  language going forward is LS++, which the desktop editor and the server run
  through wasm.
- `crates/`: `qala-core` (pure logic: engine, availability, HLC, records, plate
  math), `qala-ffi` (UniFFI for Kotlin, exports `qala-core` and LS++), and the
  Rust LS++ port in `qala-lspp`, `qala-lspp-json` and `qala-lspp-wasm`.
- `packages/core/`: data model, document schema, exercise seed and overlay,
  units and rounding.
- `packages/engine/`: adaptive training engine, pure TypeScript.
- `packages/generator/`: rules engine that emits LS++ programs.
- `packages/llm/`: prompt builders and response validation for the coach.
- `packages/lspp/`: typed client over the LS++ wasm build (`deno task
  build:wasm` makes it); the web app and the server both load it.
- `packages/run/`: GPS pipeline and guided workout step machine, pure
  TypeScript.
- `apps/web/`: React PWA with the desktop author shell and the phone logger
  shell sharing one theme.
- `apps/android/`: native Kotlin and Jetpack Compose phone app (Gradle
  project: `app`, `design` for the tokens and components, `data` for Room and
  the Rust build). In progress.
- `server/`: Deno server on 127.0.0.1:8500. Sync (Automerge, to be replaced by
  record sync), Tailscale-header auth, tile and elevation serving, the LLM
  proxy and text import.
- `deploy/`: systemd unit and Tailscale notes.
- `docs/`: start at `ROADMAP.md`; `README.md` there indexes the rest (plans,
  the decision log and its pending queue, decision records, research, blog
  and podcast drafts, and an `archive/` of finished handoffs).
- `assets/fonts/`: the source font files. The web app serves copies from
  `apps/web/public/fonts/`.
- `mockups/`: hand-drawn review canvas. Not app code.

## Run it

Prereqs: Deno 2, Node 22 + npm. First install the JS deps:

```sh
npm --prefix apps/web install
```

```sh
deno task build:wasm   # LS++ wasm into target/wasm-out/web; docs/rust-core.md has the one-time installs
deno task build    # typecheck + bundle the PWA into apps/web/dist
deno task test     # every package's tests; server/ needs the wasm built first
deno task dev      # server with watch on 127.0.0.1:8500, serves dist/
deno task serve    # server without watch
deno task build:android   # debug APK of apps/android; see docs/android-native.md 11
```

The server listens on 127.0.0.1:8500 and is published on the tailnet with:

```sh
tailscale serve --bg --https=8443 http://127.0.0.1:8500
```

See `deploy/tailscale-serve.md` for the full notes.

Rust tests run through `scripts/cargo-test-safe.sh -p <crate>`. A bare
`cargo test` can exhaust memory and has killed the terminal.

## License

AGPL-3.0 or later, see LICENSE. Liftoscript, the exercise seed, and the
built-in programs come from liftosaur (also AGPL-3.0), credited in NOTICE
along with the fonts, icons, and chart libraries.
