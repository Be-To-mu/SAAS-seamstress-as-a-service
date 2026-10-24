import SwiftUI

/// The garment being designed, shared by the Design, Style and Pattern screens.
@MainActor
final class DesignDraft: ObservableObject {
    @Published var name = "Garment"
    @Published var spec: Spec = [:]
    @Published var features: [Feature] = []
    @Published var notes = ""
    @Published var savedID: String?
    /// What the design came from, and the picture Gemini made of it.
    @Published var references: [String] = []
    @Published var words = ""
    @Published var picture: UIImage?

    var family: String { spec["family"]?.string ?? "coat" }

    func start(family: String) {
        spec = (try? Engine.shared.call("defaultSpecFor", [family], as: Spec.self)) ?? ["family": .string(family)]
        name = Engine.familyLabel(family)
        features = []
        notes = ""
        savedID = nil
    }

    func adopt(_ result: DesignResult) {
        if result.family != family { features = [] }
        spec = result.spec
        name = result.garment.capitalized
        var lines: [String] = []
        if !result.reason.isEmpty { lines.append(result.reason) }
        if !result.fitsFamily { lines.append("This is the closest shape the pattern blocks can make.") }
        if !result.unsupported.isEmpty { lines.append("Not included yet: \(result.unsupported.joined(separator: ", ")).") }
        notes = lines.joined(separator: " ")
        savedID = nil
        picture = nil
    }

    func load(_ g: SavedGarment) {
        name = g.name
        spec = g.spec
        features = g.features
        notes = ""
        savedID = g.id
        picture = GarmentStore.picture(g.id)
    }

    var color: Color { Color(hex: spec["clothColor"]?.string ?? "#a9794a") }
}

extension Engine {
    static let families: [Family] = (try? shared.call("families", [], as: [Family].self)) ?? []
    static func familyLabel(_ id: String) -> String { families.first { $0.id == id }?.label ?? id.capitalized }
}

/// Garments the user made, in Documents/garments/<id>.json.
struct SavedGarment: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var spec: Spec
    var features: [Feature]
    var measurements: [String: Double]
    var created: Date

    var family: String { spec["family"]?.string ?? "coat" }
    var color: Color { Color(hex: spec["clothColor"]?.string ?? "#a9794a") }
}

@MainActor
enum GarmentStore {
    static var folder: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appending(path: "garments")
    }

    static func all() -> [SavedGarment] {
        let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return files.compactMap { try? decoder.decode(SavedGarment.self, from: Data(contentsOf: $0)) }
            .sorted { $0.created > $1.created }
    }

    static func get(_ id: String) -> SavedGarment? { all().first { $0.id == id } }

    @discardableResult
    static func save(_ draft: DesignDraft, measurements: [String: Double]) throws -> SavedGarment {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let g = SavedGarment(id: draft.savedID ?? UUID().uuidString, name: draft.name, spec: draft.spec,
                             features: draft.features, measurements: measurements, created: Date())
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        try encoder.encode(g).write(to: folder.appending(path: "\(g.id).json"))
        if let jpeg = draft.picture?.jpegData(compressionQuality: 0.85) {
            try jpeg.write(to: folder.appending(path: "\(g.id).jpg"))
        }
        return g
    }

    static func picture(_ id: String) -> UIImage? {
        UIImage(contentsOfFile: folder.appending(path: "\(id).jpg").path)
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
