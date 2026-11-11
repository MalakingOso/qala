# Docs

Start at `ROADMAP.md`. It says where each track stands and what it waits on. This index is the whole folder on one page: ten living files at the top level, three decision records, one completed-work summary, and the research, blog and podcast folders.

When files disagree, `DECISIONS.md` wins. Every living file opens with a status line and a date.

## Living files

| File | What it is |
|---|---|
| `ROADMAP.md` | Done, in flight, next and blocked, by track. It also holds the Tooling plans: Deno to Bun (decided, not started) and the later Elixir model gateway. |
| `DECISIONS.md` | The owner's decision log. Rows are added, never renumbered. |
| `decisions-pending.md` | The queue of open choices (D12 to D40) and the protocol for deciding them. |
| `CONTEXT.md` | The glossary. |
| `DESIGN.md` | The design system and screen spec, for the web. The native app departs from it; see `android-native.md` and `archive/completed.md`. |
| `PLAN.md` | The 2026-09-13 build plan, trimmed. Sections 6 (engine), 12 (generator), 14 (gates) and 16a to 16f are still the reference; superseded sections are pointers that keep their numbers so citations still land. |
| `android-native.md` | The native Android app: platform, modules, run recorder, data layer, phases A0 to A7. |
| `rust-core.md` | The Rust core: architecture, sync, porting order, golden vectors, and in section 12 the LS++ language, its import pipeline and engine bindings. |
| `plan-accounts-logins.md` | Friends-and-family accounts without Tailscale. Planned, not started. |

## Decision records

`adr/` holds three records: 0001 Coach open chat (accepted), 0002 friends-and-family auth (partly decided, not built), 0003 load zoom rework (accepted in part).

## Finished work

`archive/completed.md` is the one-page record of everything that shipped and the files that were removed to make room: the native refresh M1 to M4 and its detail plans, the desktop look update, the landing intro, the M4 mockups and the Rust spike. Code comments that cited those plans now point there.

## Evidence and writing

| Folder | What it is |
|---|---|
| `research/` | Five evidence reports (`RESEARCH-*.md`, findings with tagged sources) plus `BRIEFS.md`, four briefs in one file where nothing is a finding yet. `research/README.md` indexes them. |
| `blog/` | The owner's blog: format, voice rules, template. No drafts yet. |
| `podcast/` | Beginner podcast scripts. One script, no audio. Audio is never in git. |
