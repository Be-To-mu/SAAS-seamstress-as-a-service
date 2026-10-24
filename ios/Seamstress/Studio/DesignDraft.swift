import SwiftUI

/// The garment being designed, shared by the Design, Creating, Spin, Try-on,
/// Style and Pattern screens.
@MainActor
final class DesignDraft: ObservableObject {
    static let angles: [Int] = (try? Engine.shared.call("viewAngles", [], as: [Int].self)) ?? [0, 45, 90, 135, 180, 225, 270, 315]

    @Published var name = "Garment"
    @Published var spec: Spec = [:] { didSet { if spec != oldValue, !views.isEmpty { viewsStale = true } } }
    @Published var features: [Feature] = [] { didSet { if features != oldValue, !views.isEmpty { viewsStale = true } } }
    @Published var notes = ""
    @Published var savedID: String?
    /// What the design came from.
    @Published var references: [String] = []
    @Published var words = ""
    /// The turnaround, keyed by camera angle (0 = front), and the try-on photo.
    @Published var views: [Int: UIImage] = [:]
    @Published var tryOn: UIImage?
    /// The spec changed after the views were drawn.
    @Published var viewsStale = false

    var family: String { spec["family"]?.string ?? "coat" }
    var front: UIImage? { views[0] }
    var color: Color { Color(hex: spec["clothColor"]?.string ?? "#a9794a") }

    /// A fresh design request: forget the last garment.
    func reset() {
        views = [:]
        name = "Garment"
        spec = [:]
        features = []
        notes = ""
        savedID = nil
        tryOn = nil
        viewsStale = false
    }

    func adopt(_ result: DesignResult) {
        views = [:]
        if result.family != family { features = [] }
        tryOn = nil
        spec = result.spec
        viewsStale = false
        name = result.garment.capitalized
        var lines: [String] = []
        if !result.reason.isEmpty { lines.append(result.reason) }
        if !result.fitsFamily { lines.append("This is the closest shape the pattern blocks can make.") }
        if !result.unsupported.isEmpty { lines.append("Not included yet: \(result.unsupported.joined(separator: ", ")).") }
        notes = lines.joined(separator: " ")
    }

    func load(_ g: SavedGarment) {
        views = [:]
        name = g.name
        spec = g.spec
        features = g.features
        notes = ""
        savedID = g.id
        views = GarmentStore.views(g.id)
        tryOn = GarmentStore.tryOn(g.id)
        viewsStale = false
    }

    /// Draw the turnaround: the front first (from the spec), then the other angles from the front,
    /// a few at a time. `progress` gets the number of views done.
    func drawViews(progress: @escaping (Int) -> Void) async throws {
        let extras = features.map(\.request)
        let words = self.words.trimmingCharacters(in: .whitespacesAndNewlines)
        views = [:]
        let front = try await Gemini.picture(PictureInput(spec: spec, images: references,
                                                          description: words.isEmpty ? nil : words, extras: extras))
        views[0] = front
        progress(1)
        guard let frontURL = front.dataURL() else { return }
        let spec = self.spec
        let rest = Self.angles.filter { $0 != 0 }
        var done = 1
        var firstError: Error?
        // Three at a time keeps it quick without tripping rate limits.
        for batch in stride(from: 0, to: rest.count, by: 3).map({ Array(rest[$0..<min($0 + 3, rest.count)]) }) {
            await withTaskGroup(of: (Int, Result<UIImage, Error>).self) { group in
                for angle in batch {
                    group.addTask {
                        let input = ViewInput(spec: spec, extras: extras, front: frontURL, angle: angle)
                        do { return (angle, .success(try await Gemini.view(input))) } catch { return (angle, .failure(error)) }
                    }
                }
                for await (angle, result) in group {
                    switch result {
                    case .success(let image): views[angle] = image
                    case .failure(let error): firstError = firstError ?? error
                    }
                    done += 1
                    progress(done)
                }
            }
        }
        viewsStale = false
        if views.count < 2, let firstError { throw firstError }
    }
}

extension Engine {
    static let families: [Family] = (try? shared.call("families", [], as: [Family].self)) ?? []
    static func familyLabel(_ id: String) -> String { families.first { $0.id == id }?.label ?? id.capitalized }
}

/// A garment in the wardrobe. On the phone: Documents/garments/<id>/garment.json,
/// views/<angle>.jpg and tryon.jpg. The Mac (`bodyfit usb`) syncs these folders
/// with MongoDB and writes synced.json when a garment is stored there.
struct SavedGarment: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var spec: Spec
    var features: [Feature]
    var measurements: [String: Double]
    var created: Date
    var source: String?

    var family: String { spec["family"]?.string ?? "coat" }
    var color: Color { Color(hex: spec["clothColor"]?.string ?? "#a9794a") }
}

@MainActor
enum GarmentStore {
    static var root: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appending(path: "garments")
    }

    static func folder(_ id: String) -> URL { root.appending(path: id) }

    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    static func all() -> [SavedGarment] {
        let items = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? []
        return items.compactMap { try? decoder.decode(SavedGarment.self, from: Data(contentsOf: $0.appending(path: "garment.json"))) }
            .sorted { $0.created > $1.created }
    }

    static func get(_ id: String) -> SavedGarment? { all().first { $0.id == id } }

    @discardableResult
    static func save(_ draft: DesignDraft, measurements: [String: Double]) throws -> SavedGarment {
        let id = draft.savedID ?? UUID().uuidString.lowercased()
        let dir = folder(id)
        let fm = FileManager.default
        try fm.createDirectory(at: dir.appending(path: "views"), withIntermediateDirectories: true)
        let g = SavedGarment(id: id, name: draft.name, spec: draft.spec, features: draft.features,
                             measurements: measurements, created: Date(), source: "iphone")
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        for (angle, image) in draft.views {
            try image.jpegData(compressionQuality: 0.85)?.write(to: dir.appending(path: "views/\(angle).jpg"))
        }
        if let tryOn = draft.tryOn { try tryOn.jpegData(compressionQuality: 0.85)?.write(to: dir.appending(path: "tryon.jpg")) }
        try? fm.removeItem(at: dir.appending(path: "synced.json"))  // changed: the Mac uploads it again
        try encoder.encode(g).write(to: dir.appending(path: "garment.json"))
        return g
    }

    static func views(_ id: String) -> [Int: UIImage] {
        let dir = folder(id).appending(path: "views")
        let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
        var out: [Int: UIImage] = [:]
        for f in files {
            if let angle = Int(f.deletingPathExtension().lastPathComponent), let img = UIImage(contentsOfFile: f.path) { out[angle] = img }
        }
        if out.isEmpty, let thumb = UIImage(contentsOfFile: folder(id).appending(path: "thumbnail.jpg").path) { out[0] = thumb }
        return out
    }

    static func front(_ id: String) -> UIImage? {
        UIImage(contentsOfFile: folder(id).appending(path: "views/0.jpg").path)
            ?? UIImage(contentsOfFile: folder(id).appending(path: "thumbnail.jpg").path)
    }

    static func tryOn(_ id: String) -> UIImage? {
        UIImage(contentsOfFile: folder(id).appending(path: "tryon.jpg").path)
    }

    static func isSynced(_ id: String) -> Bool {
        FileManager.default.fileExists(atPath: folder(id).appending(path: "synced.json").path)
    }
}

extension Color {
    init(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        let v = UInt64(s, radix: 16) ?? 0xa9794a
        self.init(red: Double((v >> 16) & 0xff) / 255, green: Double((v >> 8) & 0xff) / 255, blue: Double(v & 0xff) / 255)
    }

    var hex: String {
        let c = UIColor(self).cgColor.components ?? [0, 0, 0]
        let rgb = c.count >= 3 ? Array(c.prefix(3)) : [c[0], c[0], c[0]]
        return String(format: "#%02x%02x%02x", Int(rgb[0] * 255), Int(rgb[1] * 255), Int(rgb[2] * 255))
    }
}
