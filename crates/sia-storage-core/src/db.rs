//! The SQLite layer: the [`Db`](database::Db) handle and a few SQL utilities. Operations take a
//! `&Connection` (reads and writes) or `&mut Transaction` (to open a savepoint) and run inside
//! the transaction that `Db::transaction` opens for them.

pub mod database;
pub mod sql;

/// A database-layer error: a SQLite failure, a blocking-thread join failure, or an ad-hoc message.
#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
    #[error(transparent)]
    Join(#[from] tokio::task::JoinError),
    #[error("{0}")]
    Message(String),
}

impl From<&str> for DbError {
    fn from(s: &str) -> Self {
        DbError::Message(s.to_string())
    }
}

impl From<String> for DbError {
    fn from(s: String) -> Self {
        DbError::Message(s)
    }
}
