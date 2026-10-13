use serde::{Deserialize,Serialize};
#[derive(Serialize,Deserialize)]
pub struct St{pub w:f64,pub reps:Vec<f64>}
pub fn step_json(s:&str)->String{
  let mut st:St=serde_json::from_str(s).unwrap();
  st.w=(st.w/2.5).round()*2.5; st.reps.push(st.reps.iter().sum::<f64>());
  serde_json::to_string(&st).unwrap()
}
pub fn sum_fixes(v:&[f64])->f64{v.iter().sum()}
#[cfg(feature="wasm")]
mod w{use wasm_bindgen::prelude::*;
#[wasm_bindgen] pub fn step(s:&str)->String{super::step_json(s)}
#[wasm_bindgen] pub fn sum(v:&[f64])->f64{super::sum_fixes(v)}
#[cfg(feature="am")]
#[wasm_bindgen] pub fn am_doc()->usize{use automerge::{AutoCommit,transaction::Transactable,ROOT};let mut d=AutoCommit::new();d.put(ROOT,"a",1).unwrap();d.save().len()}}
#[cfg(feature="ffi")]
uniffi::setup_scaffolding!();
#[cfg(feature="ffi")]
#[uniffi::export] pub fn step(s:String)->String{step_json(&s)}
#[cfg(feature="ffi")]
#[uniffi::export] pub fn sum(v:Vec<f64>)->f64{sum_fixes(&v)}
#[cfg(test)]
mod t{#[test]fn r(){assert_eq!((-2.5f64).round(),-3.0);assert_eq!((0.5f64).round(),1.0);assert_eq!((2.5f64).round(),3.0);
 // JS Math.round(-2.5) === -2 ; rust gives -3
 }}
