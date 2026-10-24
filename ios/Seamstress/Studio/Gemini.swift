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
        guard let key = apiKey else { throw Engine.Failure(message: "Pictures need a Gemini key.") }
        let parts: [JSON] = try Engine.shared.call("pictureRequest", [input])
        let body: JSON = .object([
            "contents": .array([.object(["role": .string("user"), "parts": .array(parts)])]),
            "generationConfig": .object([
                "responseModalities": .array([.string("IMAGE"), .string("TEXT")]),
                "imageConfig": .object(["aspectRatio": .string("3:4")]),
            ]),
        ])
        for part in try await generate(model: imageModel, body: body, key: key) {
            if let data = part["inlineData"]?["data"]?.string, let bytes = Data(base64Encoded: data),
               let image = UIImage(data: bytes) {
                return image
            }
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

    /// One generateContent call; returns the reply's parts.
    private static func generate(model: String, body: JSON, key: String) async throws -> [JSON] {
        var url = URLComponents(string: "https://generativelanguage.googleapis.com/v1beta/models/\(model):generateContent")!
        url.queryItems = [URLQueryItem(name: "key", value: key)]
        var req = URLRequest(url: url.url!)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 120
        req.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await URLSession.shared.data(for: req)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw Engine.Failure(message: "Gemini: \(String(data: data, encoding: .utf8)?.prefix(200) ?? "error")")
        }
        let reply = try JSONDecoder().decode(JSON.self, from: data)
        if case .array(let candidates)? = reply["candidates"],
           case .array(let parts)? = candidates.first?["content"]?["parts"] {
            return parts
        }
        return []
    }
}

struct PictureInput: Codable {
    var spec: Spec
    var images: [String]
    var description: String?
    var extras: [String]
}
