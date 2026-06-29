//! The log store: append-only rows with a level/scope filter, a follow cursor, and size-bounded
//! rotation.

use chrono::Utc;
use rusqlite::{params, params_from_iter, types::Value};

use crate::db::DbError;
use crate::db::database::Db;
use crate::db::sql;

/// Log severity. Serializes for IPC and stores in the `level` column as its lowercase name,
/// ordered debug < info < warn < error so a min-level filter selects that level and every higher
/// one.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize,
)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

impl LogLevel {
    const ORDER: &'static [LogLevel] = &[
        LogLevel::Debug,
        LogLevel::Info,
        LogLevel::Warn,
        LogLevel::Error,
    ];

    fn as_str(self) -> &'static str {
        match self {
            LogLevel::Debug => "debug",
            LogLevel::Info => "info",
            LogLevel::Warn => "warn",
            LogLevel::Error => "error",
        }
    }

    /// This level and every higher one, for the `level IN (...)` filter.
    fn at_or_above(self) -> &'static [LogLevel] {
        &Self::ORDER[self as usize..]
    }
}

impl rusqlite::ToSql for LogLevel {
    fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
        Ok(self.as_str().into())
    }
}

impl rusqlite::types::FromSql for LogLevel {
    fn column_result(value: rusqlite::types::ValueRef<'_>) -> rusqlite::types::FromSqlResult<Self> {
        match value.as_str()? {
            "debug" => Ok(LogLevel::Debug),
            "info" => Ok(LogLevel::Info),
            "warn" => Ok(LogLevel::Warn),
            "error" => Ok(LogLevel::Error),
            _ => Err(rusqlite::types::FromSqlError::InvalidType),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogInsert {
    pub timestamp: String,
    pub level: LogLevel,
    pub scope: String,
    pub message: String,
    pub data: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogRow {
    pub timestamp: String,
    pub level: LogLevel,
    pub scope: String,
    pub message: String,
    pub data: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogRowWithId {
    pub id: u64,
    pub timestamp: String,
    pub level: LogLevel,
    pub scope: String,
    pub message: String,
    pub data: Option<String>,
}

/// The filter shared by the list and the count: a minimum level (matches that level and every
/// higher one) and an optional scope allowlist.
#[derive(Debug, Default, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFilterOpts {
    pub log_level: Option<LogLevel>,
    pub log_scopes: Option<Vec<String>>,
}

#[derive(Debug, Default, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogQueryOpts {
    pub filter: LogFilterOpts,
    pub limit: Option<u32>,
}

fn build_log_where_clause(filter: &LogFilterOpts) -> (String, Vec<Value>) {
    let mut conditions: Vec<String> = Vec::new();
    let mut params: Vec<Value> = Vec::new();
    if let Some(level) = filter.log_level {
        let allowed = level.at_or_above();
        conditions.push(format!("level IN ({})", sql::placeholders(allowed.len())));
        params.extend(allowed.iter().map(|l| Value::Text(l.as_str().to_string())));
    }
    if let Some(scopes) = filter.log_scopes.as_deref()
        && !scopes.is_empty()
    {
        conditions.push(format!("scope IN ({})", sql::placeholders(scopes.len())));
        params.extend(scopes.iter().cloned().map(Value::Text));
    }
    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };
    (where_clause, params)
}

fn log_row_from_db_row(r: &rusqlite::Row) -> rusqlite::Result<LogRow> {
    Ok(LogRow {
        timestamp: r.get("timestamp")?,
        level: r.get("level")?,
        scope: r.get("scope")?,
        message: r.get("message")?,
        data: r.get("data")?,
    })
}

fn log_row_with_id_from_db_row(r: &rusqlite::Row) -> rusqlite::Result<LogRowWithId> {
    Ok(LogRowWithId {
        id: r.get("id")?,
        timestamp: r.get("timestamp")?,
        level: r.get("level")?,
        scope: r.get("scope")?,
        message: r.get("message")?,
        data: r.get("data")?,
    })
}

impl Db {
    /// Appends one log row.
    pub async fn insert_log(&self, entry: &LogInsert) -> Result<(), DbError> {
        let entry = entry.clone();
        self.transaction(move |c| {
            let created_at = Utc::now().timestamp_millis();
            c.execute(
                "INSERT INTO logs (timestamp, level, scope, message, data, createdAt)
                  VALUES (?, ?, ?, ?, ?, ?)",
                params![
                    entry.timestamp,
                    entry.level,
                    entry.scope,
                    entry.message,
                    entry.data,
                    created_at,
                ],
            )?;
            Ok(())
        })
        .await
    }

    /// Appends a batch of log rows with one prepared statement.
    pub async fn insert_many_logs(&self, entries: &[LogInsert]) -> Result<(), DbError> {
        if entries.is_empty() {
            return Ok(());
        }
        let entries = entries.to_vec();
        self.transaction(move |c| {
            let created_at = Utc::now().timestamp_millis();
            let mut stmt = c.prepare(
                "INSERT INTO logs (timestamp, level, scope, message, data, createdAt)
                  VALUES (?, ?, ?, ?, ?, ?)",
            )?;
            for entry in &entries {
                stmt.execute(params![
                    entry.timestamp,
                    entry.level,
                    entry.scope,
                    entry.message,
                    entry.data,
                    created_at,
                ])?;
            }
            Ok(())
        })
        .await
    }

    /// The DISTINCT scopes present in the log table, sorted.
    pub async fn query_available_log_scopes(&self) -> Result<Vec<String>, DbError> {
        self.transaction(move |c| {
            let mut stmt = c.prepare("SELECT DISTINCT scope FROM logs ORDER BY scope")?;
            let out = stmt
                .query_map([], |r| r.get(0))?
                .collect::<rusqlite::Result<Vec<String>>>()?;
            Ok(out)
        })
        .await
    }

    /// Log rows newest-first, filtered by min level and scopes.
    pub async fn query_logs(&self, opts: LogQueryOpts) -> Result<Vec<LogRow>, DbError> {
        let (where_clause, mut params) = build_log_where_clause(&opts.filter);
        let limit_clause = match opts.limit {
            Some(n) => {
                params.push(Value::Integer(i64::from(n)));
                " LIMIT ?"
            }
            None => "",
        };
        let query = format!(
            "SELECT timestamp, level, scope, message, data FROM logs {where_clause} ORDER BY createdAt DESC, id DESC{limit_clause}"
        );
        self.transaction(move |c| {
            let mut stmt = c.prepare(&query)?;
            let out = stmt
                .query_map(params_from_iter(params.iter()), log_row_from_db_row)?
                .collect::<rusqlite::Result<Vec<LogRow>>>()?;
            Ok(out)
        })
        .await
    }

    /// Rows strictly after `since_id` in ascending id order. Ids are AUTOINCREMENT, so a cursor
    /// survives `delete_all_logs`.
    pub async fn query_logs_since_id(
        &self,
        since_id: u64,
        limit: u32,
    ) -> Result<Vec<LogRowWithId>, DbError> {
        self.transaction(move |c| {
            let mut stmt = c.prepare(
                "SELECT id, timestamp, level, scope, message, data FROM logs WHERE id > ? ORDER BY id ASC LIMIT ?",
            )?;
            let out = stmt
                .query_map(params![since_id, limit], log_row_with_id_from_db_row)?
                .collect::<rusqlite::Result<Vec<LogRowWithId>>>()?;
            Ok(out)
        })
        .await
    }

    /// Row count under the same filters as [`query_logs`](Db::query_logs).
    pub async fn count_logs(&self, filter: LogFilterOpts) -> Result<u64, DbError> {
        let (where_clause, params) = build_log_where_clause(&filter);
        let query = format!("SELECT COUNT(*) FROM logs {where_clause}");
        self.transaction(move |c| {
            Ok(c.query_row(&query, params_from_iter(params.iter()), |r| r.get(0))?)
        })
        .await
    }

    /// Clears the log table.
    pub async fn delete_all_logs(&self) -> Result<(), DbError> {
        self.transaction(move |c| {
            c.execute("DELETE FROM logs", [])?;
            Ok(())
        })
        .await
    }

    /// Trims the oldest rows down to `max_logs`, returning the number deleted.
    pub async fn rotate_logs(&self, max_logs: u32) -> Result<u64, DbError> {
        self.transaction(move |c| {
            let count: i64 = c.query_row("SELECT COUNT(*) FROM logs", [], |r| r.get(0))?;
            if count <= i64::from(max_logs) {
                return Ok(0);
            }
            let to_delete = count - i64::from(max_logs);
            let deleted = c.execute(
                r"DELETE FROM logs WHERE id IN (
                      SELECT id FROM logs ORDER BY createdAt ASC, id ASC LIMIT ?
                  )",
                params![to_delete],
            )?;
            Ok(deleted as u64)
        })
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn test_db() -> Db {
        Db::open_in_memory().await.unwrap()
    }

    async fn log_count(db: &Db) -> i64 {
        db.transaction(|c| Ok(c.query_row("SELECT COUNT(*) FROM logs", [], |r| r.get(0))?))
            .await
            .unwrap()
    }

    fn entry(level: LogLevel, scope: &str, created_at: i64) -> LogInsert {
        LogInsert {
            timestamp: format!("t{created_at}"),
            level,
            scope: scope.to_string(),
            message: format!("m{created_at}"),
            data: None,
        }
    }

    // Seed a row with an explicit createdAt (insert_log stamps now(), so ordering/rotation tests
    // that need specific createdAt values write the row directly).
    async fn seed_at(db: &Db, entry: LogInsert, created_at: i64) {
        db.transaction(move |c| {
            c.execute(
                "INSERT INTO logs (timestamp, level, scope, message, data, createdAt)
                  VALUES (?, ?, ?, ?, ?, ?)",
                params![
                    entry.timestamp,
                    entry.level,
                    entry.scope,
                    entry.message,
                    entry.data,
                    created_at,
                ],
            )?;
            Ok(())
        })
        .await
        .unwrap();
    }

    fn filter(level: Option<LogLevel>, scopes: Option<Vec<String>>) -> LogFilterOpts {
        LogFilterOpts {
            log_level: level,
            log_scopes: scopes,
        }
    }

    #[test]
    fn build_log_where_clause_no_opts_yields_empty_where() {
        let (where_clause, params) = build_log_where_clause(&filter(None, None));
        assert_eq!(where_clause, "");
        assert!(params.is_empty());
    }

    #[test]
    fn build_log_where_clause_level_only_expands_to_min_level_and_above() {
        let (where_clause, params) = build_log_where_clause(&filter(Some(LogLevel::Warn), None));
        // warn expands to [warn, error]: two placeholders, no scope clause.
        assert_eq!(where_clause, "WHERE level IN (?, ?)");
        assert_eq!(params.len(), 2);
    }

    #[test]
    fn build_log_where_clause_scopes_only_produces_scope_clause() {
        let scopes = vec!["uploader".to_string(), "syncer".to_string()];
        let (where_clause, params) = build_log_where_clause(&filter(None, Some(scopes)));
        assert_eq!(where_clause, "WHERE scope IN (?, ?)");
        assert_eq!(params.len(), 2);
    }

    #[test]
    fn build_log_where_clause_level_and_scopes_joined_with_and() {
        let scopes = vec!["uploader".to_string()];
        let (where_clause, params) =
            build_log_where_clause(&filter(Some(LogLevel::Info), Some(scopes)));
        // info expands to [info, warn, error] (3) plus 1 scope = 4 params; level clause first.
        assert_eq!(where_clause, "WHERE level IN (?, ?, ?) AND scope IN (?)");
        assert_eq!(params.len(), 4);
    }

    #[test]
    fn build_log_where_clause_empty_scopes_omits_scope_clause() {
        let (where_clause, params) =
            build_log_where_clause(&filter(Some(LogLevel::Error), Some(Vec::new())));
        assert_eq!(where_clause, "WHERE level IN (?)");
        assert_eq!(params.len(), 1);
    }

    #[test]
    fn at_or_above_expands_to_the_level_and_every_higher_one() {
        assert_eq!(
            LogLevel::Info.at_or_above(),
            [LogLevel::Info, LogLevel::Warn, LogLevel::Error]
        );
        assert_eq!(LogLevel::Error.at_or_above(), [LogLevel::Error]);
        assert_eq!(LogLevel::Debug.at_or_above().len(), 4);
    }

    #[test]
    fn log_level_sql_and_serde_forms_are_the_lowercase_name() {
        // ToSql/FromSql and serde must agree on the stored/wire string, or a round-trip drifts.
        assert_eq!(LogLevel::Warn.as_str(), "warn");
        assert_eq!(serde_json::to_string(&LogLevel::Warn).unwrap(), "\"warn\"");
    }

    #[tokio::test]
    async fn query_logs_orders_by_created_at_desc_then_id_desc() {
        let db = test_db().await;
        seed_at(&db, entry(LogLevel::Info, "a", 10), 10).await;
        seed_at(&db, entry(LogLevel::Info, "b", 30), 30).await;
        seed_at(&db, entry(LogLevel::Info, "c", 20), 20).await;
        let rows = db.query_logs(LogQueryOpts::default()).await.unwrap();
        let scopes: Vec<String> = rows.iter().map(|r| r.scope.clone()).collect();
        // Newest createdAt first: 30 (b), 20 (c), 10 (a).
        assert_eq!(scopes, ["b", "c", "a"]);
    }

    #[tokio::test]
    async fn query_logs_same_created_at_breaks_tie_by_id_desc() {
        let db = test_db().await;
        seed_at(&db, entry(LogLevel::Info, "first", 5), 5).await;
        seed_at(&db, entry(LogLevel::Info, "second", 5), 5).await;
        let rows = db.query_logs(LogQueryOpts::default()).await.unwrap();
        let scopes: Vec<String> = rows.iter().map(|r| r.scope.clone()).collect();
        // Equal createdAt: the higher id (the later insert) comes first.
        assert_eq!(scopes, ["second", "first"]);
    }

    #[tokio::test]
    async fn query_logs_applies_limit() {
        let db = test_db().await;
        for i in 0..5 {
            db.insert_log(&entry(LogLevel::Info, "s", i)).await.unwrap();
        }
        let rows = db
            .query_logs(LogQueryOpts {
                limit: Some(2),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(rows.len(), 2);
    }

    #[tokio::test]
    async fn query_logs_level_filter_excludes_below_min() {
        let db = test_db().await;
        seed_at(&db, entry(LogLevel::Debug, "d", 1), 1).await;
        seed_at(&db, entry(LogLevel::Info, "i", 2), 2).await;
        seed_at(&db, entry(LogLevel::Error, "e", 3), 3).await;
        let rows = db
            .query_logs(LogQueryOpts {
                filter: filter(Some(LogLevel::Info), None),
                ..Default::default()
            })
            .await
            .unwrap();
        let levels: Vec<LogLevel> = rows.iter().map(|r| r.level).collect();
        // info filter keeps info and error, excludes debug; ordered createdAt DESC.
        assert_eq!(levels, [LogLevel::Error, LogLevel::Info]);
    }

    #[tokio::test]
    async fn rotate_logs_noop_when_under_max() {
        let db = test_db().await;
        for i in 0..3 {
            db.insert_log(&entry(LogLevel::Info, "s", i)).await.unwrap();
        }
        let deleted = db.rotate_logs(10).await.unwrap();
        assert_eq!(deleted, 0);
        assert_eq!(log_count(&db).await, 3);
    }

    #[tokio::test]
    async fn rotate_logs_deletes_oldest_count_minus_max() {
        let db = test_db().await;
        for i in 0..10 {
            seed_at(&db, entry(LogLevel::Info, "s", i), i).await;
        }
        let deleted = db.rotate_logs(4).await.unwrap();
        // 10 rows, keep 4, so delete the 6 oldest (createdAt ASC, id ASC).
        assert_eq!(deleted, 6);
        assert_eq!(log_count(&db).await, 4);
        // Survivors are the 4 newest createdAt values (6,7,8,9).
        let rows = db.query_logs(LogQueryOpts::default()).await.unwrap();
        let mut survivors: Vec<String> = rows.iter().map(|r| r.timestamp.clone()).collect();
        survivors.sort();
        assert_eq!(survivors, ["t6", "t7", "t8", "t9"]);
    }

    #[tokio::test]
    async fn insert_many_logs_empty_is_noop() {
        let db = test_db().await;
        db.insert_many_logs(&[]).await.unwrap();
        assert_eq!(log_count(&db).await, 0);
    }

    #[tokio::test]
    async fn insert_many_logs_commits_all_rows() {
        let db = test_db().await;
        db.insert_many_logs(&[
            LogInsert {
                timestamp: "ts1".into(),
                level: LogLevel::Warn,
                scope: "uploader".into(),
                message: "msg one".into(),
                data: Some(r#"{"k":1}"#.into()),
            },
            entry(LogLevel::Info, "b", 22),
        ])
        .await
        .unwrap();
        assert_eq!(log_count(&db).await, 2);
        // Per-field read-back: distinct values catch a swapped bind in the batch statement.
        let rows = db.query_logs(LogQueryOpts::default()).await.unwrap();
        let first = rows.iter().find(|r| r.scope == "uploader").unwrap();
        assert_eq!(first.timestamp, "ts1");
        assert_eq!(first.level, LogLevel::Warn);
        assert_eq!(first.message, "msg one");
        assert_eq!(first.data.as_deref(), Some(r#"{"k":1}"#));
    }

    #[tokio::test]
    async fn query_available_log_scopes_dedupes_and_sorts_ascending() {
        let db = test_db().await;
        // Duplicate scopes inserted out of order; expect dedup plus ascending sort.
        db.insert_log(&entry(LogLevel::Info, "uploader", 1))
            .await
            .unwrap();
        db.insert_log(&entry(LogLevel::Info, "syncer", 2))
            .await
            .unwrap();
        db.insert_log(&entry(LogLevel::Info, "uploader", 3))
            .await
            .unwrap();
        db.insert_log(&entry(LogLevel::Info, "auth", 4))
            .await
            .unwrap();
        db.insert_log(&entry(LogLevel::Info, "syncer", 5))
            .await
            .unwrap();
        let scopes = db.query_available_log_scopes().await.unwrap();
        assert_eq!(scopes, ["auth", "syncer", "uploader"]);
    }

    #[tokio::test]
    async fn query_logs_since_id_returns_only_ids_above_cursor_ascending() {
        let db = test_db().await;
        // ids 1..=5 assigned by AUTOINCREMENT in insert order.
        for i in 1..=5 {
            db.insert_log(&entry(LogLevel::Info, "s", i)).await.unwrap();
        }
        // since_id = 2 returns rows with id 3,4,5 in ascending id order.
        let rows = db.query_logs_since_id(2, 100).await.unwrap();
        let ids: Vec<u64> = rows.iter().map(|r| r.id).collect();
        assert_eq!(ids, [3, 4, 5]);
    }

    #[tokio::test]
    async fn query_logs_since_id_limit_caps_result_count() {
        let db = test_db().await;
        for i in 1..=5 {
            db.insert_log(&entry(LogLevel::Info, "s", i)).await.unwrap();
        }
        // since_id = 0 makes all ids eligible, but LIMIT 2 caps to the two lowest.
        let rows = db.query_logs_since_id(0, 2).await.unwrap();
        let ids: Vec<u64> = rows.iter().map(|r| r.id).collect();
        assert_eq!(ids, [1, 2]);
    }

    #[tokio::test]
    async fn count_logs_counts_all_rows_with_no_filter() {
        let db = test_db().await;
        for i in 0..4 {
            db.insert_log(&entry(LogLevel::Info, "s", i)).await.unwrap();
        }
        assert_eq!(db.count_logs(LogFilterOpts::default()).await.unwrap(), 4);
    }

    #[tokio::test]
    async fn count_logs_applies_level_and_scope_filters() {
        let db = test_db().await;
        db.insert_log(&entry(LogLevel::Debug, "uploader", 1))
            .await
            .unwrap();
        db.insert_log(&entry(LogLevel::Info, "uploader", 2))
            .await
            .unwrap();
        db.insert_log(&entry(LogLevel::Warn, "uploader", 3))
            .await
            .unwrap();
        db.insert_log(&entry(LogLevel::Error, "syncer", 4))
            .await
            .unwrap();
        db.insert_log(&entry(LogLevel::Info, "syncer", 5))
            .await
            .unwrap();
        // level=info covers {info,warn,error}; scope=uploader. Matches info/uploader
        // and warn/uploader. (debug/uploader excluded by level; *_/syncer by scope.)
        let count = db
            .count_logs(filter(
                Some(LogLevel::Info),
                Some(vec!["uploader".to_string()]),
            ))
            .await
            .unwrap();
        assert_eq!(count, 2);
    }

    #[tokio::test]
    async fn delete_all_logs_removes_every_row() {
        let db = test_db().await;
        for i in 0..5 {
            db.insert_log(&entry(LogLevel::Info, "s", i)).await.unwrap();
        }
        assert_eq!(log_count(&db).await, 5);
        db.delete_all_logs().await.unwrap();
        assert_eq!(log_count(&db).await, 0);
    }
}
