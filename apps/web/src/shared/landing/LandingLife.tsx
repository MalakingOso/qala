/* The "day to day" section. Six short cards that say what Qala does in an
 * ordinary week, in the same voice as the literature cards below it: plain
 * titles, one short paragraph each, no icons. The last card is the MCP work,
 * marked as roadmap because it is not built; it must not read as something
 * the app does today. */

interface Pillar {
  tag: string;
  title: string;
  body: string;
}

const PILLARS: Pillar[] = [
  {
    tag: "Time away",
    title: "Time off without breaking the plan",
    body:
      "Mark a day or a stretch as vacation, sick, a break, a scheduling " +
      "conflict or an injury. Vacation and sick push the plan forward. A " +
      "break or a conflict rests in place. An injury names the muscle and " +
      "carries into your check-ins as sore. None of them count as a miss.",
  },
  {
    tag: "Every session",
    title: "Lifting and running in one fatigue model",
    body:
      "Recorded runs add to the same systemic and leg fatigue as your " +
      "lifts. Session effort carries into readiness, so a hard long run can " +
      "lower tomorrow's score and lengthen your rests, and the app shows " +
      "why.",
  },
  {
    tag: "Warm-up",
    title: "Warm-ups generated for the session",
    body:
      "Each lifting day opens with a short cardio countdown, soft-tissue " +
      "and dynamic mobility drills chosen from your soreness check-in and " +
      "the gear you own, and ramp-up sets leading to your working weight.",
  },
  {
    tag: "The app",
    title: "One action per screen on the phone",
    body:
      "The Android app walks through check-in, warm-up, sets, rest and runs " +
      "with one primary action on each screen and large numbers you can " +
      "read between sets. On desktop, the web workspace holds the LS++ " +
      "editor, program import and block-level charts.",
  },
  {
    tag: "Over months",
    title: "From built-in plans to your own LS++",
    body:
      "Start with a built-in program, GZCLP or the Texas Method, and enter " +
      "your starting weights. Over a few weeks the Kalman filter tracks " +
      "each lift's estimated 1RM and your check-in baseline adjusts to " +
      "your own history. To write or import a custom program, use the LS++ " +
      "editor on desktop. Sending it to the phone is not built yet.",
  },
  {
    tag: "Roadmap",
    title: "MCP access for your own model",
    body:
      "Right now Coach runs locally on your hardware and stays inside the " +
      "engine's limits (weight −10% to +2.5%, sets −2 to +1). On the " +
      "roadmap, an MCP server will expose your plan, logged sessions, " +
      "readiness and fatigue to any MCP client or local model you use, " +
      "under the same limits.",
  },
];

export function LandingLife() {
  return (
    <section
      className="landing-features life"
      aria-labelledby="life-title"
    >
      <div className="landing-section-head">
        <p className="group-label">Day to day</p>
        <h2 className="title" id="life-title">
          Built for ordinary weeks.
        </h2>
        <p className="life-lede">
          The engine runs the fatigue math from your check-ins and logged
          sets, shifts the plan when you mark time off, and lets you open the
          charts only when you want them.
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
