import Foundation

/// Talks to `bodyfit serve` (bodyfit/src/bodyfit/server.py).
struct BodyfitClient {
    struct Status: Decodable {
        let state: String  // queued | fitting | done | failed
        let error: String?
        let measurementsCm: [String: Double?]?
        let definitions: [String: String]?
        let order: [String]?

        enum CodingKeys: String, CodingKey {
            case state, error, definitions, order
            case measurementsCm = "measurements_cm"
        }
    }

    let base: URL

    static var configured: BodyfitClient? {
        guard let s = Bundle.main.object(forInfoDictionaryKey: "BodyfitServiceURL") as? String,
              let url = URL(string: s) else { return nil }
        return BodyfitClient(base: url)
    }

    func upload(scan folder: URL) async throws -> String {
        let zip = try zipped(folder)
        defer { try? FileManager.default.removeItem(at: zip) }
        var request = URLRequest(url: base.appending(path: "scans"))
        request.httpMethod = "POST"
        request.setValue("application/zip", forHTTPHeaderField: "Content-Type")
        let (data, response) = try await URLSession.shared.upload(for: request, fromFile: zip)
        try check(response, data)
        struct Created: Decodable { let id: String }
        return try JSONDecoder().decode(Created.self, from: data).id
    }

    func status(id: String) async throws -> Status {
        let (data, response) = try await URLSession.shared.data(from: base.appending(path: "scans/\(id)"))
        try check(response, data)
        return try JSONDecoder().decode(Status.self, from: data)
    }

    func downloadMesh(id: String, to url: URL) async throws {
        let (data, response) = try await URLSession.shared.data(from: base.appending(path: "scans/\(id)/body.obj"))
        try check(response, data)
        try data.write(to: url)
    }

    private func check(_ response: URLResponse, _ data: Data) throws {
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let text = String(data: data, encoding: .utf8) ?? ""
            throw NSError(domain: "bodyfit", code: (response as? HTTPURLResponse)?.statusCode ?? -1,
                          userInfo: [NSLocalizedDescriptionKey: "Service error: \(text.prefix(200))"])
        }
    }

    /// Zips a folder with the system's built-in archiver.
    private func zipped(_ folder: URL) throws -> URL {
        var coordError: NSError?
        var result: Result<URL, Error> = .failure(CocoaError(.fileReadUnknown))
        NSFileCoordinator().coordinate(readingItemAt: folder, options: .forUploading, error: &coordError) { zip in
            let dest = FileManager.default.temporaryDirectory.appending(path: folder.lastPathComponent + ".zip")
            try? FileManager.default.removeItem(at: dest)
            result = Result { try FileManager.default.copyItem(at: zip, to: dest); return dest }
        }
        if let coordError { throw coordError }
        return try result.get()
    }
}
