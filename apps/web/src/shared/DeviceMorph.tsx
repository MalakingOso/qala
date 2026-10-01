/* Landing hero: one device frame that morphs phone, laptop, desktop, then
 * lets go to leave just the app. Pure CSS keyframes (see .dm-* in index.css),
 * so it costs no JS and stops under prefers-reduced-motion. The frame is
 * decorative; the label says what it shows. */

const DAYS = [62, 78, 0, 90, 55, 0, 40];

export function DeviceMorph() {
  return (
    <figure
      className="dm"
      role="img"
      aria-label="Qala on a phone, a laptop and a desktop"
    >
      <div className="dm-stage" aria-hidden="true">
        <div className="dm-base" />
        <div className="dm-stand" />
        <div className="dm-frame">
          <span className="dm-pill" />
        </div>
        <div className="dm-content">
          <span className="dm-eyebrow">Lower A</span>
          <span className="dm-figure title">
            245<small>lb</small> × 4
          </span>
          <span className="dm-note">Squat holds today.</span>
          <span className="dm-bars">
            {DAYS.map((h, i) => (
              <i
                key={i}
                className={i === 3 ? "today" : h === 0 ? "rest" : undefined}
                style={{ height: `${h || 8}%` }}
              />
            ))}
          </span>
        </div>
      </div>
      <figcaption className="dm-caption" aria-hidden="true">
        <span>Phone</span>
        <span>Laptop</span>
        <span>Desktop</span>
        <span>One plan, everywhere</span>
      </figcaption>
    </figure>
  );
}
