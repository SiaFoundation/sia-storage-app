//! Small helpers for building dynamic SQL (variable column sets, `IN (...)` lists) against a
//! `rusqlite::Connection`. Fixed-shape queries use rusqlite directly; these only earn their place
//! where the column or value count is decided at runtime.

use std::rc::Rc;

use rusqlite::types::Value;
use rusqlite::{Connection, params_from_iter};

use crate::db::DbError;

/// The outcome of a write statement.
#[derive(Debug, Clone, Copy)]
pub struct SqlRunResult {
    pub changes: i64,
    pub last_insert_row_id: i64,
}

/// `?, ?, ?` for `n` slots, for an INSERT `VALUES (...)` row.
pub fn placeholders(n: usize) -> String {
    std::iter::repeat_n("?", n).collect::<Vec<_>>().join(", ")
}

/// The given ids as bindable text values for an `IN (?, ?, ...)` list.
pub fn text_params(ids: &[String]) -> Vec<Value> {
    ids.iter().cloned().map(Value::Text).collect()
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

#[derive(Debug, Clone, Copy)]
pub enum InsertConflictClause {
    OrRollback,
    OrAbort,
    OrReplace,
    OrFail,
    OrIgnore,
}

impl InsertConflictClause {
    fn as_str(self) -> &'static str {
        match self {
            InsertConflictClause::OrRollback => "OR ROLLBACK",
            InsertConflictClause::OrAbort => "OR ABORT",
            InsertConflictClause::OrReplace => "OR REPLACE",
            InsertConflictClause::OrFail => "OR FAIL",
            InsertConflictClause::OrIgnore => "OR IGNORE",
        }
    }
}

#[derive(Debug, Clone)]
pub struct UpsertOptions {
    pub conflict_column: &'static str,
    pub update_columns: Vec<&'static str>,
}

fn insert_verb(conflict: Option<InsertConflictClause>) -> String {
    match conflict {
        Some(c) => format!("INSERT {}", c.as_str()),
        None => "INSERT".into(),
    }
}

fn column_list(row: &[(&'static str, Value)]) -> String {
    row.iter().map(|(c, _)| *c).collect::<Vec<_>>().join(", ")
}

/// The bound values of a `(column, value)` row, in order. NULL binds like any value.
fn row_params<'a>(row: &'a [(&'static str, Value)]) -> Vec<&'a Value> {
    row.iter().map(|(_, v)| v).collect()
}

pub fn insert(
    conn: &Connection,
    table: &str,
    row: Vec<(&'static str, Value)>,
    conflict: Option<InsertConflictClause>,
) -> Result<SqlRunResult, DbError> {
    let sql = format!(
        "{} INTO {} ({}) VALUES ({})",
        insert_verb(conflict),
        table,
        column_list(&row),
        placeholders(row.len()),
    );
    let changes = conn.execute(&sql, params_from_iter(row_params(&row)))?;
    Ok(SqlRunResult {
        changes: changes as i64,
        last_insert_row_id: conn.last_insert_rowid(),
    })
}

pub fn insert_many(
    conn: &Connection,
    table: &str,
    rows: Vec<Vec<(&'static str, Value)>>,
    conflict: Option<InsertConflictClause>,
) -> Result<(), DbError> {
    let Some(first) = rows.first() else {
        return Ok(());
    };
    let sql = format!(
        "{} INTO {} ({}) VALUES ({})",
        insert_verb(conflict),
        table,
        column_list(first),
        placeholders(first.len()),
    );
    let mut stmt = conn.prepare(&sql)?;
    for row in &rows {
        stmt.execute(params_from_iter(row_params(row)))?;
    }
    Ok(())
}

pub fn upsert_many(
    conn: &Connection,
    table: &str,
    rows: Vec<Vec<(&'static str, Value)>>,
    options: UpsertOptions,
) -> Result<(), DbError> {
    let Some(first) = rows.first() else {
        return Ok(());
    };
    let update_clause = options
        .update_columns
        .iter()
        .map(|c| format!("{c} = excluded.{c}"))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "INSERT INTO {} ({}) VALUES ({}) ON CONFLICT({}) DO UPDATE SET {}",
        table,
        column_list(first),
        placeholders(first.len()),
        options.conflict_column,
        update_clause,
    );
    let mut stmt = conn.prepare(&sql)?;
    for row in &rows {
        stmt.execute(params_from_iter(row_params(row)))?;
    }
    Ok(())
}

pub fn run(conn: &Connection, sql: &str, params: Vec<Value>) -> Result<SqlRunResult, DbError> {
    let changes = conn.execute(sql, params_from_iter(params.iter()))?;
    Ok(SqlRunResult {
        changes: changes as i64,
        last_insert_row_id: conn.last_insert_rowid(),
    })
}

/// `col = ?` assignment list and its bound values.
fn build_assignments(fields: Vec<(&'static str, Value)>) -> (String, Vec<Value>) {
    let mut parts = Vec::with_capacity(fields.len());
    let mut params = Vec::with_capacity(fields.len());
    for (col, value) in fields {
        parts.push(format!("{col} = ?"));
        params.push(value);
    }
    (parts.join(", "), params)
}

/// ` WHERE col = ? AND col IS NULL ...`, or empty when there are no conditions.
fn build_where(conditions: Vec<(&'static str, Value)>) -> (String, Vec<Value>) {
    if conditions.is_empty() {
        return (String::new(), Vec::new());
    }
    let mut parts = Vec::with_capacity(conditions.len());
    let mut params = Vec::new();
    for (col, value) in conditions {
        if matches!(value, Value::Null) {
            parts.push(format!("{col} IS NULL"));
        } else {
            parts.push(format!("{col} = ?"));
            params.push(value);
        }
    }
    (format!(" WHERE {}", parts.join(" AND ")), params)
}

pub fn update(
    conn: &Connection,
    table: &str,
    fields: Vec<(&'static str, Value)>,
    conditions: Vec<(&'static str, Value)>,
) -> Result<SqlRunResult, DbError> {
    let (assignments, mut params) = build_assignments(fields);
    if assignments.is_empty() {
        return Ok(SqlRunResult {
            changes: 0,
            last_insert_row_id: 0,
        });
    }
    let (where_clause, where_params) = build_where(conditions);
    params.extend(where_params);
    let sql = format!("UPDATE {table} SET {assignments}{where_clause}");
    let changes = conn.execute(&sql, params_from_iter(params.iter()))?;
    Ok(SqlRunResult {
        changes: changes as i64,
        last_insert_row_id: conn.last_insert_rowid(),
    })
}

pub fn del(
    conn: &Connection,
    table: &str,
    conditions: Vec<(&'static str, Value)>,
) -> Result<SqlRunResult, DbError> {
    let (where_clause, params) = build_where(conditions);
    let sql = format!("DELETE FROM {table}{where_clause}");
    let changes = conn.execute(&sql, params_from_iter(params.iter()))?;
    Ok(SqlRunResult {
        changes: changes as i64,
        last_insert_row_id: conn.last_insert_rowid(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER, note TEXT)")
            .unwrap();
        c
    }

    fn rows(c: &Connection) -> Vec<(String, Option<i64>, Option<String>)> {
        let mut stmt = c.prepare("SELECT id, n, note FROM t ORDER BY id").unwrap();
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
    }

    #[test]
    fn escape_like_pattern_escapes_wildcards_and_backslash() {
        assert_eq!(escape_like_pattern("normal"), "normal");
        assert_eq!(escape_like_pattern("50%_off"), "50\\%\\_off");
        assert_eq!(escape_like_pattern("a\\b"), "a\\\\b");
    }

    #[test]
    fn insert_binds_null_values() {
        let c = conn();
        insert(
            &c,
            "t",
            vec![
                ("id", Value::Text("a".into())),
                ("n", Value::Integer(1)),
                ("note", Value::Null),
            ],
            None,
        )
        .unwrap();
        assert_eq!(rows(&c), [("a".to_string(), Some(1), None)]);
    }

    #[test]
    fn insert_with_or_ignore_skips_a_conflict() {
        let c = conn();
        let row = || {
            vec![
                ("id", Value::Text("a".into())),
                ("n", Value::Integer(1)),
                ("note", Value::Null),
            ]
        };
        insert(&c, "t", row(), None).unwrap();
        insert(&c, "t", row(), Some(InsertConflictClause::OrIgnore)).unwrap();
        assert_eq!(rows(&c).len(), 1);
    }

    #[test]
    fn insert_many_empty_is_noop() {
        let c = conn();
        insert_many(&c, "t", vec![], None).unwrap();
        assert!(rows(&c).is_empty());
    }

    #[test]
    fn upsert_many_updates_listed_columns_on_conflict() {
        let c = conn();
        let row = |n: i64| {
            vec![
                ("id", Value::Text("a".into())),
                ("n", Value::Integer(n)),
                ("note", Value::Null),
            ]
        };
        let opts = || UpsertOptions {
            conflict_column: "id",
            update_columns: vec!["n"],
        };
        upsert_many(&c, "t", vec![row(1)], opts()).unwrap();
        upsert_many(&c, "t", vec![row(2)], opts()).unwrap();
        assert_eq!(rows(&c), [("a".to_string(), Some(2), None)]);
    }

    #[test]
    fn update_sets_fields_and_clears_to_null() {
        let c = conn();
        insert(
            &c,
            "t",
            vec![
                ("id", Value::Text("a".into())),
                ("n", Value::Integer(1)),
                ("note", Value::Text("hi".into())),
            ],
            None,
        )
        .unwrap();
        let res = update(
            &c,
            "t",
            vec![("n", Value::Integer(9)), ("note", Value::Null)],
            vec![("id", Value::Text("a".into()))],
        )
        .unwrap();
        assert_eq!(res.changes, 1);
        assert_eq!(rows(&c), [("a".to_string(), Some(9), None)]);
    }

    #[test]
    fn del_with_none_clears_the_table() {
        let c = conn();
        insert(
            &c,
            "t",
            vec![
                ("id", Value::Text("a".into())),
                ("n", Value::Null),
                ("note", Value::Null),
            ],
            None,
        )
        .unwrap();
        del(&c, "t", vec![]).unwrap();
        assert!(rows(&c).is_empty());
    }

    #[test]
    fn del_with_conditions_removes_only_matching() {
        let c = conn();
        for id in ["a", "b"] {
            insert(
                &c,
                "t",
                vec![
                    ("id", Value::Text(id.into())),
                    ("n", Value::Null),
                    ("note", Value::Null),
                ],
                None,
            )
            .unwrap();
        }
        del(&c, "t", vec![("id", Value::Text("a".into()))]).unwrap();
        assert_eq!(
            rows(&c).iter().map(|r| r.0.as_str()).collect::<Vec<_>>(),
            ["b"]
        );
    }

    #[test]
    fn del_with_null_condition_matches_only_null_rows() {
        let c = conn();
        insert(
            &c,
            "t",
            vec![
                ("id", Value::Text("a".into())),
                ("n", Value::Null),
                ("note", Value::Null),
            ],
            None,
        )
        .unwrap();
        insert(
            &c,
            "t",
            vec![
                ("id", Value::Text("b".into())),
                ("n", Value::Integer(1)),
                ("note", Value::Null),
            ],
            None,
        )
        .unwrap();
        del(&c, "t", vec![("n", Value::Null)]).unwrap();
        assert_eq!(
            rows(&c).iter().map(|r| r.0.as_str()).collect::<Vec<_>>(),
            ["b"]
        );
    }

    #[test]
    fn update_with_empty_fields_is_a_noop() {
        let c = conn();
        insert(
            &c,
            "t",
            vec![
                ("id", Value::Text("a".into())),
                ("n", Value::Integer(1)),
                ("note", Value::Null),
            ],
            None,
        )
        .unwrap();
        let res = update(&c, "t", vec![], vec![("id", Value::Text("a".into()))]).unwrap();
        assert_eq!(res.changes, 0);
        assert_eq!(rows(&c), [("a".to_string(), Some(1), None)]);
    }

    #[test]
    fn insert_many_inserts_every_row() {
        let c = conn();
        let batch = ["a", "b", "c"]
            .iter()
            .map(|id| {
                vec![
                    ("id", Value::Text((*id).into())),
                    ("n", Value::Integer(1)),
                    ("note", Value::Null),
                ]
            })
            .collect();
        insert_many(&c, "t", batch, None).unwrap();
        assert_eq!(rows(&c).len(), 3);
    }

    #[test]
    fn id_array_filters_an_in_clause() {
        let c = conn();
        rusqlite::vtab::array::load_module(&c).unwrap();
        for id in ["a", "b", "c"] {
            insert(
                &c,
                "t",
                vec![
                    ("id", Value::Text(id.into())),
                    ("n", Value::Null),
                    ("note", Value::Null),
                ],
                None,
            )
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
