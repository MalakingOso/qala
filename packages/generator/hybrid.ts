// Hybrid scheduler (PLAN.md 12, spacing rules from the 6.4 table).
// Takes the lifting days and the run plan for the same week and places runs
// against lifting days. When the week cannot satisfy every constraint, the
// user's stated priority (lifting or running) wins and the violated rule is
// reported as a reason.

import type { DayPlan, RunPlanWeek, RunWorkout } from "./types.ts";

export type HybridPriority = "lifting" | "running";

export interface PlacedRun {
  dayOfWeek: number;
  liftLabel: string | null;
  lowerBody: boolean;
  heavyLower: boolean;
  workout: RunWorkout;
  gapHours: number | null; // run-after-lift gap when same day
  notes: string[];
}

export interface TradeReason {
  rule: string;
  why: string;
  winner: HybridPriority;
}

export interface HybridWeek {
  placements: PlacedRun[];
  traded: TradeReason[];
}

// Rule ids (each emits a ReasonCode-style reason, PLAN.md 6.4).
export const RULE_QUALITY_ON_LOWER = "QUALITY_ON_LOWER_DAY";
export const RULE_GAP_6H = "GAP_6H_LIFT_THEN_RUN";
export const RULE_GAP_24H_STRENGTH = "GAP_24H_WHEN_STRENGTH";
export const RULE_EASY_ON_UPPER_REST = "EASY_ON_UPPER_OR_REST";
export const RULE_NO_HARD_AFTER_HEAVY_LOWER =
  "NO_HARD_RUN_24H_AFTER_HEAVY_LOWER";
export const RULE_NO_HEAVY_LOWER_NEAR_RACE = "NO_HEAVY_LOWER_NEAR_LONG_RACE";

export interface HybridInput {
  liftDays: DayPlan[]; // in week order; mapped Mon..Sun across the week
  runWeek: RunPlanWeek;
  priority: HybridPriority;
  approach: "strength" | "hypertrophy" | "maintenance";
  raceKmThisWeek?: number; // longest race-effort run scheduled this week
}

export function scheduleHybrid(input: HybridInput): HybridWeek {
  const traded: TradeReason[] = [];
  const placements: PlacedRun[] = [];
  // Map lift days across Mon(1)..Sat(6); Sunday (0) is the long-run day.
  const liftByDow = new Map<number, DayPlan>();
  const dows = [1, 2, 3, 4, 5, 6];
  input.liftDays.forEach((d, i) => liftByDow.set(dows[i % dows.length], d));

  const heavyLowerDows = new Set<number>();
  for (const [dow, d] of liftByDow) if (d.heavyLower) heavyLowerDows.add(dow);

  for (const run of input.runWeek.days) {
    const lift = liftByDow.get(run.dayOfWeek) ?? null;
    const notes: string[] = [];
    if (run.workout.hard) {
      placeHardRun(
        run.dayOfWeek,
        lift,
        input,
        notes,
        traded,
        placements,
        run.workout,
      );
    } else {
      placeEasyRun(
        run.dayOfWeek,
        lift,
        input,
        notes,
        traded,
        placements,
        run.workout,
      );
    }
  }

  // No heavy lower body within 48 h of a half marathon or 5 d of a marathon.
  // This constrains the lifting days themselves, not just run placements, so
  // every heavy lower day in race week is reported and the priority wins.
  if (input.raceKmThisWeek !== undefined && input.raceKmThisWeek >= 21) {
    const window = input.raceKmThisWeek >= 42 ? "5 d" : "48 h";
    for (const lift of input.liftDays) {
      if (lift.heavyLower) {
        traded.push({
          rule: RULE_NO_HEAVY_LOWER_NEAR_RACE,
          why:
            `${lift.label} is heavy lower body within ${window} of a ${input.raceKmThisWeek} km race effort; priority wins`,
          winner: input.priority,
        });
      }
    }
  }
  return { placements, traded };
}

function placeHardRun(
  dow: number,
  lift: DayPlan | null,
  input: HybridInput,
  notes: string[],
  traded: TradeReason[],
  placements: PlacedRun[],
  workout: RunWorkout,
): void {
  // No hard run in the 24 h after a heavy lower-body day (check yesterday).
  const yesterday = (dow + 6) % 7;
  void yesterday;
  const heavyYesterday = [...heavyLowerDowSet(input)].some((h) =>
    (h + 1) % 7 === dow
  );
  if (heavyYesterday) {
    if (input.priority === "running") {
      traded.push({
        rule: RULE_NO_HARD_AFTER_HEAVY_LOWER,
        why:
          `hard run kept the day after heavy lower body; priority is running`,
        winner: "running",
      });
      notes.push(
        "hard run within 24 h of heavy lower body (traded: priority running)",
      );
    } else {
      notes.push(
        "hard run softened to easy: heavy lower body yesterday (priority lifting)",
      );
      placements.push({
        dayOfWeek: dow,
        liftLabel: lift?.label ?? null,
        lowerBody: lift?.lowerBody ?? false,
        heavyLower: lift?.heavyLower ?? false,
        workout: { ...workout, type: "easy", hard: false },
        gapHours: lift ? 6 : null,
        notes,
      });
      return;
    }
  }
  if (lift && lift.lowerBody) {
    if (input.approach === "strength" && input.priority === "lifting") {
      // 24 h apart when strength is the priority: run goes easy today, quality
      // work is expected to move; report the trade.
      traded.push({
        rule: RULE_GAP_24H_STRENGTH,
        why:
          `quality run on lower-body day ${lift.label}; strength priority wants 24 h separation`,
        winner: "lifting",
      });
      notes.push(
        "lift first, run at least 6 h after; 24 h separation preferred (strength)",
      );
    } else {
      notes.push(
        `intervals/tempo on lower-body day, run at least 6 h after lifting`,
      );
    }
    placements.push({
      dayOfWeek: dow,
      liftLabel: lift.label,
      lowerBody: true,
      heavyLower: lift.heavyLower,
      workout,
      gapHours: 6,
      notes,
    });
    return;
  }
  if (lift && !lift.lowerBody) {
    traded.push({
      rule: RULE_QUALITY_ON_LOWER,
      why:
        `no lower-body day free for quality work; placed on ${lift.label} with 6 h gap`,
      winner: input.priority,
    });
    notes.push("quality run on upper-body day (traded: no lower day free)");
    placements.push({
      dayOfWeek: dow,
      liftLabel: lift.label,
      lowerBody: false,
      heavyLower: false,
      workout,
      gapHours: 6,
      notes,
    });
    return;
  }
  notes.push("quality run on rest day, at least 6 h from any lifting");
  placements.push({
    dayOfWeek: dow,
    liftLabel: null,
    lowerBody: false,
    heavyLower: false,
    workout,
    gapHours: null,
    notes,
  });
}

function placeEasyRun(
  dow: number,
  lift: DayPlan | null,
  input: HybridInput,
  notes: string[],
  traded: TradeReason[],
  placements: PlacedRun[],
  workout: RunWorkout,
): void {
  if (!lift || !lift.lowerBody) {
    if (!lift) notes.push("easy run on rest day");
    else notes.push(`easy run on ${lift.label} (upper body)`);
    placements.push({
      dayOfWeek: dow,
      liftLabel: lift?.label ?? null,
      lowerBody: lift?.lowerBody ?? false,
      heavyLower: false,
      workout,
      gapHours: lift ? 6 : null,
      notes,
    });
    return;
  }
  if (input.priority === "running") {
    traded.push({
      rule: RULE_EASY_ON_UPPER_REST,
      why: `easy run on lower-body day ${lift.label}; priority is running`,
      winner: "running",
    });
    notes.push("easy run on lower-body day (traded: priority running)");
  } else {
    notes.push(
      `easy run on lower-body day ${lift.label}, kept short and 6 h after lifting`,
    );
  }
  placements.push({
    dayOfWeek: dow,
    liftLabel: lift.label,
    lowerBody: true,
    heavyLower: lift.heavyLower,
    workout,
    gapHours: 6,
    notes,
  });
}

function heavyLowerDowSet(input: HybridInput): Set<number> {
  const dows = [1, 2, 3, 4, 5, 6];
  const out = new Set<number>();
  input.liftDays.forEach((d, i) => {
    if (d.heavyLower) out.add(dows[i % dows.length]);
  });
  return out;
}
