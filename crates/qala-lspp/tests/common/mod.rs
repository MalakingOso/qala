//! Shared loader for the built-in program goldens.
#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};

use qala_lspp::types::ISettings;
use serde_json::Value;

pub fn golden_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../testdata/golden/liftoscript")
}

pub struct Program {
    /// `builtins/<id>.json` or `builtins_kg/<id>.json`.
    pub file: String,
    pub text: String,
    pub name: String,
    pub settings: ISettings,
}

/// Every built-in program: the 60 in `builtins/` and the kg variants in `builtins_kg/`.
pub fn programs() -> Vec<Program> {
    let mut out = vec![];
    for dir in ["builtins", "builtins_kg"] {
        let mut files: Vec<_> = fs::read_dir(golden_dir().join(dir)).unwrap().map(|e| e.unwrap().path()).collect();
        files.sort();
        for f in files {
            let doc: Value = serde_json::from_str(&fs::read_to_string(&f).unwrap()).unwrap();
            let case = doc["cases"].as_array().unwrap().iter().find(|c| c["fn"] == "forceEvaluateText").unwrap();
            let inp = &case["inputs"];
            out.push(Program {
                file: format!("{dir}/{}", f.file_name().unwrap().to_string_lossy()),
                text: inp["programText"].as_str().unwrap().to_string(),
                name: inp["name"].as_str().unwrap().to_string(),
                settings: serde_json::from_value(inp["settings"].clone()).unwrap(),
            });
        }
    }
    out
}
