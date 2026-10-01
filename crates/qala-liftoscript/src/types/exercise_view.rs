//! Bridge to the exercise DB module, which has its own plain serde shapes
//! (`exercise::Weight`, `exercise::ExerciseType`, ...) and reads settings
//! through the `ExerciseSettings` trait. `ISettings::exercise_view` builds a
//! view that implements the trait; build it once per evaluation, since it
//! converts custom exercises and exercise data up front.

use indexmap::IndexMap;

use super::{ICustomExercise, IExerciseData, IExerciseType, ISettings, IUnit, IWeight};
use crate::exercise::{
    CustomExercise, CustomExercises, ExerciseData, ExerciseSettings, ExerciseType, MetaExercises,
    Unit, Weight,
};
use crate::muscle::{MuscleGroupData, MuscleGroupsSettings};

impl From<IUnit> for Unit {
    fn from(u: IUnit) -> Self {
        match u {
            IUnit::Kg => Unit::Kg,
            IUnit::Lb => Unit::Lb,
        }
    }
}

impl From<Unit> for IUnit {
    fn from(u: Unit) -> Self {
        match u {
            Unit::Kg => IUnit::Kg,
            Unit::Lb => IUnit::Lb,
        }
    }
}

impl From<IWeight> for Weight {
    fn from(w: IWeight) -> Self {
        Weight { value: w.value, unit: w.unit.into() }
    }
}

impl From<Weight> for IWeight {
    fn from(w: Weight) -> Self {
        IWeight { value: w.value, unit: w.unit.into() }
    }
}

impl From<&IExerciseType> for ExerciseType {
    fn from(t: &IExerciseType) -> Self {
        ExerciseType { id: t.id.clone(), equipment: t.equipment.clone() }
    }
}

impl From<&ExerciseType> for IExerciseType {
    fn from(t: &ExerciseType) -> Self {
        IExerciseType { id: t.id.clone(), equipment: t.equipment.clone(), extra: Default::default() }
    }
}

pub fn custom_exercise_to_view(c: &ICustomExercise) -> CustomExercise {
    CustomExercise {
        id: c.id.clone(),
        name: c.name.clone(),
        is_deleted: c.is_deleted,
        meta: MetaExercises {
            body_parts: c.meta.body_parts.clone(),
            target_muscles: c.meta.target_muscles.clone(),
            synergist_muscles: c.meta.synergist_muscles.clone(),
            sorted_equipment: c.meta.sorted_equipment.clone(),
        },
        default_equipment: c.default_equipment.clone(),
        types: c
            .types
            .as_ref()
            .map(|t| t.iter().map(|k| kind_str(*k).to_string()).collect()),
    }
}

fn kind_str(k: super::IExerciseKind) -> &'static str {
    use super::IExerciseKind::*;
    match k {
        Core => "core",
        Pull => "pull",
        Push => "push",
        Legs => "legs",
        Upper => "upper",
        Lower => "lower",
    }
}

pub fn exercise_data_to_view(d: &super::IExerciseDataValue) -> ExerciseData {
    ExerciseData {
        rm1: d.rm1.map(Into::into),
        rounding: d.rounding,
        equipment: d
            .equipment
            .as_ref()
            .map(|m| m.iter().map(|(k, v)| (k.clone(), Some(v.clone()))).collect()),
        notes: d.notes.clone(),
        muscle_multipliers: d
            .muscle_multipliers
            .as_ref()
            .map(|m| m.iter().map(|(k, v)| (k.clone(), Some(v.0))).collect()),
        is_unilateral: d.is_unilateral,
        volume_multiplier: d.volume_multiplier,
    }
}

/// Owned snapshot of the settings parts the exercise helpers read.
pub struct ExerciseSettingsView<'a> {
    settings: &'a ISettings,
    custom: CustomExercises,
    data: IndexMap<String, ExerciseData>,
    muscle_groups: MuscleGroupsSettings,
}

impl ISettings {
    pub fn exercise_view(&self) -> ExerciseSettingsView<'_> {
        let custom: CustomExercises = self
            .exercises
            .iter()
            .map(|(k, v)| (k.clone(), custom_exercise_to_view(v)))
            .collect();
        let data: IndexMap<String, ExerciseData> = {
            let d: &IExerciseData = &self.exercise_data;
            d.iter().map(|(k, v)| (k.clone(), exercise_data_to_view(v))).collect()
        };
        let muscle_groups = MuscleGroupsSettings {
            data: self
                .muscle_groups
                .data
                .iter()
                .map(|(k, v)| {
                    (
                        k.clone(),
                        MuscleGroupData {
                            name: v.name.clone(),
                            is_hidden: v.is_hidden,
                            muscles: v.muscles.clone(),
                        },
                    )
                })
                .collect(),
        };
        ExerciseSettingsView { settings: self, custom, data, muscle_groups }
    }
}

impl ExerciseSettings for ExerciseSettingsView<'_> {
    fn units(&self) -> Unit {
        self.settings.units.into()
    }
    fn custom_exercises(&self) -> &CustomExercises {
        &self.custom
    }
    fn exercise_data(&self, key: &str) -> Option<&ExerciseData> {
        self.data.get(key)
    }
    fn synergist_multiplier(&self) -> f64 {
        self.settings.planner.synergist_multiplier
    }
    fn muscle_groups(&self) -> &MuscleGroupsSettings {
        &self.muscle_groups
    }
    fn custom_equipment_name(&self, equipment: &str) -> Option<&str> {
        crate::equipment::current_equipment(self.settings)
            .and_then(|e| e.get(equipment))
            .and_then(|d| d.name.as_deref())
    }
    fn unit_for_exercise_type(&self, exercise_type: &ExerciseType) -> Unit {
        let t: IExerciseType = exercise_type.into();
        crate::equipment::get_unit_or_default_for_exercise_type(self.settings, Some(&t)).into()
    }
}
