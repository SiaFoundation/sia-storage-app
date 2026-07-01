use rusqlite::Connection;
use tracing::{debug, info};

use crate::db::DbError;
use crate::db::types::Migration;

/// Apply every not-yet-applied migration in order, each in its own transaction, recording its id in
/// the `migrations` table. Idempotent: already-applied ids are skipped. A failing migration rolls
/// back and is left unrecorded, so the next run retries it.
pub fn run_migrations(conn: &mut Connection, migrations: &[Migration]) -> Result<(), DbError> {
    debug!(target: "db", "checking_migrations");
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY, appliedAt INTEGER NOT NULL);",
    )?;
    let applied: std::collections::HashSet<String> = {
        let mut stmt = conn.prepare("SELECT id FROM migrations")?;
        let ids = stmt.query_map([], |r| r.get::<_, String>(0))?;
        ids.collect::<rusqlite::Result<_>>()?
    };
    let pending = migrations
        .iter()
        .filter(|m| !applied.contains(&m.id))
        .count();
    if pending > 0 {
        info!(target: "db", count = pending, "migrations_pending");
    }
    for m in migrations {
        if applied.contains(&m.id) {
            continue;
        }
        info!(target: "db", id = %m.id, description = %m.description, "applying_migration");
        let tx = conn.transaction()?;
        (m.up)(&tx)?;
        tx.execute(
            "INSERT INTO migrations (id, appliedAt) VALUES (?, ?)",
            rusqlite::params![m.id, chrono::Utc::now().timestamp_millis()],
        )?;
        tx.commit()?;
    }
    info!(target: "db", "migrations_complete");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_a(c: &Connection) -> Result<(), DbError> {
        c.execute_batch("CREATE TABLE a (x INTEGER)")?;
        Ok(())
    }
    fn create_b(c: &Connection) -> Result<(), DbError> {
        c.execute_batch("CREATE TABLE b (x INTEGER)")?;
        Ok(())
    }

    fn migration(id: &str, up: fn(&Connection) -> Result<(), DbError>) -> Migration {
        Migration {
            id: id.into(),
            description: id.into(),
            up,
        }
    }

    fn migration_count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM migrations", [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn applies_pending_in_order_and_is_idempotent() {
        let migrations = [migration("0001", create_a), migration("0002", create_b)];
        let mut conn = Connection::open_in_memory().unwrap();
        run_migrations(&mut conn, &migrations).unwrap();
        run_migrations(&mut conn, &migrations).unwrap();
        assert_eq!(migration_count(&conn), 2);
        assert!(
            conn.execute_batch("SELECT x FROM a; SELECT x FROM b;")
                .is_ok()
        );
    }

    #[test]
    fn a_failing_migration_rolls_back_and_is_not_recorded() {
        fn bad(c: &Connection) -> Result<(), DbError> {
            c.execute_batch("CREATE TABLE a (x INTEGER)")?;
            Err("boom".into())
        }
        let mut conn = Connection::open_in_memory().unwrap();
        assert!(run_migrations(&mut conn, &[migration("0001", bad)]).is_err());
        assert!(
            conn.execute_batch("SELECT x FROM a").is_err(),
            "table a rolled back"
        );
        assert_eq!(migration_count(&conn), 0);
    }
}
