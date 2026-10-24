import Foundation

/// Scans live in Documents/scans/<date>/ (visible in the Files app). Each folder
/// is a bodyfit capture bundle plus `remote.json` once it has been uploaded.
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

    static func remoteID(of scan: URL) -> String? {
        guard let data = try? Data(contentsOf: scan.appending(path: "remote.json")),
              let doc = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return doc["id"] as? String
    }

    static func setRemoteID(_ id: String, of scan: URL) throws {
        let data = try JSONSerialization.data(withJSONObject: ["id": id])
        try data.write(to: scan.appending(path: "remote.json"))
    }
}
