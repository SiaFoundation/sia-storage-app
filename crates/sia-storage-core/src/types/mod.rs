pub mod local_object;
pub mod slabs;

pub use local_object::{LocalObject, LocalObjectRef};
pub use slabs::{PinnedSector, Slab};
