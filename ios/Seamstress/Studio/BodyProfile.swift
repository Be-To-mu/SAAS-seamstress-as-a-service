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
    static let groups = ["Upper body", "Arms", "Lengths", "Legs"]

    static let all: [MeasureDef] = [
        .init(id: "bust", label: "Chest / bust", hint: "Fullest part, under the arms", group: "Upper body", webKey: "chest", range: 70...160),
        .init(id: "underbust", label: "Underbust", hint: "Just below the bust", group: "Upper body", webKey: nil, range: 60...140),
        .init(id: "waist", label: "Waist", hint: "Natural, narrowest waist", group: "Upper body", webKey: "waist", range: 55...150),
        .init(id: "high_hip", label: "High hip", hint: "Halfway waist to hip", group: "Upper body", webKey: nil, range: 65...160),
        .init(id: "hip", label: "Hip", hint: "Fullest part of the seat", group: "Upper body", webKey: "hip", range: 75...160),
        .init(id: "neck", label: "Neck", hint: "Around the base of the neck", group: "Upper body", webKey: "neck", range: 30...50),
        .init(id: "shoulder_across_back", label: "Shoulder", hint: "Shoulder point to shoulder point, across the back", group: "Upper body", webKey: "shoulder", range: 34...60),
        .init(id: "arm_length", label: "Arm length", hint: "Shoulder point over the elbow to the wrist", group: "Arms", webKey: "armLength", range: 50...80),
        .init(id: "upper_arm", label: "Bicep", hint: "Around the upper arm", group: "Arms", webKey: "bicep", range: 22...50),
        .init(id: "wrist", label: "Wrist", hint: "Around the wrist bone", group: "Arms", webKey: "wrist", range: 14...24),
        .init(id: "height", label: "Height", hint: "Floor to top of head", group: "Lengths", webKey: nil, range: 140...215),
        .init(id: "back_length", label: "Back length", hint: "Nape to waist", group: "Lengths", webKey: "backLength", range: 35...55),
        .init(id: "nape_to_hip", label: "Nape to hip", hint: "Down the back to the fullest hip", group: "Lengths", webKey: "napeToHip", range: 50...90),
        .init(id: "waist_to_hip", label: "Waist to hip", hint: "Waist down to the fullest hip", group: "Lengths", webKey: "waistToHip", range: 14...30),
        .init(id: "rise", label: "Rise", hint: "Waist to crotch", group: "Lengths", webKey: nil, range: 18...40),
        .init(id: "inseam", label: "Inside leg", hint: "Crotch to floor", group: "Lengths", webKey: nil, range: 60...100),
        .init(id: "outseam", label: "Outside leg", hint: "Waist to floor", group: "Lengths", webKey: nil, range: 80...130),
        .init(id: "thigh", label: "Thigh", hint: "Just below the crotch", group: "Legs", webKey: nil, range: 40...80),
        .init(id: "knee", label: "Knee", hint: "Around the knee", group: "Legs", webKey: nil, range: 30...50),
        .init(id: "calf", label: "Calf", hint: "Fullest part of the calf", group: "Legs", webKey: nil, range: 28...50),
    ]

    /// The web engine needs these; the rest are optional or for later garments.
    static let requiredWebKeys: Set<String> = ["chest", "waist", "hip", "shoulder", "neck", "backLength", "armLength", "bicep"]
}

@MainActor
final class BodyProfile: ObservableObject {
    @Published private(set) var scanValues: [String: Double] = [:]
    @Published private(set) var edits: [String: Double] = [:]
    @Published private(set) var scanName: String?

    private struct Stored: Codable {
        var scanName: String?
        var scan: [String: Double]
        var edits: [String: Double]
    }

    private static var file: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appending(path: "profile.json")
    }

    init() {
        if let data = try? Data(contentsOf: Self.file), let s = try? JSONDecoder().decode(Stored.self, from: data) {
            scanName = s.scanName
            scanValues = s.scan
            edits = s.edits
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

    private func save() {
        let s = Stored(scanName: scanName, scan: scanValues, edits: edits)
        try? JSONEncoder().encode(s).write(to: Self.file)
    }
}
