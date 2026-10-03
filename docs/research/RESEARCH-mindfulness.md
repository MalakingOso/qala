# Research brief: mindfulness at the start of a workout

Status: **brief, written 2026-10-02. Nothing in this file is a finding.** Section 6 lists what was located and skimmed.

Tags: same convention as the other reports.

## 1. The product question, stated plainly

The owner wants a recommendation, not an implementation: before a workout, point people at **Headspace** and at **Waking Up** (Sam Harris's app, wakingup.com, founded 2018) as the starting point. So the first job is the product's own boundary, and only the second job is research.

The boundary: Qala is a training log, a planner and an adaptive engine. It is not a meditation teacher and it should not try to become one. The evidence for mindfulness in sport (section 2) is thin and mostly about anxiety and performance surrogates, not about injury, not about adherence, and not about any of the things Qala's engine can measure. If Qala grows its own meditation content it will be inventing a curriculum it has no standing to invent. So the shape to build is a short, warm, specific recommendation with a one-tap link out, and nothing else.

That recommendation still needs to be *right*, which is what the rest of this brief is for: how long, how often, at which point in the session, and what to say about it.

## 2. What the evidence does and does not say

- Wang 2023 (PMC9915077), systematic review and meta-analysis of RCTs, reports that a mindfulness-acceptance-commitment approach improves athletic performance and reduces experiential avoidance. Si 2024 (Front Psychol, doi:10.3389/fpsyg.2024.1375608) is a meta-analysis of mindfulness training on athletes' performance. Xie 2025 is a recent review reporting mostly positive trends. Tierney's systematic review reports that the effects on performance are largely indirect, arriving through sport anxiety and flow.
- Read these four and state, precisely, what the pooled effect is on what. The likely honest summary: a small-to-moderate effect on self-reported anxiety and on performance surrogates, in programmes run over weeks, in people who already practise. That is not nothing. It is also not a promise.
- What none of it support: that a short practice at the start of a workout prevents injury; that it replaces sleep; that it makes an amateur faster. Any app copy that implies those is making a claim the literature does not carry, and the copy needs to survive a reader who goes looking.
- Dose: almost all of the intervention literature is daily practice over 4 to 8 weeks, not a 3-minute sit before one session. The thing Qala is proposing sits at the edge of the evidence, and the honest framing is that it is a low-stakes habit borrowed from a well-studied practice, not a dosed intervention. Both meditation apps are built around the daily version, which is also the version that has evidence.
- Breath work is a separate literature from mindfulness practice (physiological sighs, slow-paced breathing, respiratory sinus arrhythmia, vagal tone) and it is the part most likely to have an acute, in-session effect. It is also the part Qala could plausibly do in-app without becoming a meditation app. Read it on its own terms rather than borrowing mindfulness conclusions for it.

## 3. Where in the session

The Today rail already has stages (`docs/CONTEXT.md`): check-in, warm-up, lift, recover, run, wind down. Two placements are candidates, and they are not the same decision:

- **Before the warm-up.** The session has not started, the athlete is not yet physically loaded, and this is where an app can hold attention for a few minutes without eating warm-up time (the warm-up has a time budget T in `docs/PLAN.md` 6.7 and cutting it is bad).
- **The wind-down stage.** The rail already has one, and it is the honest home for a habit that is about the whole day rather than about the set about to be lifted.

Recommendation to bring to the owner: keep the rail as it is, put the recommendation on the pre-workout screen as an optional line, and let the wind-down stage be the durable home. A new rail stage for an optional habit would be a stage most days is empty.

## 4. What the app says

Constraints that come from the decisions already made:

- No diagnosing (section 6.3 flags are rule-based and never diagnostic). Same rule for this.
- The Coach is bounded to fitness, training, health and recovery and declines the rest (U8). Meditation questions sit inside that envelope, so the Coach may answer them; it must not become the place the curriculum lives.
- No affiliate links and no referral codes without the owner deciding to (queued in `docs/decisions-pending.md`). Recommending a paid app is exactly the place where that matters.
- The apps are third parties with their own content, including a large non-dual curriculum in Waking Up. Qala should describe what each one is in one sentence and let the user choose, including choosing neither.

## 5. The open questions

- One-tap to the app, or a deep link to a specific track? Both apps expose deep links, and a deep link to a beginner sitting is more useful than a deep link to their home screen. Check what each app actually supports on Android and what the app store policy is about launching another app for this.
- What is the fallback when the user does not want or cannot install an app? A 60-second breathing routine in-app is the minimum that keeps the promise without pretending to be the curriculum. Decide whether Qala ships it; it is a small, self-contained feature that needs no research beyond section 2's breath-work read.
- Does the reminder respect the same rules as the rest of the app? `settings.dailyWellness` is off by default and the app has no push service to speak of; a mindfulness nudge that needs notification infrastructure is a bigger build than it looks.
- Nothing here should touch `readiness`, `prs` or any engine input. Say that in the plan so a future agent does not wire it in.

## 6. Sources located on 2026-10-02 (skimmed, not read in full)

| Source | What it gives | Status |
|---|---|---|
| Wang 2023, PMC9915077 | Systematic review and meta-analysis of RCTs: mindfulness-acceptance-commitment improves athletic performance, reduces experiential avoidance | abstract and figures located |
| Si 2024, Front Psychol, doi:10.3389/fpsyg.2024.1375608 | Meta-analysis of mindfulness training on athletes' performance | abstract located |
| Xie 2025, S1728869X2500053 | Recent review of mindfulness-based interventions in sport, positive trends across performance, mindfulness and mental-health outcomes | abstract located |
| Tierney, systematic review (UKnowledge copy) | Effects on performance are largely indirect, via sport anxiety and flow | secondary copy of an unpublished or grey-literature review; find the primary |
| wakingup.com, about page | Waking Up is Sam Harris's non-dual meditation app, founded 2018, 600+ hours from dozens of teachers, daily lesson format | first-party page |
| Headspace, app listing | Meditation and sleep app; the everyday, non-religious framing that matches Waking Up's secular tone | app listing only |

## 7. What has to come out of this brief

1. A sourced statement of what mindfulness practice does for athletes, in three sentences the app can print and a podcast script can say, with the limits stated in the same breath.
2. The acute breath-work read, separated from practice over weeks.
3. A recommendation for or against an in-app breathing fallback.
4. The copy for both apps, and what Qala says when the user wants neither.
5. A list of claims the copy must not make.

## 8. Consumers

`docs/PLAN.md` 16e; the Today stages (`docs/CONTEXT.md`); the Coach envelope (section 11); `docs/podcast/scripts/` for the episode on starting a session.