import Foundation

/// Scans live in Documents/scans/<date>/ (also visible in the Files app). Each
/// folder is a bodyfit capture bundle. In demo mode the Mac (`bodyfit usb`)
/// adds status.json, then body.obj + measurements.json, over the cable.
enum ScanStore {
    static var root: URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return docs.appending(path: "scans")
    }

    static func newScanFolder() -> URL {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd_HH-mm-ss"
        return root.appending(path: f.string(from: Date()))
    }

    static func all() -> [URL] {
        let items = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? []
        return items
            .filter { FileManager.default.fileExists(atPath: $0.appending(path: "capture.json").path) }
            .sorted { $0.lastPathComponent > $1.lastPathComponent }
    }

    /// The phone keeps one body: drop every scan except `keep`.
    static func keepOnly(_ keep: URL) {
        for scan in all() where scan.standardizedFileURL != keep.standardizedFileURL {
            try? FileManager.default.removeItem(at: scan)
        }
    }

    static var current: URL? { all().first }

    struct Status: Decodable {
        let state: String  // fitting | done | failed
        let error: String?
        let step: String?  // e.g. "Fitting your shape"
        let progress: Double?  // 0…1
    }

    struct Measurements: Decodable {
        let measurementsCm: [String: Double?]
        let definitions: [String: String]
        let order: [String]
        /// Where each girth's tape lies (closed loops), and each length's line; y-up metres like body.obj.
        let tapes: [String: [[[Double]]]]?
        let lines: [String: [[Double]]]?

        enum CodingKeys: String, CodingKey {
            case definitions, order, tapes, lines
            case measurementsCm = "measurements_cm"
        }
    }

    static func status(of scan: URL) -> Status? { decode(scan.appending(path: "status.json")) }
    static func measurements(of scan: URL) -> Measurements? { decode(scan.appending(path: "measurements.json")) }

    static func mesh(of scan: URL) -> URL? {
        let url = scan.appending(path: "body.obj")
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    private static func decode<T: Decodable>(_ url: URL) -> T? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }
}
