//! Integration tests for `availability`, `hlc`, `muscles` and `records`: golden replays through
//! the public API. The HLC vectors in `testdata/golden/hlc/` are hand-worked (`oracle: manual`);
//! the server and the web client replay the same files.

use qala_core::hlc::{merge_field, merge_tombstone, Field, Hlc, HlcError};
use serde_json::{json, Value};

const COMPARE: &str = include_str!("../../../testdata/golden/hlc/compare.json");
const TO_STRING: &str = include_str!("../../../testdata/golden/hlc/to_string.json");
const PARSE: &str = include_str!("../../../testdata/golden/hlc/parse.json");
const TICK: &str = include_str!("../../../testdata/golden/hlc/tick.json");
const RECEIVE: &str = include_str!("../../../testdata/golden/hlc/receive.json");
const MERGE_FIELD: &str = include_str!("../../../testdata/golden/hlc/merge_field.json");
const MERGE_LAWS: &str = include_str!("../../../testdata/golden/hlc/merge_field_laws.json");
const MERGE_TOMBSTONE: &str = include_str!("../../../testdata/golden/hlc/merge_tombstone.json");

/// Every file in `testdata/golden/hlc/`, so a new vector file cannot be left unreplayed.
const HLC_FILES: [&str; 8] = [
    "compare.json",
    "merge_field.json",
    "merge_field_laws.json",
    "merge_tombstone.json",
    "parse.json",
    "receive.json",
    "tick.json",
    "to_string.json",
];

struct Case {
    name: String,
    input: Value,
    expected: Value,
}

/// Check the file header and return its cases.
fn load(text: &str, want_fn: &str) -> Vec<Case> {
    let doc: Value = serde_json::from_str(text).expect("golden file is JSON");
    assert_eq!(doc["fn"], want_fn, "fn");
    assert_eq!(doc["version"], 1, "{want_fn}: version");
    assert_eq!(doc["oracle"], "manual", "{want_fn}: oracle");
    let reason = doc["reason"].as_str().unwrap_or_default();
    assert!(
        !reason.is_empty(),
        "{want_fn}: a manual oracle needs a reason"
    );
    let cases = doc["cases"].as_array().expect("cases is an array");
    assert!(cases.len() >= 5, "{want_fn}: only {} cases", cases.len());
    let mut seen = Vec::new();
    let out: Vec<Case> = cases
        .iter()
        .map(|c| {
            let name = c["name"].as_str().expect("case has a name").to_string();
            assert!(
                !seen.contains(&name),
                "{want_fn}: duplicate case name {name:?}"
            );
            seen.push(name.clone());
            Case {
                name,
                input: c["input"].clone(),
                expected: c["expected"].clone(),
            }
        })
        .collect();
    out
}

fn hlc(v: &Value) -> Hlc {
    serde_json::from_value(v.clone()).expect("input is a clock value")
}

fn clock_result(r: Result<Hlc, HlcError>) -> Value {
    match r {
        Ok(h) => json!({ "ok": serde_json::to_value(h).expect("serializes") }),
        Err(e) => json!({ "error": e.kind() }),
    }
}

#[test]
fn hlc_compare_vectors() {
    for case in load(COMPARE, "hlc_compare") {
        let (a, b) = (hlc(&case.input["a"]), hlc(&case.input["b"]));
        let got = a.cmp(&b) as i32;
        assert_eq!(json!(got), case.expected, "{}", case.name);
        // The string form sorts the same way as the struct, byte for byte.
        let by_text = a.to_string().cmp(&b.to_string()) as i32;
        assert_eq!(by_text, got, "{}: string order", case.name);
        // The comparison is antisymmetric.
        assert_eq!(b.cmp(&a), a.cmp(&b).reverse(), "{}: reversed", case.name);
    }
}

#[test]
fn hlc_to_string_vectors() {
    for case in load(TO_STRING, "hlc_to_string") {
        let h = hlc(&case.input);
        assert_eq!(json!(h.to_string()), case.expected, "{}", case.name);
        assert_eq!(
            Hlc::parse(&h.to_string()),
            Ok(h),
            "{}: parse inverts it",
            case.name
        );
    }
}

#[test]
fn hlc_parse_vectors() {
    for case in load(PARSE, "hlc_parse") {
        let text = case.input.as_str().expect("input is a string");
        let got = clock_result(Hlc::parse(text));
        assert_eq!(got, case.expected, "{}", case.name);
        if let Some(ok) = case.expected.get("ok") {
            let parsed = hlc(ok);
            assert_eq!(
                parsed.to_string(),
                text,
                "{}: prints back identically",
                case.name
            );
        }
    }
}

#[test]
fn hlc_tick_vectors() {
    for case in load(TICK, "hlc_tick") {
        let local = hlc(&case.input["local"]);
        let now = case.input["nowMs"].as_i64().expect("nowMs");
        let got = local.tick(now);
        assert_eq!(clock_result(got.clone()), case.expected, "{}", case.name);
        if let Ok(next) = got {
            assert!(next > local, "{}: tick must advance", case.name);
        }
    }
}

#[test]
fn hlc_receive_vectors() {
    for case in load(RECEIVE, "hlc_receive") {
        let local = hlc(&case.input["local"]);
        let remote = hlc(&case.input["remote"]);
        let now = case.input["nowMs"].as_i64().expect("nowMs");
        let drift = case.input["maxDriftMs"].as_i64().expect("maxDriftMs");
        let got = local.receive(&remote, now, drift);
        assert_eq!(clock_result(got.clone()), case.expected, "{}", case.name);
        if let Ok(next) = got {
            assert!(
                next > local && next > remote,
                "{}: receive must pass both",
                case.name
            );
        }
    }
}

fn field(v: &Value) -> Field<Value> {
    serde_json::from_value(v.clone()).expect("input is a field")
}

fn field_value(f: &Field<Value>) -> Value {
    serde_json::to_value(f).expect("serializes")
}

#[test]
fn hlc_merge_field_vectors() {
    for case in load(MERGE_FIELD, "hlc_merge_field") {
        let (local, remote) = (field(&case.input["local"]), field(&case.input["remote"]));
        let merged = merge_field(&local, &remote);
        assert_eq!(field_value(&merged), case.expected, "{}", case.name);
        // Merging the result with either side again changes nothing.
        assert_eq!(
            merge_field(&merged, &local),
            merged,
            "{}: idempotent (local)",
            case.name
        );
        assert_eq!(
            merge_field(&merged, &remote),
            merged,
            "{}: idempotent (remote)",
            case.name
        );
    }
}

#[test]
fn hlc_merge_field_laws_vectors() {
    for case in load(MERGE_LAWS, "hlc_merge_field_laws") {
        let a = field(&case.input["a"]);
        let b = field(&case.input["b"]);
        let c = field(&case.input["c"]);
        let want = &case.expected;
        let orderings = [
            [&a, &b, &c],
            [&a, &c, &b],
            [&b, &a, &c],
            [&b, &c, &a],
            [&c, &a, &b],
            [&c, &b, &a],
        ];
        for [p, q, r] in orderings {
            let left = merge_field(&merge_field(p, q), r);
            let right = merge_field(p, &merge_field(q, r));
            assert_eq!(&field_value(&left), want, "{}: (p q) r", case.name);
            assert_eq!(&field_value(&right), want, "{}: p (q r)", case.name);
            assert_eq!(
                merge_field(p, q),
                merge_field(q, p),
                "{}: commutative",
                case.name
            );
            assert_eq!(&merge_field(p, p), p, "{}: idempotent", case.name);
        }
    }
}

#[test]
fn hlc_merge_tombstone_vectors() {
    for case in load(MERGE_TOMBSTONE, "hlc_merge_tombstone") {
        let tomb = |v: &Value| -> Field<bool> {
            serde_json::from_value(v.clone()).expect("input is a tombstone")
        };
        let (local, remote) = (tomb(&case.input["local"]), tomb(&case.input["remote"]));
        let merged = merge_tombstone(&local, &remote);
        assert_eq!(
            serde_json::to_value(&merged).expect("serializes"),
            case.expected,
            "{}",
            case.name
        );
        assert_eq!(
            merged,
            merge_tombstone(&remote, &local),
            "{}: commutative",
            case.name
        );
    }
}

#[test]
fn every_hlc_golden_file_is_replayed() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../testdata/golden/hlc");
    let mut on_disk: Vec<String> = std::fs::read_dir(&dir)
        .expect("golden/hlc exists")
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    on_disk.sort();
    assert_eq!(
        on_disk, HLC_FILES,
        "update HLC_FILES and add a replay for the new file"
    );
}

// ---------------------------------------------------------------------------------------
// Availability: replay of testdata/golden/engine/availability.json.
// ---------------------------------------------------------------------------------------

use qala_core::availability::{
    apply_injury_to_checkin, classify_day, covers_day, guard_exercise, injured_on, norm_muscle,
    reason_on, shifts_plan, try_add_days_key, Availability, Checkin, DaySkip, SkipReason,
};
use serde::de::DeserializeOwned;

fn arg<T: DeserializeOwned>(args: &Value, key: &str) -> T {
    let v = args.get(key).cloned().unwrap_or(Value::Null);
    serde_json::from_value(v).unwrap_or_else(|e| panic!("arg {key}: {e}"))
}

/// Run one recorded call. `Err` is a call the TS function throws on (an invalid date key).
fn availability_call(f: &str, args: &Value) -> Result<Value, String> {
    Ok(match f {
        "shiftsPlan" => to_json(&shifts_plan(arg::<SkipReason>(args, "reason"))),
        "coversDay" => to_json(&covers_day(
            &arg::<Availability>(args, "a"),
            &arg::<String>(args, "dateKey"),
        )),
        "reasonOn" => to_json(&reason_on(
            &arg::<String>(args, "dateKey"),
            &arg::<Availability>(args, "availability"),
            &arg::<Vec<DaySkip>>(args, "skips"),
        )),
        "classifyDay" => to_json(&classify_day(
            &arg::<String>(args, "dateKey"),
            &arg::<Availability>(args, "availability"),
            &arg::<Vec<DaySkip>>(args, "skips"),
        )),
        "injuredOn" => to_json(&injured_on(
            &arg::<String>(args, "dateKey"),
            &arg::<Availability>(args, "availability"),
            &arg::<Vec<DaySkip>>(args, "skips"),
        )),
        "normMuscle" => to_json(&norm_muscle(&arg::<String>(args, "muscle"))),
        "guardExercise" => {
            let synergists: Option<Vec<String>> = arg(args, "synergists");
            to_json(&guard_exercise(
                &arg::<Vec<String>>(args, "targets"),
                synergists.as_deref(),
                &arg::<Vec<String>>(args, "injured"),
            ))
        }
        "applyInjuryToCheckin" => to_json(&apply_injury_to_checkin(
            &arg::<Checkin>(args, "checkin"),
            &arg::<Vec<String>>(args, "injured"),
        )),
        "addDaysKey" => {
            let key: String = arg(args, "dateKey");
            match try_add_days_key(&key, arg::<i64>(args, "days")) {
                Ok(next) => to_json(&next),
                Err(e) => return Err(e.to_string()),
            }
        }
        other => panic!("availability.json has a function this test does not know: {other}"),
    })
}

fn to_json<T: serde::Serialize>(v: &T) -> Value {
    serde_json::to_value(v).expect("result serializes")
}

/// Golden comparison: numbers as f64, objects by key, arrays in order.
fn same(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(p, q)| same(p, q))
        }
        (Value::Object(x), Value::Object(y)) => {
            x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| same(v, w)))
        }
        _ => a == b,
    }
}

#[test]
fn availability_matches_the_golden() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../testdata/golden/engine/availability.json");
    let text = std::fs::read_to_string(&path).expect("availability.json is generated");
    let doc: Value = serde_json::from_str(&text).expect("golden file is JSON");
    assert_eq!(doc["fn"], "availability");
    assert_eq!(doc["version"], 1);
    let cases = doc["cases"].as_array().expect("cases is an array");
    assert!(cases.len() > 100, "only {} cases", cases.len());
    let mut by_fn = std::collections::BTreeMap::<String, usize>::new();
    let mut throws = 0;
    for case in cases {
        let name = case["name"].as_str().unwrap_or("?");
        let f = case["input"]["fn"].as_str().expect("input.fn");
        let got = availability_call(f, &case["input"]["args"]);
        let expected = &case["expected"];
        if expected.get("$throws").is_some() {
            assert!(
                got.is_err(),
                "{f} / {name}: TS throws, Rust must return an error"
            );
            throws += 1;
        } else {
            let got = got.unwrap_or_else(|e| panic!("{f} / {name}: unexpected error {e}"));
            assert!(
                same(&got, expected),
                "{f} / {name}: got {got}, want {expected}"
            );
        }
        *by_fn.entry(f.to_string()).or_default() += 1;
    }
    // Every ported function has cases, and the invalid-key throw cases ran.
    for f in [
        "shiftsPlan",
        "coversDay",
        "reasonOn",
        "classifyDay",
        "injuredOn",
        "normMuscle",
        "guardExercise",
        "applyInjuryToCheckin",
        "addDaysKey",
    ] {
        assert!(by_fn.get(f).copied().unwrap_or(0) >= 5, "{f}: {by_fn:?}");
    }
    assert!(throws >= 1, "no throw cases ran");
}

// ---------------------------------------------------------------------------------------
// Cross-module checks on the public API.
// ---------------------------------------------------------------------------------------

#[test]
fn records_reexport_the_availability_types() {
    use qala_core::{availability, records};
    // Same types, not copies: a value built through one path is accepted by the other.
    let a: availability::Availability = records::Availability::default();
    let skip: records::DaySkip = availability::DaySkip {
        date: "2026-10-04".to_string(),
        reason: availability::SkipReason::Sick,
        muscle: None,
        note: None,
    };
    assert_eq!(
        availability::classify_day("2026-10-04", &a, std::slice::from_ref(&skip)),
        availability::DayClass::Shift
    );
}

#[test]
fn engine_muscles_cover_every_main_lift_default() {
    use qala_core::{muscles, records::SettingsRecord};
    for lift in SettingsRecord::default().main_lifts {
        let m = muscles::exercise_muscles(&lift)
            .unwrap_or_else(|| panic!("default main lift {lift} is not in the library"));
        assert!(!m.targets.is_empty(), "{lift} has no target muscle");
        for id in m.targets.iter().chain(m.synergists.iter()) {
            assert!(
                muscles::ENGINE_MUSCLES.contains(&id.as_str()),
                "{lift}: {id}"
            );
        }
    }
}

#[test]
fn injured_guard_uses_muscle_ids_the_mapping_produces() {
    use qala_core::{availability, muscles};
    // The guard compares normalised ids, so the ids `muscles` emits must match what a user
    // injury stores (engine ids, or the body-map alias for quads).
    let squat = muscles::exercise_muscles("squat").expect("squat is in the library");
    let hurt = vec!["Quadriceps".to_string()];
    assert_eq!(
        availability::guard_exercise(&squat.targets, Some(&squat.synergists), &hurt),
        availability::GuardVerdict::Skip
    );
    let bench = muscles::exercise_muscles("benchPress").expect("benchPress is in the library");
    assert_eq!(
        availability::guard_exercise(&bench.targets, Some(&bench.synergists), &hurt),
        availability::GuardVerdict::Train
    );
    let triceps = vec!["triceps".to_string()];
    assert_eq!(
        availability::guard_exercise(&bench.targets, Some(&bench.synergists), &triceps),
        availability::GuardVerdict::Halve
    );
}
