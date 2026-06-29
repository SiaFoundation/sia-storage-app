//! Small SQL utilities. Statements are written out at their call sites; these only cover what a
//! literal can't say: binding an id list to `rarray`, escaping LIKE patterns, and placeholder
//! lists for the rare `IN (...)` that can't use `rarray`.

use std::rc::Rc;

use rusqlite::types::Value;

/// `?, ?, ?` for `n` slots, for an `IN (...)` list whose params mix with other bind values.
pub fn placeholders(n: usize) -> String {
    std::iter::repeat_n("?", n).collect::<Vec<_>>().join(", ")
}

/// The given ids as one array value bindable to `rarray(?)`, for `WHERE col IN rarray(?)`. The
/// connection must be opened through [`Db`](super::database::Db), which registers the `rarray` module.
pub fn id_array(ids: &[String]) -> Rc<Vec<Value>> {
    Rc::new(ids.iter().map(|s| Value::Text(s.clone())).collect())
}

/// Escape `%`, `_`, and `\` for a `LIKE ? ESCAPE '\'` pattern.
pub fn escape_like_pattern(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if matches!(c, '%' | '_' | '\\') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escape_like_pattern_escapes_wildcards_and_backslash() {
        assert_eq!(escape_like_pattern("normal"), "normal");
        assert_eq!(escape_like_pattern("50%_off"), "50\\%\\_off");
        assert_eq!(escape_like_pattern("a\\b"), "a\\\\b");
    }

    #[test]
    fn id_array_filters_an_in_clause() {
        let c = rusqlite::Connection::open_in_memory().unwrap();
        rusqlite::vtab::array::load_module(&c).unwrap();
        c.execute_batch("CREATE TABLE t (id TEXT PRIMARY KEY)")
            .unwrap();
        for id in ["a", "b", "c"] {
            c.execute("INSERT INTO t (id) VALUES (?)", rusqlite::params![id])
                .unwrap();
        }
        let ids = vec!["a".to_string(), "c".to_string()];
        let mut stmt = c
            .prepare("SELECT id FROM t WHERE id IN rarray(?) ORDER BY id")
            .unwrap();
        let got: Vec<String> = stmt
            .query_map([id_array(&ids)], |r| r.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(got, ["a", "c"]);
    }
}
