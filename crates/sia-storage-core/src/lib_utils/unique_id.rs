/// A random opaque unique id: 16 random bytes, hex-encoded to 32 chars. Ids are
/// uniqueness-only; nothing parses the format.
pub(crate) fn unique_id() -> String {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).expect("OS RNG unavailable");
    hex::encode(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unique_id_returns_32_char_hex() {
        let id = unique_id();
        assert_eq!(id.len(), 32);
        assert!(id.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
