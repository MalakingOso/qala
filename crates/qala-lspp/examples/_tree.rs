use qala_lspp::planner_parse::{parse, Node};
fn dump(n: &Node, out: &mut Vec<String>) {
    out.push(format!("{}[{},{}]", n.name(), n.from, n.to));
    for c in n.children() { dump(c, out); }
}
fn main() {
    for a in std::env::args().skip(1) {
        let t = parse(&a);
        let mut v = vec![]; dump(&t, &mut v);
        println!("{:?} {}", a, v.join(" "));
    }
}
