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
      "You never have to guess how to warm up. Easy cardio with its own " +
      "countdown, mobility picked for what is sore and what equipment you " +
      "own, and ramp-up sets built right into the workout.",
  },
  {
    tag: "The app",
    title: "One clear step at a time",
    body:
      "No dashboards full of sliders before your first set. Check in, warm " +
      "up, lift, rest, run: one primary action per screen on the phone, " +
      "readable mid-set with sweaty hands, backed by a full desktop " +
      "workspace whenever you want the bigger view.",
  },
  {
    tag: "Over months",
    title: "An app that grows with you",
    body:
      "Start as a beginner with a proven plan and one screen at a time. As " +
      "the months add up, the same engine tracks your strength trends, " +
      "adapts to your recovery, and opens up a full program editor when " +
      "you are ready to customize. You never have to graduate to another " +
      "app.",
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
          You don't need to know how to write a program or read a wall of
          charts to train well. Qala handles the load math quietly in the
          background and keeps the plan honest when life gets in the way.
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
