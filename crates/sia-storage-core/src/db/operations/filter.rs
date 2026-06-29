/// Options controlling which file rows `build_record_filter` admits.
#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct BuildRecordFilterOpts {
    /// Include kind='thumb' rows. Default: only kind='file'.
    pub include_thumbnails: bool,
    /// Include superseded file versions (current=0) and thumbnails whose
    /// original is superseded. Default: current only.
    pub include_old_versions: bool,
    /// Include trashed rows (trashedAt IS NOT NULL). Default: excluded.
    pub include_trashed: bool,
    /// Include tombstoned rows (deletedAt IS NOT NULL). Default: excluded.
    pub include_deleted: bool,
}

/// The active-record predicate every file, directory, and stats query funnels through. By default it
/// scopes to the live file group: `kind = 'file' AND current = 1 AND trashedAt IS NULL AND deletedAt
/// IS NULL`. Each `BuildRecordFilterOpts` flag widens the set (thumbnails, old versions, trashed,
/// deleted). `table_alias` must not be `o`: the thumbnail branch's EXISTS subquery uses `o` for the
/// original's row, and an outer `o` would self-correlate and admit no thumbnails.
pub(crate) fn build_record_filter(table_alias: &str, opts: BuildRecordFilterOpts) -> String {
    debug_assert_ne!(
        table_alias, "o",
        "the thumbnail branch's EXISTS subquery uses `o` internally"
    );
    let mut parts: Vec<String> = Vec::new();
    if !opts.include_thumbnails {
        parts.push(format!("{table_alias}.kind = 'file'"));
    }
    if !opts.include_old_versions {
        if opts.include_thumbnails {
            // A thumbnail has no `current` of its own, so count it only when its original is current
            // (and, unless explicitly included, not trashed or deleted). Without this the thumbnail
            // count would include both sizes of every version, roughly double the real number.
            let mut original = vec![
                format!("o.id = {table_alias}.thumbForId"),
                "o.current = 1".to_string(),
            ];
            if !opts.include_trashed {
                original.push("o.trashedAt IS NULL".to_string());
            }
            if !opts.include_deleted {
                original.push("o.deletedAt IS NULL".to_string());
            }
            parts.push(format!(
                "(({table_alias}.kind = 'file' AND {table_alias}.current = 1) OR ({table_alias}.kind = 'thumb' AND EXISTS (SELECT 1 FROM files o WHERE {})))",
                original.join(" AND ")
            ));
        } else {
            parts.push(format!("{table_alias}.current = 1"));
        }
    }
    if !opts.include_trashed {
        parts.push(format!("{table_alias}.trashedAt IS NULL"));
    }
    if !opts.include_deleted {
        parts.push(format!("{table_alias}.deletedAt IS NULL"));
    }
    if parts.is_empty() {
        "1=1".into()
    } else {
        parts.join(" AND ")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alias_is_inlined() {
        let s = build_record_filter("alpha", BuildRecordFilterOpts::default());
        assert!(s.contains("alpha.kind"));
        assert!(s.contains("alpha.current"));
        assert!(!s.contains("f."));
    }

    // Output coverage for the flag combinations that produce distinct predicates.
    mod build_record_filter_exact {
        use super::*;

        #[test]
        fn default_kind_file_and_current_non_trashed_non_deleted() {
            assert_eq!(
                build_record_filter("f", BuildRecordFilterOpts::default()),
                "f.kind = 'file' AND f.current = 1 AND f.trashedAt IS NULL AND f.deletedAt IS NULL"
            );
        }

        #[test]
        fn include_trashed_drops_trashed_at_clause() {
            assert_eq!(
                build_record_filter(
                    "f",
                    BuildRecordFilterOpts {
                        include_trashed: true,
                        ..Default::default()
                    }
                ),
                "f.kind = 'file' AND f.current = 1 AND f.deletedAt IS NULL"
            );
        }

        #[test]
        fn include_old_versions_alone_drops_current_clause() {
            assert_eq!(
                build_record_filter(
                    "f",
                    BuildRecordFilterOpts {
                        include_old_versions: true,
                        ..Default::default()
                    }
                ),
                "f.kind = 'file' AND f.trashedAt IS NULL AND f.deletedAt IS NULL"
            );
        }

        #[test]
        fn include_thumbnails_and_old_versions_all_rows_just_trashed_deleted_guarded() {
            assert_eq!(
                build_record_filter(
                    "f",
                    BuildRecordFilterOpts {
                        include_thumbnails: true,
                        include_old_versions: true,
                        ..Default::default()
                    }
                ),
                "f.trashedAt IS NULL AND f.deletedAt IS NULL"
            );
        }

        #[test]
        fn include_thumbnails_alone_current_files_plus_thumbs_of_current() {
            let filter = build_record_filter(
                "f",
                BuildRecordFilterOpts {
                    include_thumbnails: true,
                    ..Default::default()
                },
            );
            assert!(filter.contains("f.kind = 'file' AND f.current = 1"));
            assert!(filter.contains("f.kind = 'thumb' AND EXISTS"));
            assert!(filter.contains(
                "o.id = f.thumbForId AND o.current = 1 AND o.trashedAt IS NULL AND o.deletedAt IS NULL"
            ));
            assert!(filter.contains("f.trashedAt IS NULL"));
            assert!(filter.contains("f.deletedAt IS NULL"));
        }

        #[test]
        fn include_thumbnails_and_trashed_thumbs_of_trashed_originals_also_pass() {
            let filter = build_record_filter(
                "f",
                BuildRecordFilterOpts {
                    include_thumbnails: true,
                    include_trashed: true,
                    ..Default::default()
                },
            );
            assert!(
                filter.contains("o.id = f.thumbForId AND o.current = 1 AND o.deletedAt IS NULL")
            );
            assert!(!filter.contains("o.trashedAt IS NULL"));
            assert!(!filter.contains("f.trashedAt IS NULL"));
            assert!(filter.contains("f.deletedAt IS NULL"));
        }

        #[test]
        fn include_thumbnails_and_deleted_thumbs_of_deleted_originals_also_pass() {
            let filter = build_record_filter(
                "f",
                BuildRecordFilterOpts {
                    include_thumbnails: true,
                    include_deleted: true,
                    ..Default::default()
                },
            );
            assert!(
                filter.contains("o.id = f.thumbForId AND o.current = 1 AND o.trashedAt IS NULL")
            );
            assert!(!filter.contains("o.deletedAt IS NULL"));
            assert!(filter.contains("f.trashedAt IS NULL"));
            assert!(!filter.contains("f.deletedAt IS NULL"));
        }

        #[test]
        fn all_include_flags_produce_1_eq_1() {
            assert_eq!(
                build_record_filter(
                    "f",
                    BuildRecordFilterOpts {
                        include_thumbnails: true,
                        include_old_versions: true,
                        include_trashed: true,
                        include_deleted: true,
                    }
                ),
                "1=1"
            );
        }
    }
}
