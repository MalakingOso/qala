use super::*;

#[test]
fn splice_and_index_helpers_follow_js() {
    assert_eq!(splice_start(5, -2.0), 3);
    assert_eq!(splice_start(5, -9.0), 0);
    assert_eq!(splice_start(5, 9.0), 5);
    assert_eq!(splice_start(5, f64::NAN), 0);
    assert_eq!(splice_start(5, 2.7), 2);
    assert_eq!(js_index(-0.0, 3), Some(0));
    assert_eq!(js_index(1.5, 3), None);
    assert_eq!(js_index(-1.0, 3), None);
    assert_eq!(js_index(f64::NAN, 3), None);
    assert_eq!(js_index(3.0, 3), None);
}
