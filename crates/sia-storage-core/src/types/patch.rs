//! A single field in a partial-update patch: `Unchanged` leaves the column alone, `Changed(v)`
//! sets it to v. For a nullable column T is itself an `Option`, so `Changed(None)` writes SQL
//! NULL and `Changed(Some(x))` writes x; `Unchanged` omits the column from the UPDATE entirely.

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum FieldUpdate<T> {
    #[default]
    Unchanged,
    Changed(T),
}

impl<T> FieldUpdate<T> {
    /// True when the field carries a new value (is part of the patch).
    pub fn is_changed(&self) -> bool {
        matches!(self, FieldUpdate::Changed(_))
    }
}
