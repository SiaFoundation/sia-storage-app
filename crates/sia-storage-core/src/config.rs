//! The app's tunable constants.

use crate::lib_utils::time::days_in_ms;

/// How long a trashed file stays before it is auto-purged.
pub fn trash_auto_purge_age() -> i64 {
    days_in_ms(30)
}
