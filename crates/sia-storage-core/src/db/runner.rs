use rusqlite::Connection;
use tracing::{debug, info};

use crate::db::DbError;
use crate::db::types::{Migration, MigrationProgress, MigrationProgressFn};

/// Apply every not-yet-applied migration in chain order, each in its own transaction, recording
/// its id. Idempotent: already-applied ids are skipped.
///
/// Two invariants make out-of-order execution impossible rather than merely unlikely: the applied
/// migrations must form an unbroken prefix of the chain, and each pending migration's `parent`
/// must equal the current applied head. So a migration can only ever run immediately after the one
/// it declares it builds on; a mid-list insert, or a database that already ran a later migration,
/// errors loudly instead of silently running against the wrong schema. A failing migration rolls
/// back and is left unrecorded, so the next run retries it.
pub(crate) fn run_migrations(
    conn: &mut Connection,
    migrations: &[Migration],
    on_progress: Option<&MigrationProgressFn>,
) -> Result<(), DbError> {
    debug!(target: "db", "checking_migrations");
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY, appliedAt INTEGER NOT NULL);",
    )?;
    let applied: std::collections::HashSet<String> = {
        let mut stmt = conn.prepare("SELECT id FROM migrations")?;
        let ids = stmt.query_map([], |r| r.get::<_, String>(0))?;
        ids.collect::<rusqlite::Result<_>>()?
    };

    // The applied set must be an unbroken prefix of the chain: walk in order, and once we reach
    // the first unapplied migration, nothing after it may be applied. An applied migration behind
    // an unapplied one means the database ran migrations out of order (a corrupt or downgraded
    // DB); refuse rather than "repair" it into a worse state.
    let mut head: Option<&'static str> = None;
    let mut pending_from: Option<usize> = None;
    for (i, m) in migrations.iter().enumerate() {
        if applied.contains(m.id) {
            if pending_from.is_some() {
                return Err(DbError::Message(format!(
                    "migration {} is applied but an earlier migration is not; \
                     the database is in an inconsistent state",
                    m.id
                )));
            }
            head = Some(m.id);
        } else if pending_from.is_none() {
            pending_from = Some(i);
        }
    }

    let pending = &migrations[pending_from.unwrap_or(migrations.len())..];
    if !pending.is_empty() {
        info!(target: "db", count = pending.len(), "migrations_pending");
    }
    for (offset, m) in pending.iter().enumerate() {
        // A migration may only attach to the current head. This is what makes out-of-order
        // execution unrepresentable, not just detectable.
        if m.parent != head {
            return Err(DbError::Message(format!(
                "migration {} expects parent {:?} but the applied head is {:?}",
                m.id, m.parent, head
            )));
        }
        info!(target: "db", id = m.id, description = m.description, "applying_migration");
        if let Some(f) = on_progress {
            f(MigrationProgress {
                id: m.id,
                description: m.description,
                index: offset + 1,
                total: pending.len(),
            });
        }
        let tx = conn.transaction()?;
        (m.up)(&tx)?;
        tx.execute(
            "INSERT INTO migrations (id, appliedAt) VALUES (?, ?)",
            rusqlite::params![m.id, chrono::Utc::now().timestamp_millis()],
        )?;
        tx.commit()?;
        head = Some(m.id);
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

    fn chain() -> [Migration; 2] {
        [
            Migration {
                id: "0001",
                description: "a",
                parent: None,
                up: create_a,
            },
            Migration {
                id: "0002",
                description: "b",
                parent: Some("0001"),
                up: create_b,
            },
        ]
    }

    fn migration_count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM migrations", [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn applies_pending_in_order_and_is_idempotent() {
        let migrations = chain();
        let mut conn = Connection::open_in_memory().unwrap();
        run_migrations(&mut conn, &migrations, None).unwrap();
        run_migrations(&mut conn, &migrations, None).unwrap();
        assert_eq!(migration_count(&conn), 2);
        assert!(
            conn.execute_batch("SELECT x FROM a; SELECT x FROM b;")
                .is_ok()
        );
    }

    #[test]
    fn progress_fires_once_per_pending_migration_only() {
        let migrations = chain();
        let mut conn = Connection::open_in_memory().unwrap();
        run_migrations(&mut conn, &migrations[..1], None).unwrap();

        // 0001 is already applied, so a full run reports only 0002, as 1 of 1.
        let events = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink = events.clone();
        let on_progress: crate::db::MigrationProgressFn = Box::new(move |p| {
            sink.lock()
                .unwrap()
                .push((p.id.to_string(), p.index, p.total));
        });
        run_migrations(&mut conn, &migrations, Some(&on_progress)).unwrap();
        assert_eq!(*events.lock().unwrap(), [("0002".to_string(), 1, 1)]);
    }

    #[test]
    fn a_failing_migration_rolls_back_and_is_not_recorded() {
        fn bad(c: &Connection) -> Result<(), DbError> {
            c.execute_batch("CREATE TABLE a (x INTEGER)")?;
            Err("boom".into())
        }
        let migrations = [Migration {
            id: "0001",
            description: "bad",
            parent: None,
            up: bad,
        }];
        let mut conn = Connection::open_in_memory().unwrap();
        assert!(run_migrations(&mut conn, &migrations, None).is_err());
        assert!(
            conn.execute_batch("SELECT x FROM a").is_err(),
            "table a rolled back"
        );
        assert_eq!(migration_count(&conn), 0);
    }

    // A migration whose parent isn't the current head can't run: it errors rather than applying
    // against a schema state it wasn't written for.
    #[test]
    fn a_migration_whose_parent_is_not_the_head_is_rejected() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_migrations(&mut conn, &chain()[..1], None).unwrap(); // head = 0001
        let bad_chain = [
            Migration {
                id: "0001",
                description: "a",
                parent: None,
                up: create_a,
            },
            // 0003 claims to build on 0002, which was never applied.
            Migration {
                id: "0003",
                description: "c",
                parent: Some("0002"),
                up: create_b,
            },
        ];
        let err = run_migrations(&mut conn, &bad_chain, None).unwrap_err();
        assert!(format!("{err}").contains("expects parent"));
    }

    // A database that already ran a later migration but is missing an earlier one is refused,
    // not silently repaired.
    #[test]
    fn a_gap_in_the_applied_prefix_is_rejected() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE migrations (id TEXT PRIMARY KEY, appliedAt INTEGER NOT NULL);
             INSERT INTO migrations (id, appliedAt) VALUES ('0002', 0);",
        )
        .unwrap();
        let err = run_migrations(&mut conn, &chain(), None).unwrap_err();
        assert!(format!("{err}").contains("inconsistent state"));
    }
}
