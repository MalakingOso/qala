# Qala

Qala is a self-hosted app for lifting and running. Programs are written as
liftoscript text, an adaptive engine adjusts the plan from check-ins and
logged sessions, and a local coach model explains the numbers. Runs are
recorded in the same app and feed the same fatigue model as lifting.

## Status

Working v1 build. The plan is in PLAN.md, the design system in DESIGN.md, and
the decision log in DECISIONS.md. `deno task test` runs 219 tests green;
`deno task build` typechecks and bundles the PWA; `deno task serve` runs the
server against the built PWA. Device gates (background GPS recording, APK on
the Nothing Phone, TTS ducking) still need the real phone (PLAN.md 14).

## Layout

- `packages/liftoscript/`: liftoscript grammars and evaluator, vendored from
  liftosaur with the same file names so upstream diffs stay readable.
- `packages/core/`: data model, document schema, exercise seed and overlay,
  units and rounding.
- `packages/engine/`: adaptive training engine, pure TypeScript.
- `packages/generator/`: rules engine that emits liftoscript programs.
- `packages/llm/`: prompt builders and response validation for the coach.
- `packages/run/`: GPS pipeline and guided workout step machine, pure
  TypeScript.
- `apps/web/`: React PWA with the desktop author shell and the phone logger
  shell sharing one theme.
- `apps/phone/`: Capacitor wrapper around the phone shell for background GPS.
- `server/`: Deno server on 127.0.0.1:8500. Sync, auth, tile and elevation
  serving, and the LLM proxy.
- `deploy/`: systemd unit and Tailscale notes.
- `docs/`: engine math and liftoscript extension docs.
- `assets/fonts/`: the source font files. The web app serves copies from
  `apps/web/public/fonts/`.
- `mockups/`: hand-drawn review canvas. Not app code.

## Run it

Prereqs: Deno 2, Node 22 + npm. First install the JS deps:

```sh
npm --prefix apps/web install
npm --prefix apps/phone install   # only for the Capacitor wrapper
```

```sh
deno task build    # typecheck + bundle the PWA into apps/web/dist
deno task test     # every package's tests
deno task dev      # server with watch on 127.0.0.1:8500, serves dist/
deno task serve    # server without watch
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
