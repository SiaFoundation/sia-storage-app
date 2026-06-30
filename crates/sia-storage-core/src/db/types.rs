use rusqlite::Connection;

use crate::db::DbError;

/// A schema migration. `up` runs the migration's statements; the runner wraps them in a
/// transaction and records the id. `parent` is the id of the migration this one builds on
/// (`None` for the first). The runner checks each pending migration's `parent` against the
/// applied head, so a migration can only ever run in its one intended position, never out of
/// order. Internal: an app opens a database via `Db::open`, it never touches migrations.
pub(crate) struct Migration {
    pub id: &'static str,
    pub description: &'static str,
    pub parent: Option<&'static str>,
    pub up: fn(&Connection) -> Result<(), DbError>,
}

/// Migration progress: fired as each pending migration starts, carrying its position
/// (`index` of `total`, 1-based, counting only this run's pending set), so a startup
/// screen can show "running migration 2 of 3". A migration is one opaque SQL batch, so
/// there is no finer-grained progress within one.
#[derive(Debug, Clone, Copy)]
pub struct MigrationProgress<'a> {
    pub id: &'a str,
    pub description: &'a str,
    pub index: usize,
    pub total: usize,
}

/// Progress callback for [`MigrationProgress`]. Runs on the blocking thread that applies
/// the migrations, so it must not block on the async runtime.
pub type MigrationProgressFn = Box<dyn Fn(MigrationProgress<'_>) + Send>;
