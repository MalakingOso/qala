//! Liftosaur anatomical muscle names to the engine's short muscle ids.
//!
//! The liftosaur exercise library names muscles anatomically ("Gluteus Maximus", 39 names, the
//! `availableMuscles` list of `qala-lspp`). The engine keeps fatigue per short id (`glutes`,
//! `quads`, ...). An anatomical name that is missing from the table below would silently add no
//! fatigue, so the tests walk the whole library and fail on any name that does not map.

use qala_lspp::exercise;

/// The engine's muscle ids, sorted. Nothing in the table maps to `back`; it stays in the list
/// because the engine and the injury guard accept it as an id.
pub const ENGINE_MUSCLES: [&str; 16] = [
    "abs",
    "back",
    "biceps",
    "calves",
    "chest",
    "forearms",
    "frontdelts",
    "glutes",
    "hamstrings",
    "lats",
    "lowerback",
    "quads",
    "reardelts",
    "sidedelts",
    "triceps",
    "upperback",
];

/// Engine id for one liftosaur anatomical muscle name. Exact match on the library spelling;
/// `None` for a name that is not in the table.
pub fn engine_muscle(anatomical: &str) -> Option<&'static str> {
    let id = match anatomical {
        "Adductor Brevis" | "Adductor Longus" | "Pectineous" | "Quadriceps" | "Sartorius" => {
            "quads"
        }
        "Adductor Magnus" | "Hamstrings" => "hamstrings",
        "Biceps Brachii" | "Brachialis" => "biceps",
        "Brachioradialis" | "Wrist Extensors" | "Wrist Flexors" => "forearms",
        "Deltoid Anterior" => "frontdelts",
        "Deltoid Lateral" => "sidedelts",
        "Deltoid Posterior" | "Infraspinatus" | "Teres Minor" => "reardelts",
        "Erector Spinae" => "lowerback",
        "Gastrocnemius" | "Soleus" | "Tibialis Anterior" => "calves",
        "Gluteus Maximus" | "Gluteus Medius" | "Tensor Fasciae Latae" => "glutes",
        "Iliopsoas" | "Obliques" | "Rectus Abdominis" => "abs",
        "Latissimus Dorsi" | "Teres Major" => "lats",
        "Levator Scapulae"
        | "Splenius"
        | "Sternocleidomastoid"
        | "Trapezius Lower Fibers"
        | "Trapezius Middle Fibers"
        | "Trapezius Upper Fibers" => "upperback",
        "Pectoralis Major Clavicular Head"
        | "Pectoralis Major Sternal Head"
        | "Serratus Anterior" => "chest",
        "Triceps Brachii" => "triceps",
        _ => return None,
    };
    Some(id)
}

/// An exercise's muscles as engine ids. Both lists are deduplicated in first-seen order, and a
/// synergist that is also a target is dropped.
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub struct ExerciseMuscles {
    pub targets: Vec<String>,
    pub synergists: Vec<String>,
}

/// Map anatomical target and synergist lists to engine ids (the pure part of
/// [`exercise_muscles`], also usable for custom exercises). A name that is not in the table is
/// skipped.
pub fn map_muscles<S: AsRef<str>>(targets: &[S], synergists: &[S]) -> ExerciseMuscles {
    let mut out = ExerciseMuscles::default();
    for name in targets {
        if let Some(id) = engine_muscle(name.as_ref()) {
            if !out.targets.iter().any(|t| t == id) {
                out.targets.push(id.to_string());
            }
        }
    }
    for name in synergists {
        if let Some(id) = engine_muscle(name.as_ref()) {
            let is_target = out.targets.iter().any(|t| t == id);
            if !is_target && !out.synergists.iter().any(|s| s == id) {
                out.synergists.push(id.to_string());
            }
        }
    }
    out
}

/// Engine muscles of a built-in liftosaur exercise (`squat`, `benchPress`, ...). `None` for an
/// id that is not in the compiled library. A library exercise with no target muscles (the
/// elliptical machine) yields empty `targets`.
pub fn exercise_muscles(exercise_id: &str) -> Option<ExerciseMuscles> {
    let ex = exercise::db().get(exercise_id)?;
    Some(map_muscles(
        &ex.meta.target_muscles,
        &ex.meta.synergist_muscles,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use qala_lspp::muscle;

    /// The table as the lead specified it, typed out separately from the `match` above so a
    /// transcription slip in either one fails the test.
    const SPEC: [(&str, &str); 39] = [
        ("Adductor Brevis", "quads"),
        ("Adductor Longus", "quads"),
        ("Adductor Magnus", "hamstrings"),
        ("Biceps Brachii", "biceps"),
        ("Brachialis", "biceps"),
        ("Brachioradialis", "forearms"),
        ("Deltoid Anterior", "frontdelts"),
        ("Deltoid Lateral", "sidedelts"),
        ("Deltoid Posterior", "reardelts"),
        ("Erector Spinae", "lowerback"),
        ("Gastrocnemius", "calves"),
        ("Gluteus Maximus", "glutes"),
        ("Gluteus Medius", "glutes"),
        ("Hamstrings", "hamstrings"),
        ("Iliopsoas", "abs"),
        ("Infraspinatus", "reardelts"),
        ("Latissimus Dorsi", "lats"),
        ("Levator Scapulae", "upperback"),
        ("Obliques", "abs"),
        ("Pectineous", "quads"),
        ("Pectoralis Major Clavicular Head", "chest"),
        ("Pectoralis Major Sternal Head", "chest"),
        ("Quadriceps", "quads"),
        ("Rectus Abdominis", "abs"),
        ("Sartorius", "quads"),
        ("Serratus Anterior", "chest"),
        ("Soleus", "calves"),
        ("Splenius", "upperback"),
        ("Sternocleidomastoid", "upperback"),
        ("Tensor Fasciae Latae", "glutes"),
        ("Teres Major", "lats"),
        ("Teres Minor", "reardelts"),
        ("Tibialis Anterior", "calves"),
        ("Trapezius Lower Fibers", "upperback"),
        ("Trapezius Middle Fibers", "upperback"),
        ("Trapezius Upper Fibers", "upperback"),
        ("Triceps Brachii", "triceps"),
        ("Wrist Extensors", "forearms"),
        ("Wrist Flexors", "forearms"),
    ];

    /// Library exercises that have no target muscles in the liftosaur data (cardio machine).
    /// Any other exercise without a target is a bug in the table or the data.
    const NO_TARGET_EXERCISES: [&str; 1] = ["ellipticalMachine"];

    fn v(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn every_available_muscle_maps() {
        let available = muscle::available_muscles();
        assert_eq!(available.len(), 39, "the library lists 39 muscles");
        let unmapped: Vec<&String> = available
            .iter()
            .filter(|m| engine_muscle(m).is_none())
            .collect();
        assert!(
            unmapped.is_empty(),
            "unmapped anatomical muscles: {unmapped:?}"
        );
    }

    #[test]
    fn table_matches_the_spec_exactly() {
        for (name, id) in SPEC {
            assert_eq!(engine_muscle(name), Some(id), "{name}");
        }
        let available = muscle::available_muscles();
        for m in available {
            assert!(SPEC.iter().any(|(n, _)| n == m), "spec is missing {m}");
        }
        assert_eq!(SPEC.len(), available.len());
    }

    #[test]
    fn mapped_ids_are_engine_ids_and_every_id_is_reachable() {
        for (name, id) in SPEC {
            assert!(
                ENGINE_MUSCLES.contains(&id),
                "{name} maps to unknown id {id}"
            );
        }
        for id in ENGINE_MUSCLES {
            if id == "back" {
                continue;
            }
            assert!(SPEC.iter().any(|(_, i)| *i == id), "{id} is never produced");
        }
        let mut sorted = ENGINE_MUSCLES;
        sorted.sort_unstable();
        assert_eq!(sorted, ENGINE_MUSCLES, "ENGINE_MUSCLES is sorted");
    }

    #[test]
    fn unknown_names_do_not_map() {
        assert_eq!(engine_muscle(""), None);
        assert_eq!(engine_muscle("quads"), None);
        assert_eq!(engine_muscle("quadriceps"), None, "exact spelling only");
        assert_eq!(engine_muscle("Quadriceps "), None);
    }

    #[test]
    fn every_library_exercise_has_a_target_in_engine_muscles() {
        let db = exercise::db();
        assert!(
            db.exercises.len() > 200,
            "library loaded: {}",
            db.exercises.len()
        );
        let mut without_target = Vec::new();
        for ex in &db.exercises {
            let m = exercise_muscles(&ex.id).expect("library id resolves");
            if m.targets.is_empty() {
                without_target.push(ex.id.as_str());
            }
            for id in m.targets.iter().chain(m.synergists.iter()) {
                assert!(ENGINE_MUSCLES.contains(&id.as_str()), "{}: {id}", ex.id);
            }
            for s in &m.synergists {
                assert!(!m.targets.contains(s), "{}: {s} is both", ex.id);
            }
            // The mapping dropped nothing: every anatomical name in the data is in the table.
            for name in ex
                .meta
                .target_muscles
                .iter()
                .chain(ex.meta.synergist_muscles.iter())
            {
                assert!(engine_muscle(name).is_some(), "{}: unmapped {name}", ex.id);
            }
        }
        assert_eq!(without_target, NO_TARGET_EXERCISES);
    }

    #[test]
    fn elliptical_has_synergists_but_no_target() {
        let m = exercise_muscles("ellipticalMachine").expect("in the library");
        assert!(m.targets.is_empty());
        assert!(!m.synergists.is_empty());
    }

    #[test]
    fn unknown_exercise_is_none() {
        assert_eq!(exercise_muscles("noSuchExercise"), None);
        assert_eq!(exercise_muscles(""), None);
        assert_eq!(exercise_muscles("bench"), None, "TS id, not a liftosaur id");
    }

    fn check(id: &str, targets: &[&str], synergists: &[&str]) {
        let got = exercise_muscles(id);
        let want = ExerciseMuscles {
            targets: v(targets),
            synergists: v(synergists),
        };
        assert_eq!(got, Some(want), "{id}");
    }

    #[test]
    fn hand_checked_exercises() {
        check("squat", &["quads"], &["hamstrings", "glutes", "calves"]);
        // Pectoralis Major Clavicular Head maps to chest, which is the target, so it drops.
        check("benchPress", &["chest"], &["frontdelts", "triceps"]);
        // Adductor Magnus and Hamstrings both map to hamstrings.
        check("deadlift", &["glutes"], &["hamstrings", "quads", "calves"]);
        check(
            "overheadPress",
            &["frontdelts"],
            &["sidedelts", "chest", "upperback", "triceps"],
        );
        // The barbell row of the TS engine is `bentOverRow` in the library. Teres Major maps to
        // lats (a target) and drops; Infraspinatus and Teres Minor join Deltoid Posterior.
        check(
            "bentOverRow",
            &["lats", "upperback"],
            &["biceps", "forearms", "reardelts", "chest"],
        );
    }

    #[test]
    fn map_muscles_dedupes_in_first_seen_order() {
        let m = map_muscles(
            &["Gluteus Medius", "Quadriceps", "Gluteus Maximus"],
            &[
                "Soleus",
                "Quadriceps",
                "Gastrocnemius",
                "Hamstrings",
                "Unknown Muscle",
            ],
        );
        assert_eq!(m.targets, v(&["glutes", "quads"]));
        assert_eq!(m.synergists, v(&["calves", "hamstrings"]));
        let empty = map_muscles::<&str>(&[], &[]);
        assert_eq!(empty, ExerciseMuscles::default());
    }
}
