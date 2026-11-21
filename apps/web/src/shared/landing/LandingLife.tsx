/* The "made for real life" section. Six short cards that say what Qala
 * does day to day, in the same voice as the literature cards below it:
 * plain titles, one short paragraph each, no icons. The last card is the
 * MCP work, marked as roadmap because it is not built; it must not read
 * as something the app does today. */

interface Pillar {
  tag: string;
  title: string;
  body: string;
}

const PILLARS: Pillar[] = [
  {
    tag: "Time away",
    title: "Vacation without losing the thread",
    body:
      "Switching off for a trip is a first class status, not a miss. On " +
      "vacation or sick the plan shifts out. On a break or a day that " +
      "does not fit, it rests in place. Today says which, and coming back " +
      "is a return, not a rebuild.",
  },
  {
    tag: "Every session",
    title: "Lifting and running on one plan",
    body:
      "A run is load on the same readiness score as a squat day. Distance, " +
      "pace and GPS feed the same fatigue model, so a hard long run is " +
      "felt at the bar, and the plan says why.",
  },
  {
    tag: "Warm-up",
    title: "Warm-ups that are part of the plan",
    body:
      "Easy cardio with its own countdown, then soft tissue and mobility " +
      "chosen from what is sore and what equipment you own. Ramp sets " +
      "live in the workout, where you load them.",
  },
  {
    tag: "The app",
    title: "A smooth, modern place to train",
    body:
      "The native phone app and the desktop workspace share one engine. " +
      "Check in, warm up, lift, rest, run: one primary action per screen, " +
      "readable mid set, with sweaty hands.",
  },
  {
    tag: "Over months",
    title: "An app that grows with you",
    body:
      "Each block fixes a reference 1RM to judge intensity against, and " +
      "the engine tracks your e1RM and readiness against your own rolling " +
      "baseline. Progression meets the lifter you are this month, not " +
      "last season.",
  },
  {
    tag: "Roadmap",
    title: "Your coach, your model",
    body:
      "Today the Coach runs local on your hardware and can only nudge " +
      "inside the engine's clamped limits. On the roadmap, an MCP server " +
      "will expose the plan, logged sessions, readiness and fatigue to " +
      "the assistant you already use, with the same clamp on every " +
      "suggestion.",
  },
];

export function LandingLife() {
  return (
    <section
      className="landing-features life"
      aria-labelledby="life-title"
    >
      <div className="landing-section-head">
        <p className="group-label">Made for real life</p>
        <h2 className="title" id="life-title">
          Train through the weeks, not just the session.
        </h2>
        <p className="life-lede">
          Fitness fatigue, e1RM and morning readiness move together, so a
          hard day in one place is priced into the next in the other. The
          same engine underneath keeps the count honest when life gets in
          the way.
        </p>
      </div>
      <div className="life-cards">
        {PILLARS.map((p) => (
          <article className="life-card" key={p.title}>
            <span className="life-tag">{p.tag}</span>
            <h4 className="title">{p.title}</h4>
            <p>{p.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
