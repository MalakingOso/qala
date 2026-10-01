/* Front or back body map (liftosaur's drawing) with each screen muscle
 * shaded by soreness: the deeper the ember, the sorer; muscles without a
 * reading stay neutral gray. Hover or long-press a muscle for its name. */

import {
  BACK_BODY,
  BODY_VIEWBOX,
  type BodyNode,
  FRONT_BODY,
} from "./muscleMapData.ts";

export type ScreenMuscle =
  | "abs"
  | "back"
  | "biceps"
  | "calves"
  | "chest"
  | "forearms"
  | "glutes"
  | "hamstrings"
  | "quadriceps"
  | "shoulders"
  | "triceps";

/** Soreness 1-4 as ember strength; 0 means no reading. */
const LEVEL_OPACITY = [0, 0.2, 0.45, 0.75, 1];
export const SORENESS_WORDS = ["", "fresh", "a little", "sore", "still sore"];

const NAMES: Record<string, string> = {
  abs: "abs",
  back: "back",
  biceps: "biceps",
  calves: "calves",
  chest: "chest",
  forearms: "forearms",
  glutes: "glutes",
  hamstrings: "hamstrings",
  quadriceps: "quads",
  shoulders: "shoulders",
  triceps: "triceps",
};

function Nodes(
  { nodes, levels }: {
    nodes: BodyNode[];
    levels: Partial<Record<ScreenMuscle, number>>;
  },
) {
  return (
    <>
      {nodes.map((n, i) => {
        if (typeof n === "string") return <path key={i} d={n} />;
        if (n.m === "contour") {
          return (
            <g key={i} transform={n.t} className="body-contour">
              <Nodes nodes={n.kids} levels={levels} />
            </g>
          );
        }
        if (n.m) {
          const level = levels[n.m as ScreenMuscle] ?? 0;
          return (
            <g
              key={i}
              transform={n.t}
              className={level ? "body-muscle sore" : "body-muscle"}
              style={level ? { opacity: LEVEL_OPACITY[level] } : undefined}
            >
              <title>
                {`${NAMES[n.m] ?? n.m}${
                  level ? `: ${SORENESS_WORDS[level]}` : ""
                }`}
              </title>
              <Nodes nodes={n.kids} levels={levels} />
            </g>
          );
        }
        return (
          <g key={i} transform={n.t}>
            <Nodes nodes={n.kids} levels={levels} />
          </g>
        );
      })}
    </>
  );
}

export function BodyMap(
  { side, levels }: {
    side: "front" | "back";
    levels: Partial<Record<ScreenMuscle, number>>;
  },
) {
  const sore = Object.entries(levels)
    .filter(([, v]) => (v ?? 0) > 0)
    .map(([m, v]) => `${NAMES[m] ?? m} ${SORENESS_WORDS[v ?? 0]}`)
    .join(", ");
  return (
    <svg
      viewBox={BODY_VIEWBOX}
      className="body-map"
      role="img"
      aria-label={`Body, ${side}. ${sore}`}
    >
      <g fillRule="evenodd">
        <Nodes
          nodes={side === "front" ? FRONT_BODY : BACK_BODY}
          levels={levels}
        />
      </g>
    </svg>
  );
}

export default BodyMap;
