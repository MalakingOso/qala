//! Error details and syntax errors (`syntaxErrorTypes.ts`, the error classes
//! from `liftoscriptEvaluator.ts` and `plannerExerciseEvaluator.ts`) and the
//! `IEither` result type from `utils/types.ts`.

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::fmt;

use super::IDayData;

/// `IEither<T, U>`: `{ success: true, data }` or `{ success: false, error }`.
#[derive(Debug, Clone, PartialEq)]
pub enum IEither<T, U> {
    Success(T),
    Failure(U),
}

impl<T, U> IEither<T, U> {
    pub fn is_success(&self) -> bool {
        matches!(self, IEither::Success(_))
    }
    pub fn data(&self) -> Option<&T> {
        match self {
            IEither::Success(d) => Some(d),
            IEither::Failure(_) => None,
        }
    }
    pub fn error(&self) -> Option<&U> {
        match self {
            IEither::Success(_) => None,
            IEither::Failure(e) => Some(e),
        }
    }
    pub fn into_result(self) -> Result<T, U> {
        match self {
            IEither::Success(d) => Ok(d),
            IEither::Failure(e) => Err(e),
        }
    }
}

impl<T, U> From<Result<T, U>> for IEither<T, U> {
    fn from(r: Result<T, U>) -> Self {
        match r {
            Ok(d) => IEither::Success(d),
            Err(e) => IEither::Failure(e),
        }
    }
}

#[derive(Serialize)]
struct EitherOk<'a, T> {
    success: bool,
    data: &'a T,
}

#[derive(Serialize)]
struct EitherErr<'a, U> {
    success: bool,
    error: &'a U,
}

#[derive(Deserialize)]
struct EitherIn<T, U> {
    success: bool,
    #[serde(default = "none", bound(deserialize = "T: Deserialize<'de>"))]
    data: Option<T>,
    #[serde(default = "none", bound(deserialize = "U: Deserialize<'de>"))]
    error: Option<U>,
}

fn none<X>() -> Option<X> {
    None
}

impl<T: Serialize, U: Serialize> Serialize for IEither<T, U> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            IEither::Success(d) => EitherOk { success: true, data: d }.serialize(s),
            IEither::Failure(e) => EitherErr { success: false, error: e }.serialize(s),
        }
    }
}

impl<'de, T: Deserialize<'de>, U: Deserialize<'de>> Deserialize<'de> for IEither<T, U> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        use serde::de::Error;
        let raw = EitherIn::<T, U>::deserialize(d)?;
        if raw.success {
            raw.data.map(IEither::Success).ok_or_else(|| D::Error::missing_field("data"))
        } else {
            raw.error.map(IEither::Failure).ok_or_else(|| D::Error::missing_field("error"))
        }
    }
}

/// `IPlannerReuseSection`
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IPlannerReuseSection {
    Sets,
    Progress,
    Update,
    Description,
}

/// The `{ type, data? }` part of `ILiftoscriptErrorDetails` and
/// `IPlannerErrorDetails`. TS keeps the Liftoscript variants as a subset of
/// the planner ones ("flat, not nested"), so one enum holds both. Liftoscript
/// errors only ever use the first group (up to `WrongResultType`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum IErrorKind {
    // ISyntaxErrorSharedDetails
    Parse,
    UnexpectedNode { node: String },
    Internal { node: String },
    // ILiftoscriptErrorDetails
    UnknownFunction { name: String },
    FnArity { r#fn: String, expected: String, got: i64 },
    FnArgumentType {
        r#fn: String,
        index: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        arg_name: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        hint: Option<String>,
        got: String,
    },
    FnArrayArgument { r#fn: String, arg_text: String },
    UnknownVariable { name: String },
    UnknownStateVariable { state_key: String },
    NotAnArray { name: String },
    ReadonlyVariable { name: String },
    MissingVariableName,
    OtherStateIsWriteOnly,
    TooManyIndexes { key: String, max: i64 },
    IndexOutOfBounds {
        name: String,
        /// A JS number: fractional indexes like `reps[1.5]` reach this error.
        #[serde(with = "crate::js::num")]
        index: f64,
    },
    WildcardIndexOnRead,
    RangeIndexOnRead { name: String },
    IndexNotAssignableHere { name: String },
    UnknownAssignmentOperator { op: String, variable: String },
    UnknownOperator { op: String },
    OperatorOnArray { op: String },
    ForInNotArray,
    MalformedWeight,
    InvalidWeightOperation,
    WrongResultType { expected: String },
    // planner only
    UnknownExercise { name: String },
    DuplicateExerciseInDay { key: String },
    ConflictingProperty { property: String, exercise: String, a: IDayData, b: IDayData },
    ReuseTargetNotFound {
        full_name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        week: Option<i64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        day: Option<i64>,
    },
    ReuseAmbiguous,
    ReuseSelf { section: IPlannerReuseSection },
    ReuseCycle,
    ReuseChained { section: IPlannerReuseSection },
    ReuseTargetMissingSection { section: IPlannerReuseSection },
    ReuseTargetNotCustom { section: IPlannerReuseSection },
    ReuseWithoutOwnSection { section: IPlannerReuseSection },
    ReuseScriptNotFound { section: IPlannerReuseSection },
    ReuseTargetMultipleVariations { full_name: String },
    ReuseStateTypeMismatch { state_key: String },
    ReuseMissingStateVariable { state_key: String },
    ProgressionArgument { r#fn: String, index: i64, expected: String },
    ProgressionArity { r#fn: String, max: i64 },
    UnknownProgression { name: String },
    UnknownUpdate { name: String },
    CustomWithoutScript { section: IPlannerReuseSection },
    UpdateStateFromProgress,
    UpdateStateWithoutProgress,
    InvalidStateVariable { value: String },
    MissingPropertyValue { property: String },
    UnknownProperty { name: String },
    UnknownIdType { name: String },
    InvalidTags,
    LabelTooLong { max: i64 },
    WeeksNotAllowedInDayMode,
    DaysNotAllowedInDayMode,
    DayWithoutWeek,
    ExerciseWithoutDay,
    UnknownValidationError,
    FromWebview,
}

/// `ILiftoscriptErrorDetails` / `IPlannerErrorDetails`: the kind plus the
/// optional `subject` (which exercise the error is about).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IErrorDetails {
    #[serde(flatten)]
    pub kind: IErrorKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
}

impl From<IErrorKind> for IErrorDetails {
    fn from(kind: IErrorKind) -> Self {
        IErrorDetails { kind, subject: None }
    }
}

/// `IPlannerSyntaxPointer`
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
pub struct IPlannerSyntaxPointer {
    pub line: i64,
    pub offset: i64,
    pub from: i64,
    pub to: i64,
}

macro_rules! syntax_error {
    ($(#[$m:meta])* $name:ident) => {
        $(#[$m])*
        #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
        pub struct $name {
            /// The golden dumper writes errors as `{"$error": <class>, "message", ...}`.
            #[serde(rename = "$error", default, skip_serializing_if = "Option::is_none")]
            pub class: Option<String>,
            /// JS `Error.message` is not enumerable, so plain `JSON.stringify` lacks it.
            #[serde(default, skip_serializing_if = "String::is_empty")]
            pub message: String,
            pub line: i64,
            pub offset: i64,
            pub from: i64,
            pub to: i64,
            pub details: IErrorDetails,
        }

        impl $name {
            pub fn new(
                message: impl Into<String>,
                line: i64,
                offset: i64,
                from: i64,
                to: i64,
                details: impl Into<IErrorDetails>,
            ) -> Self {
                $name {
                    class: None,
                    message: message.into(),
                    line,
                    offset,
                    from,
                    to,
                    details: details.into(),
                }
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(&self.message)
            }
        }

        impl std::error::Error for $name {}
    };
}

syntax_error!(
    /// `LiftoscriptSyntaxError`
    LiftoscriptSyntaxError
);
syntax_error!(
    /// `PlannerSyntaxError`
    PlannerSyntaxError
);

impl PlannerSyntaxError {
    /// `PlannerSyntaxError.fromPoint`. The message gets a `"<fullName>: "`
    /// prefix (when `full_name` is non-empty) and a `" (line:offset)"` suffix,
    /// and `details.subject` is set whenever `full_name` is given.
    pub fn from_point(
        full_name: Option<&str>,
        message: &str,
        point: IPlannerSyntaxPointer,
        details: IErrorDetails,
    ) -> PlannerSyntaxError {
        let prefix = match full_name {
            Some(n) if !n.is_empty() => format!("{}: ", n),
            _ => String::new(),
        };
        let mut details = details;
        if let Some(n) = full_name {
            details.subject = Some(n.to_string());
        }
        PlannerSyntaxError::new(
            format!("{}{} ({}:{})", prefix, message, point.line, point.offset),
            point.line,
            point.offset,
            point.from,
            point.to,
            details,
        )
    }
}

impl From<LiftoscriptSyntaxError> for PlannerSyntaxError {
    fn from(e: LiftoscriptSyntaxError) -> Self {
        PlannerSyntaxError {
            class: e.class,
            message: e.message,
            line: e.line,
            offset: e.offset,
            from: e.from,
            to: e.to,
            details: e.details,
        }
    }
}
