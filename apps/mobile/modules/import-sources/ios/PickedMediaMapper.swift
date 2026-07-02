import Foundation

/// Pick-order mapping for identifier delivery: PHAsset.fetchAssets returns
/// found assets in library order and silently drops identifiers outside the
/// app's limited-access selection, so entries are rebuilt in pick order and
/// a missing id becomes an inaccessible entry the app classifies as
/// permission-denied.
enum PickedMediaMapper {
  static func entries(
    pickedIds: [String],
    metaById: [String: [String: Any]]
  ) -> [[String: Any]] {
    pickedIds.map { id in
      metaById[id] ?? ["mediaAssetId": id, "accessible": false]
    }
  }
}
