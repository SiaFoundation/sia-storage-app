use std::sync::Arc;

use parking_lot::Mutex;
use rusqlite::{Connection, InterruptHandle, Transaction};

use crate::db::DbError;

/// The SQLite database: one writer connection plus a thread-safe interrupt handle.
///
/// [`write`](Db::write) and [`read`](Db::read) run their closures on a blocking thread so the
/// synchronous rusqlite calls never block the async runtime.
pub struct Db {
    conn: Arc<Mutex<Connection>>,
    interrupt: InterruptHandle,
}

impl Db {
    /// Open the database at `path`, creating if absent. WAL mode, foreign keys on.
    pub fn open(path: &str) -> Result<Self, DbError> {
        Self::from_conn(Connection::open(path)?)
    }

    /// Open a private in-memory database with the same pragmas. For tests and ephemeral use.
    pub fn open_in_memory() -> Result<Self, DbError> {
        Self::from_conn(Connection::open_in_memory()?)
    }

    fn from_conn(conn: Connection) -> Result<Self, DbError> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        // Registers rarray() so `WHERE col IN rarray(?)` can bind an id list as one parameter.
        rusqlite::vtab::array::load_module(&conn)?;
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

    /// Run a write closure in one transaction. Commits on `Ok`, rolls back on `Err` or panic. If the
    /// returned future is dropped the transaction still finishes on its blocking thread rather than
    /// being left open.
    pub async fn write<T, F>(&self, f: F) -> Result<T, DbError>
    where
        F: FnOnce(&mut Transaction) -> Result<T, DbError> + Send + 'static,
        T: Send + 'static,
    {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            let mut guard = conn.lock();
            let mut tx = guard.transaction()?;
            let value = f(&mut tx)?;
            tx.commit()?;
            Ok(value)
        })
        .await?
    }

    /// Run a read closure off the async runtime. Opens no transaction.
    pub async fn read<T, F>(&self, f: F) -> Result<T, DbError>
    where
        F: FnOnce(&Connection) -> Result<T, DbError> + Send + 'static,
        T: Send + 'static,
    {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || f(&conn.lock())).await?
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn seeded() -> Db {
        let db = Db::open_in_memory().unwrap();
        db.write(|tx| {
            tx.execute_batch("CREATE TABLE t (id TEXT)")?;
            Ok(())
        })
        .await
        .unwrap();
        db
    }

    async fn ids(db: &Db) -> Vec<String> {
        db.read(|c| {
            let mut stmt = c.prepare("SELECT id FROM t ORDER BY id")?;
            let rows = stmt.query_map([], |r| r.get(0))?;
            Ok(rows.collect::<rusqlite::Result<Vec<String>>>()?)
        })
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn write_commits_on_ok() {
        let db = seeded().await;
        db.write(|tx| {
            tx.execute("INSERT INTO t (id) VALUES ('a')", [])?;
            Ok(())
        })
        .await
        .unwrap();
        assert_eq!(ids(&db).await, ["a"]);
    }

    #[tokio::test]
    async fn write_rolls_back_the_whole_unit_on_error() {
        let db = seeded().await;
        let r = db
            .write(|tx| {
                tx.execute("INSERT INTO t (id) VALUES ('a')", [])?;
                Err::<(), DbError>("boom".into())
            })
            .await;
        assert!(r.is_err());
        assert!(
            ids(&db).await.is_empty(),
            "the failed write left nothing behind"
        );
    }

    #[tokio::test]
    async fn savepoint_rolls_back_only_its_substep() {
        let db = seeded().await;
        db.write(|tx| {
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
}
