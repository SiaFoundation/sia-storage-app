pub mod m0001_init_schema;
pub mod m0002_object_needs_sync_up;

use crate::db::types::Migration;

pub fn core_migrations() -> Vec<Migration> {
    vec![
        m0001_init_schema::migration_0001_init_schema(),
        m0002_object_needs_sync_up::migration_0002_object_needs_sync_up(),
    ]
}

/// A fresh in-memory connection with foreign keys on and the full core schema applied.
#[cfg(test)]
pub(crate) fn migrated_conn() -> rusqlite::Connection {
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    rusqlite::vtab::array::load_module(&conn).unwrap();
    crate::db::runner::run_migrations(&mut conn, &core_migrations()).unwrap();
    conn
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn applied_ids(conn: &Connection) -> Vec<String> {
        let mut stmt = conn
            .prepare("SELECT id FROM migrations ORDER BY id")
            .unwrap();
        stmt.query_map([], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
    }

    #[test]
    fn migrations_build_the_schema_and_record_themselves() {
        let conn = migrated_conn();
        assert_eq!(
            applied_ids(&conn),
            ["0001_init_schema", "0002_object_needs_sync_up"]
        );
        for table in [
            "directories",
            "files",
            "objects",
            "fs",
            "logs",
            "tags",
            "file_tags",
        ] {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
                    [table],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(count, 1, "missing table {table}");
        }
        let has_needs_sync_up = conn
            .prepare("PRAGMA table_info(objects)")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .filter_map(Result::ok)
            .any(|name| name == "needsSyncUp");
        assert!(has_needs_sync_up, "objects.needsSyncUp missing");

        let favorites: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tags WHERE id = 'sys:favorites'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(favorites, 1, "Favorites system tag seeded");
    }

    #[test]
    fn re_running_migrations_is_a_noop() {
        let mut conn = migrated_conn();
        crate::db::runner::run_migrations(&mut conn, &core_migrations()).unwrap();
        assert_eq!(applied_ids(&conn).len(), 2);
    }
}
