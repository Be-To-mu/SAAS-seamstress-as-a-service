import Foundation
import UIKit

/// Gemini over its REST API, straight from the phone (it has internet even when
/// it can't reach the Mac). The prompt and the reading of the answer come from
/// the shared engine, so the phone asks exactly what the web studio asks.
enum Gemini {
    static var apiKey: String? {
        let key = Bundle.main.object(forInfoDictionaryKey: "GeminiAPIKey") as? String
        return (key?.isEmpty ?? true) ? nil : key
    }

    static var model: String {
        let m = Bundle.main.object(forInfoDictionaryKey: "GeminiModel") as? String
        return (m?.isEmpty ?? true) ? "gemini-4-argon" : m!
    }

    /// Photos and/or words → a garment design. Without a key, the web's demo defaults.
    static func design(_ input: DesignInput) async throws -> DesignResult {
        let engine = Engine.shared
        guard let key = apiKey else { return try engine.call("designDemo", [input]) }
        let request: DesignRequest = try engine.call("designRequest", [input])
        let raw = try await askJSON(parts: request.parts, system: request.system, key: key)
        return try engine.call("designResult", [raw, input, model])
    }

    /// The image model the web studio uses for garment pictures.
    static let imageModel = "gemini-3.1-flash-image"

    /// A product-style picture of the designed garment (an illustration; the pattern comes from the spec).
    static func picture(_ input: PictureInput) async throws -> UIImage {
        try await image(try Engine.shared.call("pictureRequest", [input]))
    }

    /// The same garment from another angle (a turnaround view), given its front picture.
    static func view(_ input: ViewInput) async throws -> UIImage {
        try await image(try Engine.shared.call("viewRequest", [input]), size: "512")
    }

    /// A plain dress-form with the person's exact shape and pose, from one stop photo.
    static func mannequin(_ input: MannequinInput) async throws -> UIImage {
        try await image(try Engine.shared.call("mannequinRequest", [input]))
    }

    /// The mannequin, from one angle, wearing the garment.
    static func dress(_ input: DressInput) async throws -> UIImage {
        try await image(try Engine.shared.call("dressRequest", [input]), size: "512")
    }

    /// One picture from the image model.
    /// `size` is the image model's output size: "512" renders in ~5 s instead of ~8 s for "1K", and is
    /// sharp enough at phone size for the pictures made most often (dressing, turnaround views).
    private static func image(_ parts: [JSON], size: String = "1K") async throws -> UIImage {
        guard let key = apiKey else { throw Engine.Failure(message: "Pictures need a Gemini key.") }
        let body: JSON = .object([
            "contents": .array([.object(["role": .string("user"), "parts": .array(parts)])]),
            "generationConfig": .object([
                "responseModalities": .array([.string("IMAGE"), .string("TEXT")]),
                "imageConfig": .object(["aspectRatio": .string("3:4"), "imageSize": .string(size)]),
            ]),
        ])
        // Now and then a reply comes back with no picture at all; asking again usually works.
        for _ in 0..<2 {
            // Read the picture straight out of the reply: the ~1.5 MB of base64 doesn't go through the JSON tree.
            let data = try await send(model: imageModel, body: body, key: key)
            let reply = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            let candidates = reply?["candidates"] as? [[String: Any]]
            let parts = (candidates?.first?["content"] as? [String: Any])?["parts"] as? [[String: Any]] ?? []
            for part in parts {
                if let inline = part["inlineData"] as? [String: Any], let b64 = inline["data"] as? String,
                   let bytes = Data(base64Encoded: b64), let image = UIImage(data: bytes) {
                    return image
                }
            }
            print("Gemini image: no picture, finish \(candidates?.first?["finishReason"] ?? "-")")
        }
        throw Engine.Failure(message: "The image model sent back no picture.")
    }

    private static func askJSON(parts: [JSON], system: String, key: String) async throws -> JSON {
        let body: JSON = .object([
            "contents": .array([.object(["role": .string("user"), "parts": .array(parts)])]),
            "systemInstruction": .object(["parts": .array([.object(["text": .string(system)])])]),
            "generationConfig": .object(["responseMimeType": .string("application/json"), "temperature": .number(0.2)]),
        ])
        var text = try await generate(model: model, body: body, key: key).compactMap { $0["text"]?.string }.joined()
        text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.hasPrefix("```") {  // strip a ```json fence
            text = text.split(separator: "\n").dropFirst().dropLast().joined(separator: "\n")
        }
        guard let json = text.data(using: .utf8), let value = try? JSONDecoder().decode(JSON.self, from: json) else {
            throw Engine.Failure(message: "Gemini did not return valid JSON: \(text.prefix(160))")
        }
        return value
    }

    /// POST one generateContent request. Google's side sometimes fails for a moment (500 INTERNAL,
    /// 503, 429, timeouts): those are retried three times, waiting 1, 3 and 6 s (plus a little jitter).
    private static func send(model: String, body: JSON, key: String) async throws -> Data {
        var url = URLComponents(string: "https://generativelanguage.googleapis.com/v1beta/models/\(model):generateContent")!
        url.queryItems = [URLQueryItem(name: "key", value: key)]
        var req = URLRequest(url: url.url!)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 120
        req.httpBody = try JSONEncoder().encode(body)
        var attempt = 0
        while true {
            let status: Int
            let data: Data
            do {
                let (d, response) = try await URLSession.shared.data(for: req)
                data = d
                status = (response as? HTTPURLResponse)?.statusCode ?? 0
            } catch let error as URLError where error.code == .timedOut || error.code == .networkConnectionLost {
                guard attempt < 3 else { throw Engine.Failure(message: "Google didn't answer in time. Please try again.") }
                attempt += 1
                try await Task.sleep(for: .seconds(retryDelay(attempt)))
                continue
            }
            if status == 200 { return data }
            print("Gemini \(model) \(status): \(String(data: data, encoding: .utf8)?.prefix(400) ?? "")")
            if [429, 500, 502, 503, 504].contains(status), attempt < 3 {
                attempt += 1
                try await Task.sleep(for: .seconds(retryDelay(attempt)))
                continue
            }
            throw Engine.Failure(message: status == 429 ? "Google is busy right now. Please try again in a minute."
                : status >= 500 ? "Google's image service hiccuped. Please try again."
                : "Gemini couldn't do that (error \(status)).")
        }
    }

    private static func retryDelay(_ attempt: Int) -> Double { [1.0, 3, 6][attempt - 1] + .random(in: 0...0.5) }

    /// One generateContent call; returns the reply's parts.
    private static func generate(model: String, body: JSON, key: String) async throws -> [JSON] {
        let data = try await send(model: model, body: body, key: key)
        let reply = try JSONDecoder().decode(JSON.self, from: data)
        if case .array(let candidates)? = reply["candidates"],
           case .array(let parts)? = candidates.first?["content"]?["parts"] {
            return parts
        }
        return []
    }
}

struct ViewInput: Codable {
    struct Other: Codable { var angle: Int; var image: String }
    var spec: Spec
    var extras: [String]
    var front: String
    var angle: Int
    var others: [Other]?
    var look: String?
}

struct MannequinInput: Codable {
    var photo: String
    var angle: Int
    var front: String?
    var sex: String?
}

struct DressInput: Codable {
    struct Guides: Codable { var hem: Bool?; var sleeve: Bool? }
    var spec: Spec
    var extras: [String]
    var mannequin: String
    var garment: String
    var garmentView: String?
    var angle: Int
    var guides: Guides?
    var hemAt: String?
    var sleeveAt: String?
    var notes: [String]?
    var look: String?
    var sameFit: String?
}

extension UIImage {
    /// A JPEG data URL, at most `side` px, as the web studio sends images.
    func dataURL(side: CGFloat = 1024, quality: CGFloat = 0.85) -> String? {
        let scale = min(1, side / max(size.width, size.height))
        let target = CGSize(width: size.width * scale, height: size.height * scale)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let small = UIGraphicsImageRenderer(size: target, format: format).image { _ in draw(in: CGRect(origin: .zero, size: target)) }
        return small.jpegData(compressionQuality: quality).map { "data:image/jpeg;base64,\($0.base64EncodedString())" }
    }
}

struct PictureInput: Codable {
    var spec: Spec
    var images: [String]
    var description: String?
    var look: String?
    var extras: [String]
}
