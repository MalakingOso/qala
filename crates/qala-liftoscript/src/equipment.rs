//! Port of `models/equipment.ts`.
//!
//! Where TS would throw on an empty `settings.gyms` (it indexes `gyms[0]`),
//! these return `None` instead.

use indexmap::IndexSet;

use crate::exercise::equipment_name;
use crate::js::{js_number_to_string, js_order_keys};
use crate::types::{
    EquipmentDataVtype, IAllEquipment, IEquipmentBar, IEquipmentData, IExerciseType, IGym, IPlate,
    ISettings, IUnit, IWeight, EQUIPMENTS,
};
use crate::util::collection::{concat_by, sort};
use crate::weight::{build as weight_build, compare as weight_compare};

/// `Equipment_build`: a fresh equipment entry with the default plates.
pub fn build(name: &str) -> IEquipmentData {
    IEquipmentData {
        vtype: EquipmentDataVtype,
        name: Some(name.to_string()),
        multiplier: 1.0,
        bar: IEquipmentBar { lb: weight_build(0.0, IUnit::Lb), kg: weight_build(0.0, IUnit::Kg) },
        plates: vec![
            IPlate { weight: weight_build(10.0, IUnit::Lb), num: 4.0 },
            IPlate { weight: weight_build(5.0, IUnit::Kg), num: 4.0 },
        ],
        fixed: vec![],
        is_fixed: false,
        unit: None,
        similar_to: None,
        is_deleted: None,
        use_bodyweight_for_bar: None,
        is_assisting: None,
        notes: None,
    }
}

/// `Equipment_getEquipmentOfGym`: the equipment of the gym with id `key`, else of the first gym.
pub fn get_equipment_of_gym<'a>(settings: &'a ISettings, key: Option<&str>) -> Option<&'a IAllEquipment> {
    let first = settings.gyms.first().map(|g| &g.equipment)?;
    match key {
        Some(k) => Some(settings.gyms.iter().find(|g| g.id == k).map(|g| &g.equipment).unwrap_or(first)),
        None => Some(first),
    }
}

/// `Equipment_getGymByIdOrCurrent`
pub fn get_gym_by_id_or_current<'a>(settings: &'a ISettings, gym_id: Option<&str>) -> Option<&'a IGym> {
    let wanted = gym_id.or(settings.current_gym_id.as_deref());
    settings
        .gyms
        .iter()
        .find(|g| Some(g.id.as_str()) == wanted)
        .or_else(|| settings.gyms.first())
}

/// `Equipment_getCurrentGym`
pub fn get_current_gym(settings: &ISettings) -> Option<&IGym> {
    settings
        .gyms
        .iter()
        .find(|g| Some(g.id.as_str()) == settings.current_gym_id.as_deref())
        .or_else(|| settings.gyms.first())
}

/// `Equipment_getEquipmentIdForExerciseType`
pub fn get_equipment_id_for_exercise_type(
    settings: &ISettings,
    exercise_type: Option<&IExerciseType>,
    gym_id: Option<&str>,
) -> Option<String> {
    let exercise_type = exercise_type?;
    let key = exercise_type.to_key();
    let data = match settings.exercise_data.get(&key) {
        Some(d) if d.equipment.is_some() || d.rounding.is_some() => d,
        _ => return exercise_type.equipment.clone(),
    };
    let exercise_equipment = data.equipment.as_ref()?;
    let current_gym = get_gym_by_id_or_current(settings, gym_id)?;
    exercise_equipment.get(&current_gym.id).cloned()
}

/// `Equipment_getEquipmentNameForExerciseType`
pub fn get_equipment_name_for_exercise_type(
    settings: &ISettings,
    exercise_type: Option<&IExerciseType>,
) -> Option<String> {
    let equipment = get_equipment_id_for_exercise_type(settings, exercise_type, None)?;
    let current_gym = get_current_gym(settings)?;
    let gym_equipment = current_gym.equipment.get(&equipment)?;
    if gym_equipment.is_deleted == Some(true) {
        return None;
    }
    match gym_equipment.name.as_deref() {
        Some(n) if !n.is_empty() => Some(n.to_string()),
        _ => Some(equipment_name(Some(&equipment))),
    }
}

/// `Equipment_getEquipmentDataForExerciseType`
pub fn get_equipment_data_for_exercise_type<'a>(
    settings: &'a ISettings,
    exercise_type: Option<&IExerciseType>,
) -> Option<&'a IEquipmentData> {
    let equipment = get_equipment_id_for_exercise_type(settings, exercise_type, None);
    let current_gym = get_current_gym(settings)?;
    match equipment {
        Some(e) if !e.is_empty() => current_gym.equipment.get(&e),
        _ => None,
    }
}

/// `Equipment_getUnitOrDefaultForExerciseType`
pub fn get_unit_or_default_for_exercise_type(
    settings: &ISettings,
    exercise_type: Option<&IExerciseType>,
) -> IUnit {
    get_equipment_data_for_exercise_type(settings, exercise_type)
        .and_then(|e| e.unit)
        .unwrap_or(settings.units)
}

/// `Equipment_getUnitForExerciseType`: the equipment unit when it differs from `settings.units`.
pub fn get_unit_for_exercise_type(settings: &ISettings, exercise_type: Option<&IExerciseType>) -> Option<IUnit> {
    let unit = get_equipment_data_for_exercise_type(settings, exercise_type)?.unit?;
    if unit == settings.units {
        None
    } else {
        Some(unit)
    }
}

/// `Equipment_getEquipmentData`
pub fn get_equipment_data<'a>(settings: &'a ISettings, key: &str) -> Option<&'a IEquipmentData> {
    current_equipment(settings)?.get(key)
}

/// `Equipment_currentEquipment`
pub fn current_equipment(settings: &ISettings) -> Option<&IAllEquipment> {
    get_current_gym(settings).map(|g| &g.equipment)
}

/// `Equipment_smallestPlate`: smallest plate in `unit`, else a 1 `unit` weight.
pub fn smallest_plate(equipment_data: &IEquipmentData, unit: IUnit) -> IWeight {
    let plates: Vec<IPlate> = equipment_data.plates.iter().filter(|p| p.weight.unit == unit).cloned().collect();
    sort(&plates, |a, b| weight_compare(a.weight, b.weight))
        .first()
        .map(|p| p.weight)
        .unwrap_or_else(|| weight_build(1.0, unit))
}

/// `Equipment_mergeEquipment`
pub fn merge_equipment(old: &IAllEquipment, new: &IAllEquipment) -> IAllEquipment {
    let mut keys: IndexSet<&String> = IndexSet::new();
    keys.extend(new.keys());
    keys.extend(old.keys());
    let mut acc = IAllEquipment::new();
    for name in keys {
        match (new.get(name), old.get(name)) {
            (Some(n), None) => {
                acc.insert(name.clone(), n.clone());
            }
            (None, Some(o)) => {
                acc.insert(name.clone(), o.clone());
            }
            (Some(n), Some(o)) => {
                let mut merged = o.clone();
                merged.bar = n.bar.clone();
                merged.is_fixed = n.is_fixed;
                merged.plates = concat_by(&o.plates, &n.plates, |el| {
                    format!("{}{}", js_number_to_string(el.weight.value), el.weight.unit.as_str())
                });
                merged.multiplier = n.multiplier;
                merged.fixed = concat_by(&o.fixed, &n.fixed, |el| {
                    format!("{}{}", js_number_to_string(el.value), el.unit.as_str())
                });
                acc.insert(name.clone(), merged);
            }
            (None, None) => {}
        }
    }
    js_order_keys(acc)
}

/// `Equipment_isBuiltIn`
pub fn is_built_in(key: &str) -> bool {
    EQUIPMENTS.contains(&key)
}

/// `Equipment_customEquipment`: the entries whose key is not a built-in equipment.
pub fn custom_equipment(equipment_settings: Option<&IAllEquipment>) -> IAllEquipment {
    match equipment_settings {
        Some(e) => e.iter().filter(|(k, _)| !is_built_in(k)).map(|(k, v)| (k.clone(), v.clone())).collect(),
        None => IAllEquipment::new(),
    }
}

/// `Equipment_equipmentKeyByName`. As in TS, the display name of a custom
/// key is looked up without settings, so it only matches when `name` is empty.
pub fn equipment_key_by_name(name: &str, equipment_settings: Option<&IAllEquipment>) -> Option<String> {
    let lower = name.to_lowercase();
    if let Some(k) = EQUIPMENTS.iter().find(|eq| **eq == lower) {
        return Some((*k).to_string());
    }
    if let Some(k) = EQUIPMENTS
        .iter()
        .find(|eq| equipment_name(Some(eq)).to_lowercase() == lower)
    {
        return Some((*k).to_string());
    }
    equipment_settings?
        .keys()
        .find(|eq| equipment_name(Some(eq)).to_lowercase() == lower)
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::tests::{arg, check, parse_cases, settings_named};
    use serde_json::Value;

    // Expected values come from the TS oracle (testdata/unit/gen_unit_cases.ts
    // over models/equipment.ts, results in cases_equipment.json).

    fn j<T: serde::Serialize>(x: T) -> Result<Value, String> {
        serde_json::to_value(x).map_err(|e| e.to_string())
    }

    fn run(f: &str, a: &[Value]) -> Option<Result<Value, String>> {
        if f == "build" {
            return Some(j(build(a[0].as_str()?)));
        }
        if f == "isBuiltIn" {
            return Some(j(is_built_in(a[0].as_str()?)));
        }
        if f == "customEquipment" {
            return Some(j(custom_equipment(arg::<Option<IAllEquipment>>(&a[0]).as_ref())));
        }
        if f == "equipmentKeyByName" {
            return Some(j(equipment_key_by_name(a[0].as_str()?, arg::<Option<IAllEquipment>>(&a[1]).as_ref())));
        }
        if f == "mergeEquipment" {
            return Some(j(merge_equipment(&arg(&a[0]), &arg(&a[1]))));
        }
        if f == "smallestPlate" {
            let s = settings_named("lb");
            let key = a[0].as_str()?;
            let ed = s.gyms[0].equipment.get(key)?;
            return Some(j(smallest_plate(ed, arg(&a[1]))));
        }
        let s = settings_named(a[0].as_str()?);
        let ty = |i: usize| arg::<Option<IExerciseType>>(&a[i]);
        let gym = |i: usize| a[i].as_str().map(|x| x.to_string());
        Some(match f {
            "getEquipmentOfGym" => j(get_equipment_of_gym(&s, gym(1).as_deref())),
            "getCurrentGym" => j(get_current_gym(&s)),
            "getGymByIdOrCurrent" => j(get_gym_by_id_or_current(&s, gym(1).as_deref())),
            "getEquipmentIdForExerciseType" => {
                j(get_equipment_id_for_exercise_type(&s, ty(1).as_ref(), gym(2).as_deref()))
            }
            "getEquipmentNameForExerciseType" => j(get_equipment_name_for_exercise_type(&s, ty(1).as_ref())),
            "getEquipmentDataForExerciseType" => j(get_equipment_data_for_exercise_type(&s, ty(1).as_ref())),
            "getUnitOrDefaultForExerciseType" => j(get_unit_or_default_for_exercise_type(&s, ty(1).as_ref())),
            "getUnitForExerciseType" => j(get_unit_for_exercise_type(&s, ty(1).as_ref())),
            "getEquipmentData" => j(get_equipment_data(&s, a[1].as_str()?)),
            "currentEquipment" => j(current_equipment(&s)),
            _ => return None,
        })
    }

    #[test]
    fn matches_oracle() {
        let cases = parse_cases(include_str!("../testdata/unit/cases_equipment.json"));
        let mut errors = Vec::new();
        let mut unknown = std::collections::BTreeSet::new();
        for c in &cases {
            match run(&c.f, &c.args) {
                Some(r) => check(c, &Value::Array(c.args.clone()).to_string(), r, false, &mut errors),
                None => {
                    unknown.insert(c.f.clone());
                }
            }
        }
        assert!(unknown.is_empty(), "unhandled fns: {unknown:?}");
        assert!(errors.is_empty(), "{} of {} cases differ, first:\n{}", errors.len(), cases.len(), errors.join("\n"));
    }

    #[test]
    fn empty_gyms_do_not_panic() {
        let mut s = settings_named("lb");
        s.gyms.clear();
        assert!(get_current_gym(&s).is_none());
        assert!(get_equipment_of_gym(&s, None).is_none());
        assert!(current_equipment(&s).is_none());
        let t = IExerciseType::new("squat", Some("barbell"));
        assert!(get_equipment_data_for_exercise_type(&s, Some(&t)).is_none());
        assert_eq!(get_unit_or_default_for_exercise_type(&s, Some(&t)), IUnit::Lb);
    }
}
