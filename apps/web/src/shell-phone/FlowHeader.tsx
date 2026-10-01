/* Header for the in-session screens (workout, rest, warm-up): zoom out to
 * all exercises, the session and its clock, Finish. */

import { SecondaryButton } from "../shared/ui.tsx";
import { ChevronLeft, LayoutGrid } from "../shared/icons.ts";

/** `back` swaps the zoom-out button for a way back, on the zoomed-out page
 * itself. */
export function FlowHeader(
  { session, clock, back }: { session: string; clock: string; back?: string },
) {
  return (
    <div className="flow-head">
      {back
        ? (
          <a className="icon-btn" href={back} aria-label="Back to the exercise">
            <ChevronLeft size={22} />
          </a>
        )
        : (
          <a
            className="icon-btn"
            href="#/phone/allex"
            aria-label="All exercises"
          >
            <LayoutGrid size={20} />
          </a>
        )}
      <div className="flow-title">
        <span className="group-label">{session}</span>
        <span className="figure ticking">{clock}</span>
      </div>
      <SecondaryButton small href="#/phone/complete">Finish</SecondaryButton>
    </div>
  );
}
