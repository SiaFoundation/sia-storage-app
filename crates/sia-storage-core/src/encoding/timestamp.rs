use chrono::{DateTime, TimeZone, Utc};

/// The one gateway from the DB's `i64`-ms timestamps to the domain `DateTime`.
/// Out-of-range values fall back to the Unix epoch.
pub fn decode_epoch_ms(value: i64) -> DateTime<Utc> {
    Utc.timestamp_millis_opt(value)
        .single()
        .unwrap_or(DateTime::<Utc>::UNIX_EPOCH)
}

/// Encode a `DateTime<Utc>` to epoch-ms.
pub fn encode_epoch_ms(date: DateTime<Utc>) -> i64 {
    date.timestamp_millis()
}

/// Now, formatted as `YYYY-MM-DD HH:MM:SS.mmm` for the log table's display-only `timestamp`.
pub fn now_log_timestamp() -> String {
    Utc::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_known_timestamp() {
        let ms = 1_700_000_000_000i64;
        let dt = decode_epoch_ms(ms);
        assert_eq!(encode_epoch_ms(dt), ms);
    }

    #[test]
    fn decode_zero_is_epoch_start() {
        let dt = decode_epoch_ms(0);
        assert_eq!(encode_epoch_ms(dt), 0);
    }

    #[test]
    fn out_of_range_falls_back_to_unix_epoch() {
        let dt = decode_epoch_ms(i64::MAX);
        assert_eq!(dt, DateTime::<Utc>::UNIX_EPOCH);
        assert_eq!(encode_epoch_ms(dt), 0);
    }

    #[test]
    fn round_trip_now() {
        let now = Utc::now();
        let ms = encode_epoch_ms(now);
        let back = decode_epoch_ms(ms);
        assert_eq!(encode_epoch_ms(back), ms);
    }
}
