use rusqlite::Connection;

use crate::db::DbError;

/// A schema migration. `up` runs the migration's statements; the runner wraps them in a transaction.
#[derive(Clone)]
pub struct Migration {
    pub id: String,
    pub description: String,
    pub up: fn(&Connection) -> Result<(), DbError>,
}
