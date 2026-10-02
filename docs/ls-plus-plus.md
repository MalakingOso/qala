# LS++ (Liftoscript++)

Status 2026-10-02: the name is decided (owner, S18). The port and the S21 extensions are built in `crates/qala-lspp` and merged; the import pipeline (S19) has its TS half merged, with the MinerU and voice wiring still open. Decision rows are DECISIONS S18 to S21.

LS++ is the Rust port in `crates/qala-lspp`: liftosaur's liftoscript plus additive extensions. Programs are still plain text. The vendored TS package stays as the oracle (S17), so every extension has to leave the 60 built-in programs evaluating exactly as before.

## 1. What already works

Checked against the TS oracle on 2026-10-01. A set with no weight is valid, and the language already has a way to say "ask for the weight":

```
Split Squat / 3x8 ?+          -> askWeight: true, no weight
Split Squat / 3x8 0lb+        -> askWeight: true, weight 0 lb
Split Squat / 3x8             -> no weight, askWeight: false
```

The built-in `lp` script already treats `weights[i] == 0` with a nonzero completed weight as an initial weight and builds on it. So "I left the weight blank, I'll set it on my first workout" needs no language change. The importers emit `?+`, the workout screen shows an empty required weight field, and the entered value becomes the starting weight.

## 2. Language improvements (S21)

All additive, all built and merged (`32cb81c`).

1. **Error messages with positions.** Every error carries a line, column, span and a one-line fix suggestion. Note the TS evaluator returns `errors[]` (type `parse` or `unknownExercise`) rather than throwing, and its error lines are relative to the day block; pick one convention and document it. The TS evaluator also accepts `99999x8`, only Rust caps sets, so importers bound every number themselves. The import repair loop (section 4) depends on this.
2. **`fmt`.** One canonical text form. Blank lines are meaningful to the evaluator, so fmt never adds, removes or merges them. `program_to_planner` already exists, so this is mostly a front end plus a round-trip test: `fmt(fmt(x)) == fmt(x)` and `evaluate(fmt(x)) == evaluate(x)` over the 60 built-ins.
3. **Lint.** Warnings for things that parse but are probably wrong: `too-many-sets` (over `MAX_SETS`), `unused-state` (declared but never mentioned; an assignment counts as use), `empty-program`, `mixed-units`. The built-ins ruled out the first draft: header-only days are rest days, whole empty weeks occur via `Bench[1-3]`, and the kg variants write lb weights.
4. **Dry run.** "What does week 2 look like if I hit every rep" using the Rust evaluator (compiled to wasm in the desktop shell). Read-only, no history written.
5. **Partial prescriptions as a first-class idea.** `?+` stays the syntax. The editor and the importers treat "weight unknown" as a state to resolve, not an error, and the dry run shows it as a blank. `unresolved_sets` lists the sets still waiting for a weight.

## 3. Name and rename scope (S18)

Display name: Liftoscript++, short form LS++. File extension `.lspp`. Rust crates and the wasm and Kotlin namespaces use `ls_pp` or `lspp`, since `+` is not allowed in identifiers. Done: the four crates are renamed (`415fb07`), and READMEs and docs call the language LS++. Still open: `deno task gen:liftoscript` and the `testdata/golden/liftoscript/` directory keep their old names. Never touched: `packages/liftoscript` (the oracle keeps liftosaur's names), NOTICE, and the liftosaur credit in the footer. Liftosaur programs stay importable. Programs that use LS++ extensions will not export back to liftosaur.

## 4. Import: PDF and voice (S19)

One pipeline, two front ends. A small model never writes program text.

```
PDF  -> MinerU (layout, tables, scans) -> markdown chunks \
                                                            -> callisto agent, json_schema -> edit list
voice -> Gemma 4 E4B audio -> transcript                    /
edit list -> exercise matching (fuzzy, confirm ambiguous) -> emitter (LS++ text) -> parser + lint
          -> diff shown to the owner -> confirm -> applied
```

Merged (`8f5bd5c`): the edit-list schema, matcher and emitter in `packages/llm`, and `POST /api/import/text` in `server/import.ts` (the confirm step is the same endpoint with `resolutions`). Open: MinerU wiring for PDFs, and `POST /api/transcribe` for voice.

- The edit list is the schema: day or week, exercise name, sets, reps, optional weight, RPE, rest, notes. A missing weight becomes `?+`.
- The model sees chunks, not the whole PDF. The callisto context is 8192 tokens, so chunk per day or per week and merge the edit lists in code.
- Validation failures go back to the model once with the parser's error messages, then to manual entry. Same degrade rule as every other LLM feature: a down or slow backend never blocks the user.
- "Split squat" is ambiguous (Bulgarian or not). The matcher asks.
- PDFs come from anyone, so treat their text as untrusted. The model only fills a fixed schema, nothing it returns is executed, and the owner confirms a diff before anything is written. Cap file size and page count, run MinerU unprivileged, and never put PDF text in a system prompt.
- MinerU runs on Sonoro (vLLM wheel on the B60). If it is down, fall back to `pdftotext -layout` for born-digital PDFs and say so; scans fail with a clear message.

## 5. Models (S20)

| Job | Pick | Why | Alternatives |
|---|---|---|---|
| PDF to text and tables | MinerU (Sonoro) | One path for text PDFs, tables and scans; already served | `pdftotext` as the degraded path; Gemma 4 E4B vision for a photo of a page |
| Speech to text | Gemma 4 E4B with its mmproj (standalone llama-server, :8083) | One model covers dictation, page photos and edit-list extraction. Got every number right on the gym-phrase test with no biasing, at about 0.85 s per clip. 30 s audio cap, which suits dictation | whisper.cpp large-v3-turbo as the fallback (faster, adds punctuation, but needs an initial prompt of example weights to stop reading "three fifteen" as "3:15"); Voxtral Mini 4B Realtime (Apache 2.0, needs vLLM, which callisto has) |
| Edit list extraction | Gemma 4 E4B on callisto, json_schema | Already the Qala agent | none needed |

Voxtral: Beamer's `voxtral_test.rs` uses Mistral's hosted API, which sends audio off the machine. Only the open-weight Voxtral Mini 4B Realtime would be self-hosted. E4B first; try Voxtral only if live captions while speaking matter.

Gemma 4 E4B accepts image and audio through its mmproj file in llama-server, but the callisto router loads the model without it, and Beamer's router ini is not ours to edit, so the mmproj build runs as its own llama-server on the B60 at :8083 (alias `gemma-4-E4B-mm`, mmproj in `~/models/beamer-mm/`, launched with the oneAPI 2026 environment). One model covers short dictation and page photos, which is the reason it wins ties.

Benchmark (2026-10-01): 10 gym phrases in two Kokoro voices, 20 clips, clean synthetic audio. A clip counts as right only if every number in it is right. E4B 20/20 with a plain "transcribe verbatim, numbers as digits" instruction, about 0.85 s median. whisper.cpp 15/20 with no prompt (spoken weights came out as "3:15", "1:35", "1.55"; it also heard "wait" for "weight"), 20/20 once given an initial prompt of example weights, about 0.4 s median. whisper adds punctuation, E4B does not. Not yet tested: the owner's own voice and gym noise. Recheck on real clips before relying on either. whisper.cpp stays available on :8082 (`scripts/whisper-serve.sh`, B570) as the fallback.

## 6. Build order

1. Rename the crates to LS++ and keep every golden suite green. Done, merged (`415fb07`).
2. Parser error positions, then `fmt`, then lint, then dry run, then `unresolved_sets`. Done in Rust and merged (`32cb81c`). Open: FFI exports of the six new functions plus Kotlin regen (wasm already exports them; `qala-lspp-ffi` has only the nine evaluation calls), suggestions for evaluation-time errors, fmt for standalone scripts, and a post-rename wasm build (`target/wasm-out/` still has the pre-rename filenames).
3. Edit-list schema, emitter and validator in `packages/llm`, tested without any model. Done and merged (`8f5bd5c`).
4. `POST /api/import/text` against the agent (merged; the confirm step is the same endpoint with `resolutions`), then wire PDF via MinerU (open).
5. `POST /api/transcribe` against E4B-mm (base64 `input_audio` to `/v1/chat/completions`, wav in, fall back to whisper.cpp when it is down); mic capture on the phone and desktop shells.

Run Rust tests only through `scripts/cargo-test-safe.sh`.

## 7. Engine bindings (PLAN section 5)

Added to `VScriptBindings` (`src/liftoscriptFns.ts`) as plain numbers, so the evaluator's type system is untouched. A program can read them like any other binding, for example:

```liftoscript
// Back off when the lifter is sore or the engine calls a deload.
if (soreness >= 3 || deload > 0) {
  weights = weights * 0.9
}
```

| Binding | Range | Neutral default | Meaning |
|---|---|---|---|
| `readiness` | 0-1 | 1 | Derived session readiness from the check-in (PRS z-score, soreness grid, normalised fatigue). |
| `prs` | 0-10 | 0 | Perceived Recovery Status tap at session start. |
| `soreness` | 1-4 | 1 | Max RP soreness score over the exercise's target muscles (1 never sore, 2 healed well before, 3 healed just in time, 4 still sore now). |
| `fatigueLocal` | 0-1 | 0 | Normalised per-muscle fatigue for the exercise's prime movers. |
| `deload` | 0, 1, 2 | 0 | 0 none, 1 per-muscle reactive deload, 2 systemic deload. |
| `recWeightPct` | -10 to 2.5 | 0 | Engine's recommended weight change in percent (same envelope Gemma may use). |
| `recSets` | -2 to 1 | 0 | Engine's recommended set-count change. |

Semantics preserved from liftosaur: `progress: custom(state...) {~ ~}` runs once after the workout per exercise and may write `weights[...]`, `reps`, `RPE`, `timers`, `numberOfSets`, `rm1`, `setVariationIndex`, `exerciseVariationIndex`, `descriptionIndex` and `state.*`; `update: custom() {~ ~}` runs at `setIndex == 0` and after every set and writes only the current entry. Built-in progressions `lp(...)`, `dp(...)`, `sum(...)` are unchanged (see `PlannerProgramExercise_buildDpRangeScript` and the `sets` script function).

Wiring in the TS oracle (the Rust port mirrors the bindings; `create_engine_bindings` and friends are exported through `qala-lspp-json`):

- `createEngineBindings(input)` (`src/runtime.ts`) builds clamped engine bindings; absent inputs fall back to the neutral defaults above.
- `createScriptBindings(..., engine?)` and `applyEngineBindings` merge them into the script bindings before a run.
- `Progress_defaultEngineBindings()` (`src/models/progress.ts`) is the single source of the neutral defaults, also used by `Progress_createEmptyScriptBindings`, so scripts that read an engine binding without the engine attached see neutral values rather than `unknownVariable` errors.
- `runFinishDayScript` accepts `{ engine }` and `runAllFinishDayScripts` accepts `engineFor(entry)`, so per-exercise engine state (e.g. soreness over that exercise's targets) flows into progress scripts.
- `LiftoscriptFns_bindingStaticType` reports the new bindings as `number`.

TS oracle notes (not language changes):

- `src/parser.ts`: `rollbar` and `utils/dialog` imports stubbed to console output, `micro-memoize` replaced by `src/utils/memoize.ts`.
- `src/models/program.ts` and the script subset in `src/models/progress.ts` are headless ports of the pure evaluation and script helpers; finish-day entry points live in `src/runtime.ts` against `@qala/core` document types.
- App-shell custom-exercise mutators needing the redux store were omitted from `src/models/exercise.ts`; the exercise DB, metadata and all pure helpers are unchanged. `exerciseDescriptions.ts` (862 KB prose) is skipped.
- Lezer grammars ship with liftosaur's prebuilt generated parsers (`src/liftoscript.ts`, `src/pages/planner/plannerExerciseParser.ts`), loaded through the `npm:@lezer/*` specifiers in `deno.json`; no codegen step is needed and no hand-ported parser was required.
