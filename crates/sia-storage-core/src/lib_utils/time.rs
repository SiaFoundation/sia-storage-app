/// Milliseconds in `days` days.
pub const fn days_in_ms(days: i64) -> i64 {
    days * 24 * 60 * 60 * 1_000
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn days_in_ms_basic() {
        assert_eq!(days_in_ms(1), 86_400_000);
    }
}
