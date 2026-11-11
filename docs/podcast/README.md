# Podcast: beginner lifting

Short episodes for someone in their first six months of lifting, aimed at stopping the avoidable mistakes. Five to eight minutes each. Scripts are written in this repo; audio is produced on the owner's machine and is never committed.

Plan section: `docs/PLAN.md` 16f. Decision: `docs/DECISIONS.md` P7.

## Rules

1. **Sources before scripts.** Every claim in a script carries a marker like `[brief: BRIEFS.md brief 1, section 8]` on the sentence it supports. A marker that has not been resolved blocks recording.
2. **No invented numbers.** No rep ranges, gram targets, injury rates or timelines that do not trace to a sourced line in a brief. This is the same rule the plan follows everywhere else.
3. **Plain voice, spoken.** Short sentences. Numbers written as people say them ("about a gram and a half per kilo"). No em dashes, no agent fingerprints, no hedging stacks.
4. **No diagnosing.** The same line the app walks (PLAN 6.3): a flag is not a diagnosis, and a script is not medical advice.
5. **One idea per episode.** The episode title is the one idea.

## Episode list

| # | Title | The one idea | Brief |
|---|---|---|---|
| 1 | Doing too much too soon | Early weeks are about tolerable volume, not stimulus ranges | beginner-lifting |
| 2 | Avoiding injury | The guardrails: known movements, load you can control, and stopping when a joint says so | beginner-lifting |
| 3 | What to eat | Protein, enough food, and nothing exotic | beginner-lifting 8 |
| 4 | The scale is lying to you | DEXA and reference measures instead of weighing every morning | body-composition |
| 5 | Your first program | Why three full-body days beat anything clever | beginner-lifting 3 |
| 6 | Soreness is not damage | What soreness tells you and what it does not | beginner-lifting 7 |
| 7 | Starting to run from a walk | Intervals, rest days, and not skipping the boring part | run-plans 2 |
| 8 | Settling in before a session | Two minutes before you start; two apps worth trying | mindfulness 2 |

Episodes 1 to 4 are the ones the owner named on 2026-10-02.

## Format

Markdown, front matter with title, duration estimate and brief, then the script as a single run of paragraphs. Optional `[pause]` markers. Pronunciation hints in brackets where a term is hard to say (the glute bridge, the Valsalva). No headings inside the script: it is read aloud, not read on screen.

```markdown
---
title: Doing too much too soon
minutes: 7
brief: docs/research/BRIEFS.md (brief 1)
status: draft
---

Body text.
```

## Producing audio

The owner already runs TTS in other repos. Qala writes scripts and borrows one of those paths; it adds no TTS dependency.

- Kokoro via a sidecar. The pattern to copy is `Sonoro/sidecar/tts.py`: `KPipeline`, split the text into sentence chunks under about 450 characters, 24 kHz output, then ffmpeg to MP3.
- Or OpenArc-glimmer's OpenAI-compatible `/v1/audio/speech`, which serves Kokoro on the local device.
- Qwen3-TTS and Vibe Voice are also available if a voice is wanted that Kokoro does not have.

Pin the voice. Sonoro's bug worth not repeating: rotating the voice per request means re-rendering a script produces a different narrator, which quietly wastes every review pass.

## Scripts

- `scripts/01-doing-too-much.md`: draft. Blocked on sections 2, 4 and 7 of the beginner-lifting brief.