import AVFoundation
import CoreImage
import ImageIO
import UniformTypeIdentifiers
import UIKit
import Vision

/// Writes one scan in the bodyfit capture format (docs/capture-format.md):
/// capture.json + depth/NNNN.png (16-bit millimetres) + mask/NNNN.png (Apple's
/// person segmentation, at depth size) + rgb/NNNN.jpg. Turn angles are left to
/// bodyfit; Vision's raw 3D pose goes along as a hint.
final class BundleWriter {
    let folder: URL
    private var frames: [[String: Any]] = []
    private var intrinsics: [[Double]]?
    private var depthSize: [Int]?
    private var gravitySum = SIMD3<Double>(repeating: 0)
    private let ciContext = CIContext()
    private let start: CMTime

    init(folder: URL, start: CMTime) throws {
        self.folder = folder
        self.start = start
        for sub in ["depth", "mask", "rgb"] {
            try FileManager.default.createDirectory(at: folder.appending(path: sub), withIntermediateDirectories: true)
        }
    }

    var frameCount: Int { frames.count }

    func add(pixels: CVPixelBuffer, depth: AVDepthData, time: CMTime, gravity: SIMD3<Double>) throws {
        let i = frames.count
        let name = String(format: "%04d", i)
        let map = depth.converting(toDepthDataType: kCVPixelFormatType_DepthFloat32).depthDataMap
        let (w, h) = (CVPixelBufferGetWidth(map), CVPixelBufferGetHeight(map))
        try writeDepthPNG(map, to: folder.appending(path: "depth/\(name).png"))
        try writeJPEG(pixels, to: folder.appending(path: "rgb/\(name).jpg"))
        let hasMask = (try? writeMask(pixels, width: w, height: h, to: folder.appending(path: "mask/\(name).png"))) != nil

        if intrinsics == nil, let cal = depth.cameraCalibrationData {
            // Intrinsics are given for the full sensor; scale them to the depth map.
            let k = cal.intrinsicMatrix
            let s = Double(w) / Double(cal.intrinsicMatrixReferenceDimensions.width)
            intrinsics = [[Double(k[0][0]) * s, 0, Double(k[2][0]) * s],
                          [0, Double(k[1][1]) * s, Double(k[2][1]) * s],
                          [0, 0, 1]]
            depthSize = [w, h]
        }
        gravitySum += gravity

        var entry: [String: Any] = [
            "depth": "depth/\(name).png",
            "mask": hasMask ? "mask/\(name).png" as Any : NSNull(),
            "yaw_hint": NSNull(),
            "rgb": "rgb/\(name).jpg",
            "time": CMTimeGetSeconds(time - start),
            "gravity_device": [gravity.x, gravity.y, gravity.z],
        ]
        if let pose = bodyPose(pixels: pixels, depth: depth) { entry["vision"] = pose }
        frames.append(entry)
    }

    func finish() throws {
        let n = Double(max(frames.count, 1))
        let g = gravitySum / n
        let doc: [String: Any] = [
            "version": 1,
            "depth_size": depthSize ?? [0, 0],
            "intrinsics": intrinsics ?? [],
            "gravity_device": [g.x, g.y, g.z],
            "sensor_orientation": "landscape_native",
            "frames": frames,
            "meta": [
                "app": "Seamstress iOS 0.1",
                "device": UIDevice.current.model,
                "captured": ISO8601DateFormatter().string(from: Date()),
                "instructions": "start facing the camera, turn to the left",
            ],
        ]
        let data = try JSONSerialization.data(withJSONObject: doc, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: folder.appending(path: "capture.json"))
    }

    // MARK: - Files

    private func writeDepthPNG(_ map: CVPixelBuffer, to url: URL) throws {
        CVPixelBufferLockBaseAddress(map, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(map, .readOnly) }
        let (w, h) = (CVPixelBufferGetWidth(map), CVPixelBufferGetHeight(map))
        let rowBytes = CVPixelBufferGetBytesPerRow(map)
        let base = CVPixelBufferGetBaseAddress(map)!
        var mm = [UInt16](repeating: 0, count: w * h)
        for y in 0..<h {
            let row = (base + y * rowBytes).assumingMemoryBound(to: Float32.self)
            for x in 0..<w {
                let d = row[x]
                mm[y * w + x] = d.isFinite && d > 0 ? UInt16(min(d * 1000, 65535)).bigEndian : 0
            }
        }
        let data = mm.withUnsafeBufferPointer { Data(buffer: $0) }
        guard let provider = CGDataProvider(data: data as CFData),
              let image = CGImage(width: w, height: h, bitsPerComponent: 16, bitsPerPixel: 16, bytesPerRow: w * 2,
                                  space: CGColorSpaceCreateDeviceGray(),
                                  bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue | CGBitmapInfo.byteOrder16Big.rawValue),
                                  provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent),
              let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)
        else { throw CocoaError(.fileWriteUnknown) }
        CGImageDestinationAddImage(dest, image, nil)
        guard CGImageDestinationFinalize(dest) else { throw CocoaError(.fileWriteUnknown) }
    }

    /// Apple's person segmentation, scaled to the depth map (same 4:3 frame).
    private func writeMask(_ pixels: CVPixelBuffer, width: Int, height: Int, to url: URL) throws {
        let request = VNGeneratePersonSegmentationRequest()
        request.qualityLevel = .balanced
        request.outputPixelFormat = kCVPixelFormatType_OneComponent8
        try VNImageRequestHandler(cvPixelBuffer: pixels, orientation: .up, options: [:]).perform([request])
        guard let mask = request.results?.first?.pixelBuffer else { throw CocoaError(.fileWriteUnknown) }
        let image = CIImage(cvPixelBuffer: mask)
        let scaled = image.transformed(by: CGAffineTransform(scaleX: CGFloat(width) / image.extent.width,
                                                             y: CGFloat(height) / image.extent.height))
        guard let cg = ciContext.createCGImage(scaled, from: CGRect(x: 0, y: 0, width: width, height: height),
                                               format: .L8, colorSpace: CGColorSpaceCreateDeviceGray()),
              let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)
        else { throw CocoaError(.fileWriteUnknown) }
        CGImageDestinationAddImage(dest, cg, nil)
        guard CGImageDestinationFinalize(dest) else { throw CocoaError(.fileWriteUnknown) }
    }

    private func writeJPEG(_ pixels: CVPixelBuffer, to url: URL) throws {
        let image = CIImage(cvPixelBuffer: pixels).transformed(by: CGAffineTransform(scaleX: 0.5, y: 0.5))
        guard let space = CGColorSpace(name: CGColorSpace.sRGB),
              let data = ciContext.jpegRepresentation(of: image, colorSpace: space,
                                                      options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.7])
        else { throw CocoaError(.fileWriteUnknown) }
        try data.write(to: url)
    }

    // MARK: - Vision

    /// Raw 3D body pose. The image is passed in sensor orientation (.up); bodyfit
    /// converts to a turn angle and checks the axis convention against the depth.
    private func bodyPose(pixels: CVPixelBuffer, depth: AVDepthData) -> [String: Any]? {
        let request = VNDetectHumanBodyPose3DRequest()
        let handler = VNImageRequestHandler(cvPixelBuffer: pixels, depthData: depth, orientation: .up, options: [:])
        guard (try? handler.perform([request])) != nil,
              let obs = request.results?.first,
              let left = try? obs.recognizedPoint(.leftHip),
              let right = try? obs.recognizedPoint(.rightHip)
        else { return nil }
        func xyz(_ m: simd_float4x4) -> [Double] { [Double(m.columns.3.x), Double(m.columns.3.y), Double(m.columns.3.z)] }
        let c = obs.cameraOriginMatrix
        let cols = [c.columns.0, c.columns.1, c.columns.2, c.columns.3]
        return [
            "camera_origin_matrix_columns": cols.map { [Double($0.x), Double($0.y), Double($0.z), Double($0.w)] },
            "left_hip": xyz(left.position),
            "right_hip": xyz(right.position),
            "body_height": Double(obs.bodyHeight),
        ]
    }
}
