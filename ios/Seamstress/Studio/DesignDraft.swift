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
    /// How it should look, in words (from the design); the pictures follow it, the pattern follows `spec`.
    @Published var look = ""
    @Published var savedID: String?
    /// What the design came from.
    @Published var references: [String] = []
    @Published var words = ""
    /// The turnaround, keyed by camera angle (0 = front), and the try-on photo.
    @Published var views: [Int: UIImage] = [:]
    @Published var tryOn: UIImage?
    /// The spec changed after the views were drawn.
    @Published var viewsStale = false
    /// The design the views were drawn from. On me dresses the mannequin in this, so it always
    /// shows the same garment as Images, even after an edit that hasn't been redrawn yet.
    @Published var drawn: Drawn?

    struct Drawn: Equatable {
        var spec: Spec
        var features: [Feature]
        var look: String
        /// When the front was drawn: a redraw of the same design is still a different picture.
        var at = Date()
    }

    private var current: Drawn { Drawn(spec: spec, features: features, look: look) }
    /// The wearer's adjustments from the fitting (cm): length, waist, shoulder, sleeve.
    @Published var fit: [String: Double] = [:]
    /// The order placed with a seamstress, if any.
    @Published var order: Order?
    /// Offered in the marketplace, for others to have made.
    @Published var forSale = false

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
        look = ""
        savedID = nil
        tryOn = nil
        viewsStale = false
        drawn = nil
        fit = [:]
        order = nil
        forSale = false
    }

    func adopt(_ result: DesignResult) {
        views = [:]
        drawn = nil
        if result.family != family { features = [] }
        tryOn = nil
        spec = result.spec
        look = result.look ?? ""
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
        look = g.look ?? ""
        savedID = g.id
        views = GarmentStore.views(g.id)
        tryOn = GarmentStore.tryOn(g.id)
        fit = g.fit ?? [:]
        order = GarmentStore.order(g.id)
        forSale = g.forSale ?? false
        references = GarmentStore.reference(g.id)?.dataURL().map { [$0] } ?? []
        words = ""
        viewsStale = false
        // Kept views were drawn from the kept design, when the front was written.
        drawn = views.isEmpty ? nil : Drawn(spec: spec, features: features, look: look, at: g.drawnAt ?? .distantPast)
    }

    /// Draw the turnaround: the front first (from the spec), then the other angles from the front,
    /// a few at a time. `progress` gets the number of views done.
    func drawViews(keepExisting: Bool = false, onFront: (() -> Void)? = nil,
                   progress: @escaping (Int) -> Void) async throws {
        let extras = features.map(\.request)
        let words = self.words.trimmingCharacters(in: .whitespacesAndNewlines)
        if !keepExisting { views = [:] }
        let front: UIImage
        if let existing = views[0] {
            front = existing
        } else {
            let design = current
            front = try await Gemini.picture(PictureInput(spec: spec, images: references, description: words.isEmpty ? nil : words,
                                                          look: look.isEmpty ? nil : look, extras: extras))
            views[0] = front
            drawn = design
        }
        onFront?()
        progress(views.count)
        guard let frontURL = front.dataURL() else { return }
        let spec = self.spec
        let look = self.look.isEmpty ? nil : self.look
        var done = views.count
        var firstError: Error?
        // In waves, so every view agrees with the ones drawn before it: the sides from the front, then
        // the back from the front and a side, then the back three-quarters from all of those (the back
        // is never seen from the front, so without this each angle invented its own).
        let waves: [(angles: [Int], refs: [Int])] = [([45, 315, 90, 270], []), ([180], [90]), ([135, 225], [180, 90, 270])]
        for wave in waves {
            let todo = wave.angles.filter { Self.angles.contains($0) && views[$0] == nil }
            if todo.isEmpty { continue }
            await withTaskGroup(of: (Int, Result<UIImage, Error>).self) { group in
                for angle in todo {
                    // The nearest of the references for this angle, small: enough to match details.
                    let refs = wave.refs.filter { $0 != angle }.sorted { abs($0 - angle) < abs($1 - angle) }.prefix(2)
                    let others = refs.compactMap { a in views[a]?.dataURL(side: 768).map { ViewInput.Other(angle: a, image: $0) } }
                    group.addTask {
                        let input = ViewInput(spec: spec, extras: extras, front: frontURL, angle: angle,
                                              others: others.isEmpty ? nil : others, look: look)
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
    var fit: [String: Double]?
    var look: String?
    /// When its views were drawn (On me keys its pictures by it).
    var drawnAt: Date?
    /// Offered in the marketplace.
    var forSale: Bool?

    var family: String { spec["family"]?.string ?? "coat" }
    var color: Color { Color(hex: spec["clothColor"]?.string ?? "#a9794a") }
}

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

    @MainActor @discardableResult
    static func save(_ draft: DesignDraft, measurements: [String: Double]) throws -> SavedGarment {
        let id = draft.savedID ?? UUID().uuidString.lowercased()
        let dir = folder(id)
        let fm = FileManager.default
        try fm.createDirectory(at: dir.appending(path: "views"), withIntermediateDirectories: true)
        let g = SavedGarment(id: id, name: draft.name, spec: draft.spec, features: draft.features,
                             measurements: measurements, created: Date(), source: "iphone",
                             fit: draft.fit.isEmpty ? nil : draft.fit, look: draft.look.isEmpty ? nil : draft.look, drawnAt: draft.drawn?.at, forSale: draft.forSale ? true : nil)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        for (angle, image) in draft.views {
            try image.jpegData(compressionQuality: 0.85)?.write(to: dir.appending(path: "views/\(angle).jpg"))
        }
        if let tryOn = draft.tryOn { try tryOn.jpegData(compressionQuality: 0.85)?.write(to: dir.appending(path: "tryon.jpg")) }
        if let order = draft.order { try encoder.encode(order).write(to: dir.appending(path: "order.json")) }
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
        return out
    }

    /// The garment's own front view (never the reference photo).
    static func frontFile(_ id: String) -> URL? {
        let url = folder(id).appending(path: "views/0.jpg")
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    static func front(_ id: String) -> UIImage? { frontFile(id).flatMap { UIImage(contentsOfFile: $0.path) } }

    /// The photo the design started from (web garments keep only this).
    static func reference(_ id: String) -> UIImage? {
        UIImage(contentsOfFile: folder(id).appending(path: "reference.jpg").path)
    }

    /// Store a newly drawn front; the Mac uploads the garment again.
    static func setFront(_ id: String, _ image: UIImage) {
        let dir = folder(id).appending(path: "views")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? image.jpegData(compressionQuality: 0.85)?.write(to: dir.appending(path: "0.jpg"))
        try? FileManager.default.removeItem(at: folder(id).appending(path: "synced.json"))
    }

    /// Changes when garments are added, removed, synced or get new pictures.
    static func signature() -> String {
        let fm = FileManager.default
        let ids = ((try? fm.contentsOfDirectory(atPath: root.path)) ?? []).sorted()
        return ids.map { id in
            let views = (try? fm.contentsOfDirectory(atPath: folder(id).appending(path: "views").path))?.count ?? 0
            let synced = fm.fileExists(atPath: folder(id).appending(path: "synced.json").path)
            return "\(id):\(views):\(synced)"
        }.joined(separator: ",")
    }

    static func tryOn(_ id: String) -> UIImage? {
        UIImage(contentsOfFile: folder(id).appending(path: "tryon.jpg").path)
    }

    static func order(_ id: String) -> Order? {
        guard let data = try? Data(contentsOf: folder(id).appending(path: "order.json")) else { return nil }
        return try? decoder.decode(Order.self, from: data)
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
