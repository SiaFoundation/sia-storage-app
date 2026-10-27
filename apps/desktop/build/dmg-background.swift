// Draws the disk image window's background: a paper field, the instruction,
// and the arrow between the two icons. Finder draws the icons and their names
// on top of this picture. Coordinates are points in the icon view, with the
// origin at the top left and y growing downward.

import AppKit
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

let paper = CGColor(srgbRed: 239.0 / 255, green: 242.0 / 255, blue: 237.0 / 255, alpha: 1)
let olive = CGColor(srgbRed: 29.0 / 255, green: 38.0 / 255, blue: 9.0 / 255, alpha: 1)
let oliveText = NSColor(srgbRed: 29.0 / 255, green: 38.0 / 255, blue: 9.0 / 255, alpha: 1)

let args = CommandLine.arguments
guard args.count == 10 else {
  fputs(
    "usage: dmg-background.swift <out.png> <caption> <width> <height> <baseline> <x1> <x2> <y> <bow>\n",
    stderr
  )
  exit(1)
}

let out = args[1]
let caption = args[2]
let width = Double(args[3]) ?? 0
let height = Double(args[4]) ?? 0
let baseline = Double(args[5]) ?? 0
let x1 = Double(args[6]) ?? 0
let x2 = Double(args[7]) ?? 0
let arrowY = Double(args[8]) ?? 0
let bow = Double(args[9]) ?? 0
guard width > 0, height > 0 else {
  fputs("width and height must be positive\n", stderr)
  exit(1)
}

let scale = 2
let pixelsWide = Int(width) * scale
let pixelsHigh = Int(height) * scale

// A bitmap context is y-up with its origin at the bottom left. The flip
// makes point (0, 0) the top left of the icon view, one unit per point.
guard
  let space = CGColorSpace(name: CGColorSpace.sRGB),
  let ctx = CGContext(
    data: nil,
    width: pixelsWide,
    height: pixelsHigh,
    bitsPerComponent: 8,
    bytesPerRow: 0,
    space: space,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
  )
else {
  fputs("could not allocate the background\n", stderr)
  exit(1)
}
ctx.translateBy(x: 0, y: CGFloat(pixelsHigh))
ctx.scaleBy(x: CGFloat(scale), y: -CGFloat(scale))
ctx.setFillColor(paper)
ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))

let font = NSFont.systemFont(ofSize: 17, weight: .medium)
let text = NSAttributedString(
  string: caption,
  attributes: [
    .font: font,
    .foregroundColor: oliveText,
    .kern: -0.34,
  ]
)
let line = CTLineCreateWithAttributedString(text)
var ascent: CGFloat = 0
var descent: CGFloat = 0
let textWidth = CGFloat(CTLineGetTypographicBounds(line, &ascent, &descent, nil))
if textWidth > CGFloat(width) - 80 {
  fputs("caption does not fit the window\n", stderr)
  exit(1)
}
ctx.saveGState()
ctx.translateBy(x: (CGFloat(width) - textWidth) / 2, y: CGFloat(baseline))
ctx.scaleBy(x: 1, y: -1)
ctx.textPosition = .zero
CTLineDraw(line, ctx)
ctx.restoreGState()

let start = CGPoint(x: x1, y: arrowY)
let end = CGPoint(x: x2, y: arrowY)
let control = CGPoint(x: (start.x + end.x) / 2, y: end.y - bow)
let dx = end.x - control.x
let dy = end.y - control.y
let length = hypot(dx, dy)
let ux = dx / length
let uy = dy / length
let head: CGFloat = 13
let tip = CGPoint(x: end.x + ux * head, y: end.y + uy * head)
let wing = CGFloat(5.5)
let px = -uy
let py = ux
let wingA = CGPoint(x: end.x + px * wing, y: end.y + py * wing)
let wingB = CGPoint(x: end.x - px * wing, y: end.y - py * wing)

ctx.setStrokeColor(olive)
ctx.setFillColor(olive)
ctx.setLineWidth(2.75)
ctx.setLineCap(.round)
ctx.setLineJoin(.round)
ctx.move(to: start)
ctx.addQuadCurve(to: end, control: control)
ctx.strokePath()
ctx.move(to: tip)
ctx.addLine(to: wingA)
ctx.addLine(to: wingB)
ctx.closePath()
ctx.fillPath()

guard let big = ctx.makeImage() else {
  fputs("could not read the background back\n", stderr)
  exit(1)
}

// Finder sizes a background picture by its pixels and ignores the dpi, so a
// 2x file is cropped. Draw at 2x and write the view's point size.
guard
  let small = CGContext(
    data: nil,
    width: Int(width),
    height: Int(height),
    bitsPerComponent: 8,
    bytesPerRow: 0,
    space: space,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
  )
else {
  fputs("could not scale the background\n", stderr)
  exit(1)
}
small.interpolationQuality = .high
small.draw(big, in: CGRect(x: 0, y: 0, width: width, height: height))
guard let image = small.makeImage() else {
  fputs("could not scale the background\n", stderr)
  exit(1)
}
let url = URL(fileURLWithPath: out) as CFURL
guard let dest = CGImageDestinationCreateWithURL(url, UTType.png.identifier as CFString, 1, nil) else {
  fputs("could not create the png\n", stderr)
  exit(1)
}
let props = [
  kCGImagePropertyDPIWidth: 72,
  kCGImagePropertyDPIHeight: 72,
] as CFDictionary
CGImageDestinationAddImage(dest, image, props)
guard CGImageDestinationFinalize(dest) else {
  fputs("could not write the png\n", stderr)
  exit(1)
}
