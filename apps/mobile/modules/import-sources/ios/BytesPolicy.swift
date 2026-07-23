import Foundation

/// Which PHAssetResource bytes an import reads, the policy half of the media
/// copy, kept pure for host tests. Rendered when a rendered resource exists,
/// original otherwise; a live photo imports the still only; an unedited
/// slow-mo has no rendered resource and so imports the raw high-fps original
/// (the speed ramp lives in metadata, so archived playback runs at full speed).
public enum BytesPolicy {
  public enum MediaKind { case image, video }

  public enum ResourceKind: Hashable {
    case photo
    case fullSizePhoto
    case video
    case fullSizeVideo
    case pairedVideo
  }

  public struct Decision: Equatable {
    public let selection: ResourceKind
    public let variant: String // "original" | "rendered"

    public init(selection: ResourceKind, variant: String) {
      self.selection = selection
      self.variant = variant
    }
  }

  public static func decide(
    mediaKind: MediaKind,
    hasAdjustments: Bool,
    resources: Set<ResourceKind>
  ) throws -> Decision {
    switch mediaKind {
    case .image:
      // pairedVideo (live photo motion) is never selected; the still only.
      if hasAdjustments, resources.contains(.fullSizePhoto) {
        return Decision(selection: .fullSizePhoto, variant: "rendered")
      }
      if resources.contains(.photo) {
        return Decision(selection: .photo, variant: "original")
      }
    case .video:
      if hasAdjustments, resources.contains(.fullSizeVideo) {
        return Decision(selection: .fullSizeVideo, variant: "rendered")
      }
      if resources.contains(.video) {
        return Decision(selection: .video, variant: "original")
      }
    }
    throw CodedError("unsupported", "asset has no readable resource")
  }
}
