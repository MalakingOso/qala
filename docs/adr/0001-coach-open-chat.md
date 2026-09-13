# Coach conversation is open-ended; actions stay clamped

Status: accepted, 2026-09-13.

Every other surface in Qala is deterministic and bounded: the engine only recommends inside evidence-based rules, and Gemma's numeric suggestions are clamped to a fixed envelope (weight -10% to +2.5%, sets -2 to +1; DECISIONS P3). The Coach tab's conversation is the one exception: it's open-ended within fitness/training/health/recovery topics, not fenced to the seven features PLAN.md section 11 originally enumerated, and it declines requests outside that persona. We decided the envelope already prevents runaway *actions*, so gating the *conversation* too wasn't worth the UX cost of a coach that keeps saying "I can't discuss that."

**Considered options:** bounded to reason codes only, so every answer traces to an existing engine output (matches PLAN 11's original seven features, but reads as stiff for something styled as a coach); open questions with bounded actions, a middle ground gating only what it can act on. The owner picked fully open conversation, in persona, actions still clamped.

**Consequence:** prompt and moderation work for Coach has to hold a persona boundary (fitness/training/health) rather than a strict feature fence; anything it proposes as an action must still resolve to the PLAN 11 feature list and pass through the P3 envelope like every other Gemma output.
