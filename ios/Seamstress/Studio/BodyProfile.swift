import Foundation
import SwiftUI

/// Every body measurement a garment can need, filled from the scan and
/// editable by hand. Saved to Documents/profile.json. `webKey` is the name the
/// pattern engine uses; `range` is its accepted range (web measurementsSchema).
struct MeasureDef: Identifiable, Hashable {
    let id: String  // bodyfit key in measurements.json
    let label: String
    let hint: String
    let group: String
    let webKey: String?
    let range: ClosedRange<Double>
}

enum MeasureCatalog {
    static let groups = ["Body", "Top", "Arms", "Bottom"]

    static let all: [MeasureDef] = [
        .init(id: "bust", label: "Chest / bust", hint: "Fullest part, under the arms", group: "Top", webKey: "chest", range: 70...160),
        .init(id: "underbust", label: "Underbust", hint: "Just below the bust", group: "Top", webKey: nil, range: 60...140),
        .init(id: "waist", label: "Waist", hint: "Natural, narrowest waist", group: "Top", webKey: "waist", range: 55...150),
        .init(id: "high_hip", label: "High hip", hint: "Halfway waist to hip", group: "Bottom", webKey: nil, range: 65...160),
        .init(id: "hip", label: "Hip", hint: "Fullest part of the seat", group: "Bottom", webKey: "hip", range: 75...160),
        .init(id: "neck", label: "Neck", hint: "Around the base of the neck", group: "Body", webKey: "neck", range: 30...50),
        .init(id: "shoulder_across_back", label: "Shoulder", hint: "Shoulder point to shoulder point, across the back", group: "Body", webKey: "shoulder", range: 34...60),
        .init(id: "arm_length", label: "Arm length", hint: "Shoulder point over the elbow to the wrist", group: "Arms", webKey: "armLength", range: 50...80),
        .init(id: "upper_arm", label: "Bicep", hint: "Around the upper arm", group: "Arms", webKey: "bicep", range: 22...50),
        .init(id: "wrist", label: "Wrist", hint: "Around the wrist bone", group: "Arms", webKey: "wrist", range: 14...24),
        .init(id: "height", label: "Height", hint: "Floor to top of head", group: "Body", webKey: nil, range: 140...215),
        .init(id: "back_length", label: "Back length", hint: "Nape to waist", group: "Top", webKey: "backLength", range: 35...55),
        .init(id: "nape_to_hip", label: "Nape to hip", hint: "Down the back to the fullest hip", group: "Top", webKey: "napeToHip", range: 50...90),
        .init(id: "waist_to_hip", label: "Waist to hip", hint: "Waist down to the fullest hip", group: "Bottom", webKey: "waistToHip", range: 14...30),
        .init(id: "rise", label: "Rise", hint: "Waist to crotch", group: "Bottom", webKey: nil, range: 18...40),
        .init(id: "inseam", label: "Inside leg", hint: "Crotch to floor", group: "Bottom", webKey: nil, range: 60...100),
        .init(id: "outseam", label: "Outside leg", hint: "Waist to floor", group: "Bottom", webKey: nil, range: 80...130),
        .init(id: "thigh", label: "Thigh", hint: "Just below the crotch", group: "Bottom", webKey: nil, range: 40...80),
        .init(id: "knee", label: "Knee", hint: "Around the knee", group: "Bottom", webKey: nil, range: 30...50),
        .init(id: "calf", label: "Calf", hint: "Fullest part of the calf", group: "Bottom", webKey: nil, range: 28...50),
    ]

    /// How to take each measurement with a tape, and a quick way to check the number.
    static let howTo: [String: (measure: String, check: String)] = [
        "height": ("Stand barefoot against a wall, heels together. Lay a book flat on your head, mark the wall under it and measure from the floor to the mark.",
                   "It should match the height on your passport or driving licence within 1–2 cm."),
        "neck": ("Wrap the tape around the base of your neck, where a shirt collar sits, with one finger under the tape.",
                 "Compare with the collar size of a shirt that fits: collar sizes are this number plus 1–2 cm."),
        "shoulder_across_back": ("Ask someone to measure across your back from one shoulder point (the bony tip at the top of the arm) to the other, following the curve.",
                                 "A well-fitting shirt's shoulder seam to shoulder seam, laid flat, should be within 2 cm."),
        "bust": ("Under your arms, around the fullest part of the chest and across the shoulder blades. Keep the tape level and breathe normally.",
                 "Usually 8–15 cm more than your waist; a jacket that fits measures about 8–12 cm more, laid flat ×2."),
        "underbust": ("Directly under the bust, level all the way round, snug but not tight.",
                      "Close to your bra band size in cm, or 5–15 cm less than the bust."),
        "waist": ("Around your natural waist: the narrowest part, usually just above the belly button. Stand relaxed, don't hold your breath in.",
                  "Bend to one side: the crease that forms is your natural waist."),
        "back_length": ("From the bone that sticks out at the base of your neck (the nape) straight down your spine to your natural waist. Easiest with a helper.",
                        "Usually 38–46 cm for adults; tie a string round your waist first to see where to stop."),
        "nape_to_hip": ("From the nape straight down your back to the level of the fullest part of your seat.",
                        "Back length plus waist-to-hip should come to about this number."),
        "arm_length": ("Arm relaxed and slightly bent. From the shoulder point, over the elbow, down to the wrist bone.",
                       "A shirt sleeve that ends at your wrist bone, from the shoulder seam, should be about this long."),
        "upper_arm": ("Around the fullest part of the upper arm, arm relaxed by your side.",
                      "Usually about a third of your chest measurement."),
        "wrist": ("Around the wrist, over the wrist bone.",
                  "Most adults measure 14–20 cm."),
        "high_hip": ("Around the top of the hip bones, halfway between your waist and your fullest hip.",
                     "It falls between your waist and hip numbers."),
        "hip": ("Feet together, around the fullest part of your seat, keeping the tape level. Check it in a mirror from the side.",
                "Trousers that fit measure about this, laid flat ×2, plus 2–6 cm."),
        "waist_to_hip": ("Down the side of the body, from the natural waist to the fullest part of the hip.",
                         "Usually 18–23 cm."),
        "rise": ("Sitting on a firm chair: down the side from your natural waist to the seat of the chair.",
                 "Waist-to-floor minus inside leg should give about the same number."),
        "inseam": ("Barefoot, from the crotch straight down the inside of the leg to the floor. Easiest with a helper or with trousers that fit, laid flat.",
                   "Often the second number on jeans labels, in inches ×2.54."),
        "outseam": ("From the natural waist down the outside of the leg to the floor, barefoot.",
                    "About inside leg plus rise."),
        "thigh": ("Around the fullest part of the thigh, just below the crotch, standing.",
                  "Usually a little over half your hip."),
        "knee": ("Around the middle of the knee, leg straight.", "Most adults measure 33–45 cm."),
        "calf": ("Around the fullest part of the calf, standing with weight on both feet.", "Most adults measure 32–42 cm."),
    ]

    /// The web engine needs these; the rest are optional or for later garments.
    static let requiredWebKeys: Set<String> = ["chest", "waist", "hip", "shoulder", "neck", "backLength", "armLength", "bicep"]
}

@MainActor
final class BodyProfile: ObservableObject {
    @Published private(set) var scanValues: [String: Double] = [:]
    @Published private(set) var edits: [String: Double] = [:]
    @Published private(set) var scanName: String?
    /// The body the mannequin is made as; nil = read it from the scan photos.
    @Published var sex: Sex? { didSet { if sex != oldValue { save() } } }

    enum Sex: String, Codable, CaseIterable {
        case female, male
        var label: String { self == .female ? "Female" : "Male" }
    }

    private struct Stored: Codable {
        var scanName: String?
        var scan: [String: Double]
        var edits: [String: Double]
        var sex: Sex?
    }

    private static var file: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appending(path: "profile.json")
    }

    init() {
        if let data = try? Data(contentsOf: Self.file), let s = try? JSONDecoder().decode(Stored.self, from: data) {
            scanName = s.scanName
            scanValues = s.scan
            edits = s.edits
            sex = s.sex
        }
    }

    /// Take the scan's measurements. A new scan is a new body, so earlier edits go.
    func adopt(scan: URL, measurements: ScanStore.Measurements) {
        let name = scan.lastPathComponent
        let values = measurements.measurementsCm.compactMapValues { $0 }
        guard name != scanName || values != scanValues else { return }
        if name != scanName { edits = [:] }
        scanName = name
        scanValues = values
        save()
    }

    func value(_ key: String) -> Double? { edits[key] ?? scanValues[key] }
    func isEdited(_ key: String) -> Bool { edits[key] != nil }

    func set(_ key: String, _ value: Double?) {
        if let value, value != scanValues[key] { edits[key] = value } else { edits[key] = nil }
        save()
    }

    func reset(_ key: String) { set(key, nil) }

    /// The measurements as the pattern engine expects them (web names, cm).
    var webMeasurements: [String: Double] {
        var out: [String: Double] = [:]
        for m in MeasureCatalog.all {
            if let key = m.webKey, let v = value(m.id) { out[key] = (v * 10).rounded() / 10 }
        }
        return out
    }

    /// Missing or out-of-range measurements the engine needs.
    var problems: [MeasureDef] {
        MeasureCatalog.all.filter { m in
            guard let key = m.webKey else { return false }
            guard let v = value(m.id) else { return MeasureCatalog.requiredWebKeys.contains(key) }
            return !m.range.contains(v)
        }
    }

    /// Forget the body (Reset the app).
    func reset() {
        scanValues = [:]
        edits = [:]
        scanName = nil
        sex = nil
        try? FileManager.default.removeItem(at: Self.file)
    }

    private func save() {
        let s = Stored(scanName: scanName, scan: scanValues, edits: edits, sex: sex)
        try? JSONEncoder().encode(s).write(to: Self.file)
    }
}
