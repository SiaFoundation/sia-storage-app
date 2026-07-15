use std::sync::Arc;

use rusqlite::{Connection, InterruptHandle, Transaction};
use tokio::sync::Mutex;

use crate::db::{DbError, MigrationProgressFn, migrations, runner};

/// The SQLite database: one connection plus a thread-safe interrupt handle.
///
/// [`transaction`](Db::transaction) runs its closure on a blocking thread so the synchronous
/// rusqlite calls never block the async runtime. The connection is behind an async mutex, so
/// concurrent callers wait as parked futures; only the holder occupies a blocking thread.
pub struct Db {
    conn: Arc<Mutex<Connection>>,
    interrupt: InterruptHandle,
}

impl Db {
    /// Open the database at `path`, creating if absent. WAL mode, foreign keys on. Runs any
    /// pending migrations; `on_progress` fires per migration so a startup screen can show
    /// which one is running.
    pub async fn open(
        path: &str,
        on_progress: Option<MigrationProgressFn>,
    ) -> Result<Self, DbError> {
        let path = path.to_string();
        tokio::task::spawn_blocking(move || {
            Self::from_conn(Connection::open(path)?, on_progress.as_ref())
        })
        .await?
    }

    /// Open a private in-memory database with the same pragmas and migrations. For tests and
    /// ephemeral use.
    pub async fn open_in_memory() -> Result<Self, DbError> {
        tokio::task::spawn_blocking(|| Self::from_conn(Connection::open_in_memory()?, None)).await?
    }

    fn from_conn(
        mut conn: Connection,
        on_progress: Option<&MigrationProgressFn>,
    ) -> Result<Self, DbError> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        // Drops the per-commit fsync (the slowest part of a write); the cost is that a
        // full-OS crash can lose the newest commits, though never corrupt the database.
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        // Checkpoint at ~2MB, half the default: bounds the on-disk WAL and keeps each
        // checkpoint's fsync short.
        conn.pragma_update(None, "wal_autocheckpoint", 500)?;
        // Multiple processes share this file: wait up to 5s for a lock instead of
        // failing immediately with SQLITE_BUSY.
        conn.pragma_update(None, "busy_timeout", 5000)?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        // Registers rarray() so `WHERE col IN rarray(?)` can bind an id list as one parameter.
        rusqlite::vtab::array::load_module(&conn)?;
        runner::run_migrations(&mut conn, migrations::CORE_MIGRATIONS, on_progress)?;
        let interrupt = conn.get_interrupt_handle();
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            interrupt,
        })
    }

    /// Abort the statement currently running on the connection, callable from any thread. The
    /// interrupted statement errors, and the open transaction's `Drop` rolls back and releases the
    /// WAL write lock in the same unwind. A no-op when the connection is idle.
    pub fn interrupt(&self) {
        self.interrupt.interrupt();
    }

    /// Runs a closure in one transaction: commits on `Ok`, rolls back on `Err` or panic. Reads and
    /// writes both go through here, so a read-only closure sees a consistent snapshot across its
    /// statements. A caller cancelled while still waiting for the connection never starts; once
    /// the closure is spawned, a dropped future still finishes the transaction on its blocking
    /// thread rather than leaving it open.
    ///
    /// Restricted to `crate::db`: no consumer opens a transaction or holds the connection.
    pub(in crate::db) async fn transaction<T, F>(&self, f: F) -> Result<T, DbError>
    where
        F: FnOnce(&mut Transaction) -> Result<T, DbError> + Send + 'static,
        T: Send + 'static,
    {
        // Acquired before spawn_blocking: waiters park as futures, and only the
        // lock holder occupies a blocking-pool thread.
        let mut guard = self.conn.clone().lock_owned().await;
        tokio::task::spawn_blocking(move || {
            let mut tx = guard.transaction()?;
            let value = f(&mut tx)?;
            tx.commit()?;
            Ok(value)
        })
        .await?
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn seeded() -> Db {
        let db = Db::open_in_memory().await.unwrap();
        db.transaction(|tx| {
            tx.execute_batch("CREATE TABLE t (id TEXT)")?;
            Ok(())
        })
        .await
        .unwrap();
        db
    }

    async fn ids(db: &Db) -> Vec<String> {
        db.transaction(|tx| {
            let mut stmt = tx.prepare("SELECT id FROM t ORDER BY id")?;
            let rows = stmt.query_map([], |r| r.get(0))?;
            Ok(rows.collect::<rusqlite::Result<Vec<String>>>()?)
        })
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn commits_on_ok() {
        let db = seeded().await;
        db.transaction(|tx| {
            tx.execute("INSERT INTO t (id) VALUES ('a')", [])?;
            Ok(())
        })
        .await
        .unwrap();
        assert_eq!(ids(&db).await, ["a"]);
    }

    #[tokio::test]
    async fn rolls_back_the_whole_unit_on_error() {
        let db = seeded().await;
        let r = db
            .transaction(|tx| {
                tx.execute("INSERT INTO t (id) VALUES ('a')", [])?;
                Err::<(), DbError>("boom".into())
            })
            .await;
        assert!(r.is_err());
        assert!(
            ids(&db).await.is_empty(),
            "the failed unit left nothing behind"
        );
    }

    #[tokio::test]
    async fn savepoint_rolls_back_only_its_substep() {
        let db = seeded().await;
        db.transaction(|tx| {
            tx.execute("INSERT INTO t (id) VALUES ('a')", [])?;
            let sp = tx.savepoint()?;
            sp.execute("INSERT INTO t (id) VALUES ('b')", [])?;
            drop(sp); // no commit -> ROLLBACK TO, undoing 'b' but not the outer 'a'
            Ok(())
        })
        .await
        .unwrap();
        assert_eq!(ids(&db).await, ["a"]);
    }

    // Concurrent transactions serialize on the connection; both land.
    #[tokio::test]
    async fn concurrent_transactions_serialize() {
        let db = std::sync::Arc::new(seeded().await);
        let a = {
            let db = db.clone();
            tokio::spawn(async move {
                db.transaction(|tx| {
                    tx.execute("INSERT INTO t (id) VALUES ('a')", [])?;
                    Ok(())
                })
                .await
            })
        };
        let b = {
            let db = db.clone();
            tokio::spawn(async move {
                db.transaction(|tx| {
                    tx.execute("INSERT INTO t (id) VALUES ('b')", [])?;
                    Ok(())
                })
                .await
            })
        };
        a.await.unwrap().unwrap();
        b.await.unwrap().unwrap();
        assert_eq!(ids(&db).await, ["a", "b"]);
    }
}
