# Pending decisions

The queue of choices the owner still has to make. It has been empty since 2026-11-13. `docs/DECISIONS.md` is the log of choices already made; this file is the queue. An item leaves the queue only through the session protocol below, which writes the answer into the source documents at the moment it is given, so the queue and the docs can never disagree.

`docs/ROADMAP.md` lists what each track waits on.

## How to run a session (agent instructions)

The owner goes through this file with an agent, one item at a time. The agent running the session follows this protocol exactly.

1. Start by reading this file and saying how many items are still open. Ask which item to take: the owner names one (`D07`) or says `next`, which means the first open item in file order.
2. Present the item: its question, the options, the default or recommendation, and what it blocks. Keep it short. Do not present more than one item at once.
3. The owner answers. A default is not a decision: if the owner says "go with the default" or "your call", that counts as an explicit answer and you record it as decided with that note. Silence, a skipped item, or an unrelated reply never decides anything.
4. The moment the owner answers, before presenting the next item, update every document in the item's Record in list:
   - In `docs/DECISIONS.md`, set the named row's status to decided with the date, and adjust the decision text if the owner overturned the default.
   - In the named spec sections, change the text to match the choice. If the owner overturned a "default in the plan", rewrite the plan text; do not leave the old default standing next to a contradicting log row.
   - In `docs/rust-core.md` appendix B, mark the named question settled or answered, same as the existing settled entries.
   - Here, remove the decided item from this file.
5. Read back the changed lines so the owner can check them, then ask for the next item.
   - Decide now, build later (owner, 2026-10-14): the session changes docs only. When a Record in names code, or the answer needs code work, add a line to "To implement" at the end of this file instead, and build the list after the session.
6. If an answer contradicts an earlier decided row, stop and say so before writing anything. The owner resolves the conflict first.
7. If a session turns up a new pending choice that has no item here, append it with the next free D number and the same fields, then carry on.
8. If the owner ends the session with items still open, say how many remain and which one is next.

Standing rule (D18, 2026-11-13): a row Claude writes in `docs/DECISIONS.md` counts as decided when written, and the owner overturns what they disagree with. On 2026-11-13 the owner also closed the build-ready items in one pass, with their defaults standing (D19, D20, D25, D33 to D35, D37, D38, D40). The queue is for open questions and real disputes.

## Open items

None. The last items were closed on 2026-11-13. Those with a default took it, except D39, whose default was not taken (see the S21 note). D21, D24, D26 and D29 had no usable default and D23 was the owner's own answer; all five are recorded in DECISIONS S33, S34 and the notes on L13, R8 and P8.

## To implement

Code work owed by decided items, built after the session (protocol step 5). An entry leaves when it's built.

- D37 (2026-11-13): make the generator emitter write `custom()` progress scripts for RPE-gated double progression and Helms percent autoregulation, in place of the `// progress:` comments.
- D22 (2026-11-13): rewrite `server/ws.ts` as a notify-only channel and build the per-field sync and blob tables, both in A3.
- D21 (2026-11-13): once the domain is registered, point A/AAAA for `app.<domain>` and the apex at the VPS, add the apex Caddy block that serves `assetlinks.json`, and set the RP ID to the registrable domain.
- D23 (2026-11-13): add the callisto reverse tunnel (a systemd unit on callisto running `ssh -N -R` to the VPS), point `LLM_GATEWAY_URL` and the transcribe and PDF settings at its VPS-local ports, and cap each user's LLM routes (one in flight, a per-minute limit).
- D24 (2026-11-13): render the straight barbell and the trap bar in Blender (`assets/3d/build_gear.py`), add a per-exercise bar to the catalog and plan, and offer both bars in the plate calculator picker.
- D32 (2026-11-13): port `RestPlan.kt` and `Warmup.kt` to `qala-core` (rest also gets the learning multiplier, rep drift and low-readiness adjustment), switch Kotlin to call it, delete the Kotlin copies.
- D38 (2026-11-13): import carries equipment from aliases and source words to a `, Barbell`-style suffix, and the import check notes any evaluated weight that differs from the stated one.
- D39 (2026-11-13): stop `packages/llm/importEmit.ts` writing `?+ @8`; write `?+` alone and carry the RPE in a note.

## Validations (not decisions; real-data gates)

These need the owner's data or device, not an opinion. They stay open until measured.

- V01 Route-matching thresholds (R5): about 80% overlap inside a 50 m corridor. Validate against real GPS drift and out-and-back routes, then confirm or retune in `docs/DECISIONS.md` R5 and `docs/PLAN.md` 16a.
- V02 Voice recheck (S20): E4B beat whisper on synthetic clips. Recheck both on the owner's real voice in gym noise before relying on either, then confirm in `docs/DECISIONS.md` S20 and `docs/rust-core.md` section 12 5.
