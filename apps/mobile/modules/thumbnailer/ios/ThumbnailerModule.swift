import AVFoundation
import CoreGraphics
import ExpoModulesCore
import ImageIO
import UniformTypeIdentifiers

// Generates upright, downsampled thumbnails entirely in native code. ImageIO and
// AVFoundation decode at reduced resolution and bake in EXIF / preferred-track
// orientation, so the full-resolution bitmap is never materialized and the JS
// side never has to reason about which decoder applied orientation.
public class ThumbnailerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("Thumbnailer")

    // Encodes one thumbnail per entry in `maxSizes`, each capping the long edge
    // at that size. The source is decoded and oriented once at the largest size;
    // smaller sizes are scaled down from that result.
    AsyncFunction("image") { (uri: String, maxSizes: [Int]) -> [[String: Any]] in
      guard let url = localFileURL(from: uri) else {
        throw Exception(name: "BadUri", description: "Expected a local file uri: \(uri)")
      }
      guard let longest = maxSizes.max() else { return [] }
      let source = CGImageSourceCreateWithURL(
        url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary)
      guard let source, let base = self.downsample(source, maxPixelSize: longest) else {
        throw Exception(name: "DecodeFailed", description: "Could not decode image: \(uri)")
      }
      return try maxSizes.map { size in
        let image = size >= max(base.width, base.height) ? base : self.scale(base, maxPixelSize: size)
        return try self.encodeJpeg(image)
      }
    }

    // One frame at `timeMs`, oriented via the preferred track transform and
    // scaled to fit within `maxSize` on the long edge.
    AsyncFunction("video") { (uri: String, maxSize: Int, timeMs: Int) -> [String: Any] in
      guard let url = localFileURL(from: uri) else {
        throw Exception(name: "BadUri", description: "Expected a local file uri: \(uri)")
      }
      let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
      generator.appliesPreferredTrackTransform = true
      generator.maximumSize = CGSize(width: maxSize, height: maxSize)
      let time = CMTime(value: CMTimeValue(timeMs), timescale: 1000)
      let frame = try generator.copyCGImage(at: time, actualTime: nil)
      return try self.encodeJpeg(frame)
    }
  }

  // kCGImageSourceThumbnailMaxPixelSize decodes directly near the target size
  // rather than decoding full-res and shrinking; WithTransform bakes in EXIF
  // orientation so the result is upright.
  private func downsample(_ source: CGImageSource, maxPixelSize: Int) -> CGImage? {
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
      kCGImageSourceShouldCacheImmediately: true,
    ]
    return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
  }

  private func scale(_ image: CGImage, maxPixelSize: Int) -> CGImage {
    let ratio = Double(maxPixelSize) / Double(max(image.width, image.height))
    let width = Int((Double(image.width) * ratio).rounded())
    let height = Int((Double(image.height) * ratio).rounded())
    guard
      let context = CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return image }
    context.interpolationQuality = .high
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    return context.makeImage() ?? image
  }

  private func encodeJpeg(_ image: CGImage) throws -> [String: Any] {
    let url = URL(fileURLWithPath: NSTemporaryDirectory())
      .appendingPathComponent(UUID().uuidString)
      .appendingPathExtension("jpg")
    guard
      let destination = CGImageDestinationCreateWithURL(
        url as CFURL, UTType.jpeg.identifier as CFString, 1, nil)
    else {
      throw Exception(name: "EncodeFailed", description: "Could not create thumbnail destination")
    }
    CGImageDestinationAddImage(
      destination, image, [kCGImageDestinationLossyCompressionQuality: 0.8] as CFDictionary)
    guard CGImageDestinationFinalize(destination) else {
      throw Exception(name: "EncodeFailed", description: "Could not encode thumbnail")
    }
    return [
      "uri": url.absoluteString,
      "width": image.width,
      "height": image.height,
      "mimeType": "image/jpeg",
    ]
  }

  // Local files only: a remote URL handed to CGImageSource/AVURLAsset would
  // trigger a network fetch.
  private func localFileURL(from uri: String) -> URL? {
    if let url = URL(string: uri), let scheme = url.scheme {
      return scheme == "file" ? url : nil
    }
    return URL(fileURLWithPath: uri)
  }
}
