/// A sort key that orders names the way a person reads numbers: `file2` before `file10`. None in, None out.
pub fn natural_sort_key(name: Option<&str>) -> Option<String> {
    let name = name?;
    let lower = name.to_lowercase();
    // Zero-pad each ASCII-digit run to 20 chars so lexical compare yields numeric order.
    // Only ASCII digits count (not full Unicode); everything else passes through verbatim.
    let chars: Vec<char> = lower.chars().collect();
    let mut out = String::with_capacity(lower.len());
    for run in chars.chunk_by(|a, b| a.is_ascii_digit() == b.is_ascii_digit()) {
        if run[0].is_ascii_digit() {
            for _ in 0..20usize.saturating_sub(run.len()) {
                out.push('0');
            }
        }
        out.extend(run);
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::natural_sort_key;

    fn pad20(s: &str) -> String {
        let mut out = String::with_capacity(20);
        for _ in 0..(20usize.saturating_sub(s.len())) {
            out.push('0');
        }
        out.push_str(s);
        out
    }

    #[test]
    fn returns_none_for_none_input() {
        assert_eq!(natural_sort_key(None), None);
    }

    #[test]
    fn returns_empty_string_for_empty_input() {
        assert_eq!(natural_sort_key(Some("")), Some(String::new()));
    }

    #[test]
    fn lowercases_alphabetic_strings() {
        assert_eq!(natural_sort_key(Some("ABC")), Some("abc".to_string()));
        assert_eq!(
            natural_sort_key(Some("Hello World")),
            Some("hello world".to_string())
        );
    }

    #[test]
    fn pads_single_numeric_sequences() {
        assert_eq!(
            natural_sort_key(Some("file2")),
            Some(format!("file{}", pad20("2")))
        );
        assert_eq!(
            natural_sort_key(Some("file10")),
            Some(format!("file{}", pad20("10")))
        );
    }

    #[test]
    fn pads_multiple_numeric_sequences_independently() {
        let key = natural_sort_key(Some("v1.2.10")).unwrap();
        let expected = format!("v{}.{}.{}", pad20("1"), pad20("2"), pad20("10"));
        assert_eq!(key, expected);
    }

    #[test]
    fn produces_correct_natural_sort_order() {
        let mut names = vec!["file10", "file2", "file1", "file20", "file3"];
        names.sort_by(|a, b| {
            natural_sort_key(Some(a))
                .unwrap()
                .cmp(&natural_sort_key(Some(b)).unwrap())
        });
        assert_eq!(names, vec!["file1", "file2", "file3", "file10", "file20"]);
    }

    #[test]
    fn handles_case_insensitive_natural_sorting() {
        let mut names = vec!["File10", "FILE2", "file1"];
        names.sort_by(|a, b| {
            natural_sort_key(Some(a))
                .unwrap()
                .cmp(&natural_sort_key(Some(b)).unwrap())
        });
        assert_eq!(names, vec!["file1", "FILE2", "File10"]);
    }

    #[test]
    fn handles_leading_zeros_in_original_name() {
        let key7 = natural_sort_key(Some("file007")).unwrap();
        let key7plain = natural_sort_key(Some("file7")).unwrap();
        assert_eq!(key7, key7plain);
    }

    #[test]
    fn preserves_numbers_longer_than_20_digits() {
        let long_num = "1".repeat(25);
        let key = natural_sort_key(Some(&format!("file{}", long_num))).unwrap();
        assert_eq!(key, format!("file{}", long_num));
    }

    #[test]
    fn handles_path_style_names_with_slashes() {
        let mut names = vec!["photos/2", "photos/10", "photos/1"];
        names.sort_by(|a, b| {
            natural_sort_key(Some(a))
                .unwrap()
                .cmp(&natural_sort_key(Some(b)).unwrap())
        });
        assert_eq!(names, vec!["photos/1", "photos/2", "photos/10"]);
    }

    #[test]
    fn handles_purely_numeric_string() {
        assert_eq!(natural_sort_key(Some("42")), Some(pad20("42")));
    }

    #[test]
    fn handles_complex_names_with_punctuation() {
        let key = natural_sort_key(Some("IMG_2024-01-15 (3).jpg")).unwrap();
        let expected = format!(
            "img_{}-{}-{} ({}).jpg",
            pad20("2024"),
            pad20("01"),
            pad20("15"),
            pad20("3"),
        );
        assert_eq!(key, expected);
    }

    #[test]
    fn preserves_multibyte_chars_between_digit_runs() {
        // Matching JS `\d`, emoji and accented chars are non-digits and pass through verbatim.
        let key = natural_sort_key(Some("café2—10📷3")).unwrap();
        let expected = format!("café{}—{}📷{}", pad20("2"), pad20("10"), pad20("3"),);
        assert_eq!(key, expected);
    }
}
