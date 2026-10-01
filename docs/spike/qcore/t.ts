import {step,sum,am_doc} from "./out/qcore.js"; // needs out/ from the wasm-bindgen step in README.md
console.log(step('{"w":-6.25,"reps":[5,5,3]}'), JS(-6.25/2.5));
function JS(x:number){return Math.round(x)*2.5}
console.log("math.round(-2.5)=",Math.round(-2.5));
const a=new Float64Array(200000).map((_,i)=>i*0.1);
let t=performance.now();for(let i=0;i<20;i++)sum(a);console.log("200k f64 x20 ms",performance.now()-t, sum(a));
console.log("am bytes",am_doc());
