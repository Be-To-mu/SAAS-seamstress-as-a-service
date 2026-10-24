import SwiftUI
import ImageIO
import UIKit
import Vision

/// Your mannequin: a plain dress-form with your shape and pose, one picture per stop
/// of the scan (8 angles, 45° apart). Gemini makes each from that stop's photo, with
/// your permission; the photos are then deleted, so the app only ever shows the mannequin.
/// Files: scans/<scan>/stops/<angle>.jpg (the photos, until made) → mannequin/<angle>.jpg.
enum MannequinStore {
    static func folder(_ scan: URL) -> URL { scan.appending(path: "mannequin") }

    static func images(_ scan: URL) -> [Int: UIImage] {
        jpegs(in: folder(scan)).compactMapValues { UIImage(contentsOfFile: $0.path) }
    }

    static func photos(_ scan: URL) -> [Int: URL] { jpegs(in: scan.appending(path: "stops")) }

    /// The angles this scan has (or had) stops for, from stops.json.
    static func angles(_ scan: URL) -> [Int] {
        struct Doc: Decodable { struct Stop: Decodable { let angle: Int }; let stops: [Stop] }
        guard let data = try? Data(contentsOf: scan.appending(path: "stops.json")),
              let doc = try? JSONDecoder().decode(Doc.self, from: data) else { return photos(scan).keys.sorted() }
        return doc.stops.map(\.angle).sorted()
    }

    /// A stop photo as a JPEG data URL at most 1024 px, decoded straight to that size
    /// (the full 1440×1920 photo is never held in memory).
    static func photoURL(_ file: URL, side: Int = 1024) -> String? {
        guard let source = CGImageSourceCreateWithURL(file as CFURL, nil),
              let small = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                  kCGImageSourceCreateThumbnailFromImageAlways: true,
                  kCGImageSourceCreateThumbnailWithTransform: true,
                  kCGImageSourceThumbnailMaxPixelSize: side,
              ] as CFDictionary),
              let data = UIImage(cgImage: small).jpegData(compressionQuality: 0.85) else { return nil }
        return "data:image/jpeg;base64,\(data.base64EncodedString())"
    }

    private static func jpegs(in dir: URL) -> [Int: URL] {
        let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
        var out: [Int: URL] = [:]
        for f in files where f.pathExtension == "jpg" {
            if let angle = Int(f.deletingPathExtension().lastPathComponent) { out[angle] = f }
        }
        return out
    }

    /// The figure in `image`, read from Vision's person mask (it works on mannequins too).
    /// Gemini re-frames the figure, so this is measured on each picture rather than taken from the photo.
    static func figureMap(_ image: UIImage) -> FigureMap? {
        guard let cg = image.cgImage else { return nil }
        let request = VNGeneratePersonSegmentationRequest()
        request.qualityLevel = .accurate
        request.outputPixelFormat = kCVPixelFormatType_OneComponent8
        guard (try? VNImageRequestHandler(cgImage: cg, orientation: image.cgOrientation).perform([request])) != nil,
              let mask = request.results?.first?.pixelBuffer else { return nil }
        CVPixelBufferLockBaseAddress(mask, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(mask, .readOnly) }
        let (w, h, row) = (CVPixelBufferGetWidth(mask), CVPixelBufferGetHeight(mask), CVPixelBufferGetBytesPerRow(mask))
        guard let base = CVPixelBufferGetBaseAddress(mask)?.assumingMemoryBound(to: UInt8.self) else { return nil }
        // The occupied runs of every row, in normalised x.
        var rows: [[ClosedRange<Double>]] = []
        for y in 0..<h {
            var runs: [ClosedRange<Double>] = []
            var start: Int?
            for x in 0...w {
                let on = x < w && base[y * row + x] > 127
                if on, start == nil { start = x }
                if !on, let s0 = start {
                    if x - s0 >= max(2, w / 200) { runs.append(Double(s0) / Double(w)...Double(x) / Double(w)) }
                    start = nil
                }
            }
            rows.append(runs)
        }
        return FigureMap(rows: rows)
    }
}

/// Where the body is in one picture: per row, the occupied runs (normalised x), and the landmarks
/// found from them: crown, soles, and the fingertips (where the arms, hanging by the sides, end and
/// the figure narrows to the legs; reliable from the front). y is normalised, top = 0.
struct FigureMap: Sendable {
    let crown: Double
    let soles: Double
    let fingertips: Double?
    private let rows: [[ClosedRange<Double>]]

    init?(rows: [[ClosedRange<Double>]]) {
        let n = rows.count
        guard let top = rows.firstIndex(where: { !$0.isEmpty }), let bottom = rows.lastIndex(where: { !$0.isEmpty }),
              bottom - top > n / 3 else { return nil }
        self.rows = rows
        crown = Double(top) / Double(n)
        soles = Double(bottom) / Double(n)
        let span = bottom - top
        func extent(_ i: Int) -> Double { rows[i].isEmpty ? 0 : rows[i].last!.upperBound - rows[i].first!.lowerBound }
        // Below the fingertips the figure is only as wide as the legs: the biggest narrowing between 45 and 75% down.
        var best = (row: 0, drop: 0.0)
        let step = max(1, span / 100)
        for i in stride(from: top + span * 45 / 100, to: top + span * 75 / 100, by: step) {
            let drop = extent(i) - extent(min(i + 3 * step, bottom))
            if drop > best.drop { best = (i + step, drop) }
        }
        let width = (top...bottom).map(extent).max() ?? 1
        fingertips = best.drop > 0.12 * width ? Double(best.row) / Double(n) : nil
    }

    /// The runs at height `y` (normalised).
    func runs(at y: Double) -> [ClosedRange<Double>] {
        rows[min(rows.count - 1, max(0, Int(y * Double(rows.count))))]
    }

    /// The figure's left and right edge at `y`.
    func extent(at y: Double) -> ClosedRange<Double> {
        let r = runs(at: y)
        guard let first = r.first, let last = r.last else { return 0.25...0.75 }
        return first.lowerBound...last.upperBound
    }

    /// Height above the floor (cm) → picture y, for a figure `height` cm tall.
    func y(_ above: Double, height: Double) -> Double { soles - (soles - crown) * above / height }

    /// Picture y → height above the floor (cm).
    func above(_ y: Double, height: Double) -> Double { (soles - y) / (soles - crown) * height }

    /// Where the figure stands, when nothing better is known (no Vision in the simulator).
    static let fallback: FigureMap = {
        var rows = [[ClosedRange<Double>]](repeating: [], count: 200)
        for i in 14..<189 { rows[i] = i < 112 ? [0.25...0.75] : [0.36...0.64] }
        return FigureMap(rows: rows)!
    }()
}

/// A small RGB copy of a picture, for reading colours.
struct Pixels: Sendable {
    let width: Int
    let height: Int
    private let data: [UInt8]

    init?(_ image: UIImage, width: Int = 240) {
        guard let cg = image.cgImage else { return nil }
        let height = max(1, width * cg.height / max(1, cg.width))
        var data = [UInt8](repeating: 0, count: width * height * 4)
        let ok = data.withUnsafeMutableBytes { buf -> Bool in
            guard let ctx = CGContext(data: buf.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return false }
            ctx.draw(cg, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        guard ok else { return nil }
        self.width = width
        self.height = height
        self.data = data
    }

    /// The colour at normalised (x, y), top left origin.
    func rgb(_ x: Double, _ y: Double) -> (Int, Int, Int) {
        let i = (min(height - 1, max(0, Int(y * Double(height)))) * width + min(width - 1, max(0, Int(x * Double(width))))) * 4
        return (Int(data[i]), Int(data[i + 1]), Int(data[i + 2]))
    }

    /// Mean colour of a small patch around (x, y).
    func patch(_ x: Double, _ y: Double, r: Double = 0.01) -> (Int, Int, Int) {
        var t = (0, 0, 0), n = 0
        for dx in stride(from: -r, through: r, by: r / 2) {
            for dy in stride(from: -r, through: r, by: r / 2) {
                let c = rgb(x + dx, y + dy)
                t = (t.0 + c.0, t.1 + c.1, t.2 + c.2); n += 1
            }
        }
        return (t.0 / n, t.1 / n, t.2 / n)
    }
}

/// Where the garment really ends in a dressed picture: the hem, and the cuffs (from the front,
/// with the arms hanging apart from the body). A pixel is garment when it is like neither the
/// bare mannequin nor the background; the hem is the lowest garment row across the body, the
/// cuffs the lowest garment row down each arm. Nil when the cloth is too close to the mannequin's colour.
enum GarmentEdges {
    static func find(dressed: UIImage, mannequin: UIImage, map: FigureMap) -> (hem: Double?, cuff: Double?) {
        guard let d = Pixels(dressed), let m = Pixels(mannequin) else { return (nil, nil) }
        let span = map.soles - map.crown
        let chest = map.crown + 0.3 * span
        let mid = { (y: Double) -> Double in let e = map.extent(at: y); return (e.lowerBound + e.upperBound) / 2 }
        // Compared by colour ratios with a little brightness: shading changes how light the mannequin is, not its hue.
        func feature(_ c: (Int, Int, Int)) -> (Double, Double, Double) {
            let sum = Double(max(1, c.0 + c.1 + c.2))
            return (Double(c.0) / sum, Double(c.1) / sum, 0.15 * sum / 765)
        }
        func dist(_ a: (Double, Double, Double), _ b: (Double, Double, Double)) -> Double {
            ((a.0 - b.0) * (a.0 - b.0) + (a.1 - b.1) * (a.1 - b.1) + (a.2 - b.2) * (a.2 - b.2)).squareRoot()
        }
        let bare = feature(m.patch(mid(chest), chest))  // the mannequin's own colour
        let background = feature(d.patch(0.04, 0.04))
        let cloth = feature(d.patch(mid(chest), chest))
        guard dist(cloth, bare) > 0.03, dist(cloth, background) > 0.03 else { return (nil, nil) }
        func isGarment(_ x: Double, _ y: Double) -> Bool {
            let f = feature(d.rgb(x, y))
            let c = dist(f, cloth)
            return c < dist(f, bare) && c < dist(f, background)
        }
        func fraction(_ y: Double, _ bands: [ClosedRange<Double>]) -> Double {
            var hit = 0, n = 0
            for b in bands { for x in stride(from: b.lowerBound, through: b.upperBound, by: max(0.004, (b.upperBound - b.lowerBound) / 12)) {
                n += 1; if isGarment(x, y) { hit += 1 }
            } }
            return n == 0 ? 0 : Double(hit) / Double(n)
        }
        let step = span / 300
        func lowest(_ bands: [ClosedRange<Double>], from: Double, to: Double) -> Double? {
            var y = to, found: Double?
            while y > from { if fraction(y, bands) > 0.5 { found = y; break }; y -= step }
            return found
        }
        // Hem: across the middle of the body, from the hips down.
        let hipY = map.crown + 0.5 * span
        let hip = map.extent(at: hipY), w = hip.upperBound - hip.lowerBound
        let torso = (hip.lowerBound + 0.3 * w)...(hip.upperBound - 0.3 * w)
        let hem = lowest([torso], from: hipY, to: map.soles - 0.03 * span)
        // Cuffs: down each arm, taken from the hands where the arms hang apart from the body.
        var cuff: Double?
        if let tips = map.fingertips {
            let runs = map.runs(at: tips - 0.04 * span)
            if runs.count >= 3, let l = runs.first, let r = runs.last {
                let arms = [l, r].map { ($0.lowerBound + 0.2 * ($0.upperBound - $0.lowerBound))...($0.upperBound - 0.2 * ($0.upperBound - $0.lowerBound)) }
                cuff = lowest(arms, from: map.crown + 0.25 * span, to: tips)
            }
        }
        return (hem, cuff)
    }
}

private extension UIImage {
    var cgOrientation: CGImagePropertyOrientation {
        switch imageOrientation {
        case .down: .down
        case .left: .left
        case .right: .right
        default: .up
        }
    }
}

/// Makes the mannequin pictures, a few at a time, and keeps going when you leave the page.
@MainActor
final class MannequinMaker: ObservableObject {
    static let shared = MannequinMaker()

    enum State: Equatable { case idle, making, failed(String) }

    @Published private(set) var scan: URL?
    @Published private(set) var images: [Int: UIImage] = [:]
    @Published private(set) var state = State.idle
    /// When the mannequin was last made: dressed pictures of an earlier one aren't reused.
    @Published private(set) var stamp = Date.distantPast

    /// Angles still to make (photos left on the phone).
    var pending: Int { scan.map { MannequinStore.photos($0).keys.filter { images[$0] == nil }.count } ?? 0 }
    var total: Int { scan.map { MannequinStore.angles($0).count } ?? 0 }

    /// Show `scan`'s mannequin (loading what's made).
    /// The body the current mannequin was made as: female, male, or scan (read from the photos).
    var madeAs: String? { scan.flatMap { UserDefaults.standard.string(forKey: "mannequinSex.\($0.lastPathComponent)") } }

    private static func madeAt(_ scan: URL) -> Date {
        (try? MannequinStore.folder(scan).appending(path: "0.jpg").resourceValues(forKeys: [.contentModificationDateKey]))?
            .contentModificationDate ?? .distantPast
    }

    /// Make the mannequin again as `sex` (after it's changed in the profile). The scan photos are gone by
    /// then, so the current mannequin pictures are the starting point: same shape and pose, the right body.
    func remake(sex: BodyProfile.Sex?) async {
        guard let scan, state != .making, !images.isEmpty else { return }
        let stops = scan.appending(path: "stops"), dir = MannequinStore.folder(scan)
        try? FileManager.default.createDirectory(at: stops, withIntermediateDirectories: true)
        for angle in images.keys {
            let to = stops.appending(path: "\(angle).jpg")
            try? FileManager.default.removeItem(at: to)
            try? FileManager.default.moveItem(at: dir.appending(path: "\(angle).jpg"), to: to)
        }
        images = [:]
        await make(sex: sex)
    }

    func load(_ scan: URL) {
        guard self.scan?.lastPathComponent != scan.lastPathComponent || images.isEmpty else { return }
        self.scan = scan
        images = MannequinStore.images(scan)
        stamp = Self.madeAt(scan)
        if state != .making { state = .idle }
    }

    /// Make the missing pictures, the front first: the others are made from it, so every angle shows
    /// the same mannequin. Two at a time; a failed angle is tried once more before giving up.
    /// Once all are made, the photos are deleted.
    func make(sex: BodyProfile.Sex? = nil) async {
        guard let scan, state != .making else { return }
        state = .making
        let dir = MannequinStore.folder(scan)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var firstError: Error?
        for round in 0..<2 {
            let todo = MannequinStore.photos(scan).filter { images[$0.key] == nil }.sorted { $0.key < $1.key }
            if todo.isEmpty { break }
            if round > 0 { try? await Task.sleep(for: .seconds(2)) }
            let (fronts, rest) = (todo.filter { $0.key == 0 }, todo.filter { $0.key != 0 })
            for batch in [fronts] + stride(from: 0, to: rest.count, by: 2).map({ Array(rest[$0..<min($0 + 2, rest.count)]) }) {
                let front = images[0]?.dataURL()
                await withTaskGroup(of: (Int, Result<UIImage, Error>).self) { group in
                    for (angle, photo) in batch {
                        group.addTask {
                            guard let url = MannequinStore.photoURL(photo) else {
                                return (angle, .failure(Engine.Failure(message: "Couldn't read the photo.")))
                            }
                            let input = MannequinInput(photo: url, angle: angle, front: angle == 0 ? nil : front, sex: sex?.rawValue)
                            do { return (angle, .success(try await Gemini.mannequin(input))) } catch { return (angle, .failure(error)) }
                        }
                    }
                    for await (angle, result) in group {
                        switch result {
                        case .success(let image):
                            try? image.jpegData(compressionQuality: 0.88)?.write(to: dir.appending(path: "\(angle).jpg"))
                            images[angle] = image
                        case .failure(let error):
                            firstError = firstError ?? error
                        }
                    }
                }
            }
        }
        if MannequinStore.photos(scan).keys.allSatisfy({ images[$0] != nil }) {
            // Only the mannequin is kept: the stop photos and the keyframes' colour photos go
            // (the Mac fits the body from depth and masks, never the photos).
            for sub in ["stops", "rgb"] { try? FileManager.default.removeItem(at: scan.appending(path: sub)) }
            stamp = Self.madeAt(scan)
            UserDefaults.standard.set(sex?.rawValue ?? "scan", forKey: "mannequinSex.\(scan.lastPathComponent)")
            state = .idle
        } else {
            state = .failed(firstError?.localizedDescription ?? "Some views couldn't be made.")
        }
    }
}

/// The mannequin on the Body page: asks once before the photos go to Gemini,
/// shows the pictures as they arrive, then turns like the garments do.
struct MannequinPanel: View {
    let scan: URL
    @ObservedObject private var maker = MannequinMaker.shared
    @EnvironmentObject private var profile: BodyProfile
    @AppStorage("mannequinConsent") private var consent = false

    var body: some View {
        ZStack {
            Theme.linen
            if !maker.images.isEmpty {
                Turntable(views: maker.images, label: "Your mannequin, drag sideways to turn it around")
            }
            if maker.pending > 0 {
                if !consent {
                    consentCard
                } else if maker.state == .making {
                    AtelierProgress(caption: "Shaping your mannequin · \(maker.images.count) of \(maker.total)")
                        .padding(18)
                        .background(Theme.cream.opacity(maker.images.isEmpty ? 0 : 0.9))
                } else if case .failed(let message) = maker.state {
                    VStack(spacing: 12) {
                        Text(message).font(.callout).multilineTextAlignment(.center)
                        Button("Try again") { Task { await maker.make(sex: profile.sex) } }.buttonStyle(TailoredButtonStyle(filled: false))
                    }
                    .padding(20).background(Theme.cream.opacity(0.92)).padding(24)
                }
            }
        }
        .foregroundStyle(Theme.brown)
        .task {
            maker.load(scan)
            if consent, maker.pending > 0 { await maker.make(sex: profile.sex) }
        }
    }

    private var consentCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Your mannequin").titleStyle(24)
            Text("Your eight scan photos are sent to Google Gemini, which turns each into a plain dress form with your exact shape and pose. "
                + "The photos are then deleted from this phone: you'll only ever see the mannequin.")
                .font(Theme.body(15)).lineSpacing(3)
            VStack(alignment: .leading, spacing: 6) {
                Text("Body").font(.caption).foregroundStyle(Theme.sand)
                Picker("Body", selection: $profile.sex) {
                    Text("From my scan").tag(BodyProfile.Sex?.none)
                    ForEach(BodyProfile.Sex.allCases, id: \.self) { Text($0.label).tag(BodyProfile.Sex?.some($0)) }
                }
                .pickerStyle(.segmented)
            }
            Button("Make my mannequin") {
                consent = true
                Task { await maker.make(sex: profile.sex) }
            }
            .buttonStyle(TailoredButtonStyle())
        }
        .padding(24)
        .background(Theme.cream)
        .padding(20)
    }
}
