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
    use crate::types::tests::settings_named;

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
