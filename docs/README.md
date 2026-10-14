# Docs

Start at `ROADMAP.md`: where each track stands and what it waits on. Every plan doc opens with a status line (done, in progress, planned, superseded or historical) and a date. When a plan and `DECISIONS.md` disagree, `DECISIONS.md` wins.

## Roadmap and decisions

| File | Status | What it is |
|---|---|---|
| `ROADMAP.md` | living | Done, in flight, next and blocked, by track. |
| `DECISIONS.md` | living | The owner's decision log. Rows are added, never renumbered. |
| `decisions-pending.md` | living | The queue of open choices (D01 to D35) and the protocol for deciding them. |
| `adr/` | 0001 accepted, 0002 partly decided and not built, 0003 accepted in part | Decision records. |
| `CONTEXT.md` | living | The glossary. |

## Plans

| File | Status | What it is |
|---|---|---|
| `PLAN.md` | partly superseded | The 2026-09-13 build plan. Sections 6, 12, 14 and 16a to 16f are still the reference. |
| `DESIGN.md` | living, web | The design system and screen spec. The native app departs from it (see its status line). |
| `android-native.md` | in progress | The native Android app: platform, modules, run recorder, data layer, phases A0 to A7. |
| `rust-core.md` | in progress | The Rust core: architecture, sync, porting order, spike report, open questions. |
| `ls-plus-plus.md` | built, with leftovers | The LS++ language, its extensions, the import pipeline. |
| `plan-accounts-logins.md` | planned, not started | Friends-and-family accounts without Tailscale. |
| `PLAN-bun-migration.md` | decided, not started | Deno to Bun, and the later Elixir model gateway. |

## Finished work, kept in place

Code comments and DECISIONS rows cite these by path, so they haven't moved.

| File | Status | What it is |
|---|---|---|
| `PLAN-rail-refresh.md` | done | The native phone refresh, M1 to M4. |
| `PLAN-m1-rust-core.md` | done | Detail for M1: `qala-core`, `qala-ffi`, goldens. |
| `PLAN-m2-room-data.md` | done | Detail for M2: the Room data module. |
| `HANDOFF-rail-refresh.md` | historical | The design handoff the refresh was built from. |
| `desktop-look-update-notes.md` | historical, with open questions | Notes on the refined desktop look. Its seven questions are open. |

## Evidence and writing

| Folder | Status | What it is |
|---|---|---|
| `research/` | reports and briefs | `RESEARCH-*.md`. The reports are findings. The briefs (beginner lifting, body composition, mindfulness, run plans) say at the top that nothing in them is a finding yet. |
| `blog/` | no drafts | The owner's blog: format, voice rules, template. |
| `podcast/` | one script, no audio | Beginner podcast scripts. Audio isn't in git. |

## Archive

`archive/` holds finished handoffs and spikes: `handoff-intro-dust.md` (done), `mockups-m4-options.md` (historical) and `spike-qcore/` (a throwaway Rust spike, superseded by `crates/qala-core`). Nothing in the code cites them.
