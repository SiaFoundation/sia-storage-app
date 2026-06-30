mod m0001_init_schema;
mod m0002_object_needs_sync_up;

use crate::db::types::Migration;

/// The ordered chain of schema migrations. Each names the migration it builds on; the runner
/// applies them in order and refuses to run one whose parent isn't the current applied head, so
/// a migration can never run against a schema state it wasn't written for.
pub(crate) const CORE_MIGRATIONS: &[Migration] = &[
    Migration {
        id: "0001_init_schema",
        description: "Initialize storage schema.",
        parent: None,
        up: m0001_init_schema::up,
    },
    Migration {
        id: "0002_object_needs_sync_up",
        description: "Add a per-object needsSyncUp dirty flag for sync-up.",
        parent: Some("0001_init_schema"),
        up: m0002_object_needs_sync_up::up,
    },
];

/// A fresh in-memory connection with foreign keys on and the full core schema applied.
#[cfg(test)]
pub(crate) fn migrated_conn() -> rusqlite::Connection {
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    rusqlite::vtab::array::load_module(&conn).unwrap();
    crate::db::runner::run_migrations(&mut conn, CORE_MIGRATIONS, None).unwrap();
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

    // The list must be a single linear chain: one root, each `parent` the previous id, no
    // duplicates. A fork (two migrations sharing a parent) or a misordering breaks this, so a
    // bad merge is caught in CI instead of on a user's device.
    #[test]
    fn core_migrations_form_a_single_linear_chain() {
        let mut expected_parent: Option<&str> = None;
        let mut seen = std::collections::HashSet::new();
        for m in CORE_MIGRATIONS {
            assert_eq!(
                m.parent, expected_parent,
                "migration {} has the wrong parent",
                m.id
            );
            assert!(seen.insert(m.id), "duplicate migration id {}", m.id);
            expected_parent = Some(m.id);
        }
    }

    #[test]
    fn re_running_migrations_is_a_noop() {
        let mut conn = migrated_conn();
        crate::db::runner::run_migrations(&mut conn, CORE_MIGRATIONS, None).unwrap();
        assert_eq!(applied_ids(&conn).len(), 2);
    }
}
