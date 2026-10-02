# Qala

Qala is a self-hosted app for lifting and running. Programs are written as
LS++ text, an adaptive engine adjusts the plan from check-ins and
logged sessions, and a local coach model explains the numbers. Runs are
recorded in the same app and feed the same fatigue model as lifting.

## Status

Working v1 build. The plan is in docs/PLAN.md, the design system in docs/DESIGN.md, and
the decision log in docs/DECISIONS.md. `deno task test` runs 219 tests green;
`deno task build` typechecks and bundles the PWA; `deno task serve` runs the
server against the built PWA. Device gates (background GPS recording, APK on
the Nothing Phone, TTS ducking) still need the real phone (docs/PLAN.md 14).

## Layout

- `packages/liftoscript/`: liftosaur's grammars and evaluator, vendored with
  the same file names so upstream diffs stay readable. The TS oracle and the
  desktop authoring runtime; the language going forward is LS++.
- `crates/qala-lspp*`: the Rust LS++ port with wasm (web, server) and UniFFI
  (Android) shims.
- `packages/core/`: data model, document schema, exercise seed and overlay,
  units and rounding.
- `packages/engine/`: adaptive training engine, pure TypeScript.
- `packages/generator/`: rules engine that emits LS++ programs.
- `packages/llm/`: prompt builders and response validation for the coach.
- `packages/run/`: GPS pipeline and guided workout step machine, pure
  TypeScript.
- `apps/web/`: React PWA with the desktop author shell and the phone logger
  shell sharing one theme.
- `apps/android/`: native Kotlin and Jetpack Compose phone app (Gradle
  project, `design` module for the tokens and components). In progress.
- `server/`: Deno server on 127.0.0.1:8500. Sync, auth, tile and elevation
  serving, and the LLM proxy.
- `deploy/`: systemd unit and Tailscale notes.
- `docs/`: LS++ (`ls-plus-plus.md`), the Rust core plan (`rust-core.md`),
  the Android plan (`android-native.md`), the accounts plan
  (`plan-accounts-logins.md`), the pending-decision queue
  (`decisions-pending.md`), decision records (`adr/`), and the research
  evidence (`research/`).
- `assets/fonts/`: the source font files. The web app serves copies from
  `apps/web/public/fonts/`.
- `mockups/`: hand-drawn review canvas. Not app code.

## Run it

Prereqs: Deno 2, Node 22 + npm. First install the JS deps:

```sh
npm --prefix apps/web install
```

```sh
deno task build    # typecheck + bundle the PWA into apps/web/dist
deno task test     # every package's tests
deno task dev      # server with watch on 127.0.0.1:8500, serves dist/
deno task serve    # server without watch
deno task build:android   # debug APK of apps/android; see docs/android-native.md 11
```

The server listens on 127.0.0.1:8500 and is published on the tailnet with:

```sh
tailscale serve --bg --https=8443 http://127.0.0.1:8500
```

See `deploy/tailscale-serve.md` for the full notes.

## License

AGPL-3.0 or later, see LICENSE. Liftoscript, the exercise seed, and the
built-in programs come from liftosaur (also AGPL-3.0), credited in NOTICE
along with the fonts, icons, and chart libraries.
