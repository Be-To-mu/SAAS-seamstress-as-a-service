import Foundation
import JavaScriptCore

/// The web pattern studio's engine (web/src/mobile/engine.ts, bundled to
/// Engine/engine.js by `npm run bundle:ios`), run in JavaScriptCore. Values go
/// in and out as JSON, so the Swift side only needs the shapes it shows.
final class Engine {
    static let shared = Engine()

    private let context: JSContext
    private var lastError: String?

    private init() {
        context = JSContext()!
        context.exceptionHandler = { [weak self] _, exception in
            self?.lastError = exception?.toString() ?? "JavaScript error"
        }
        if let url = Bundle.main.url(forResource: "engine", withExtension: "js"),
           let source = try? String(contentsOf: url, encoding: .utf8) {
            context.evaluateScript(source, withSourceURL: url)
        }
        context.evaluateScript("""
            function __call(name, args) {
              return JSON.stringify(SeamstressEngine[name].apply(null, JSON.parse(args)));
            }
            """)
    }

    struct Failure: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    /// Calls `SeamstressEngine.<name>(...args)` and decodes the result.
    func call<T: Decodable>(_ name: String, _ args: [any Encodable], as type: T.Type = T.self) throws -> T {
        let encoded = try args.map { try String(data: JSONEncoder().encode(AnyEncodable($0)), encoding: .utf8)! }
        lastError = nil
        let out = context.objectForKeyedSubscript("__call").call(withArguments: [name, "[\(encoded.joined(separator: ","))]"])
        if let lastError { throw Failure(message: lastError) }
        guard let text = out?.toString(), let data = text.data(using: .utf8) else { throw Failure(message: "No result from \(name)") }
        return try JSONDecoder().decode(T.self, from: data)
    }
}

private struct AnyEncodable: Encodable {
    let value: any Encodable
    init(_ value: any Encodable) { self.value = value }
    func encode(to encoder: Encoder) throws { try value.encode(to: encoder) }
}

/// Any JSON value: specs and feature operations are passed through untouched.
enum JSON: Codable, Hashable {
    case string(String), number(Double), bool(Bool), array([JSON]), object([String: JSON]), null

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSON].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSON].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let s): try c.encode(s)
        case .number(let n): try c.encode(n)
        case .bool(let b): try c.encode(b)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        case .null: try c.encodeNil()
        }
    }

    subscript(key: String) -> JSON? {
        if case .object(let o) = self { return o[key] }
        return nil
    }

    var string: String? { if case .string(let s) = self { s } else { nil } }
    var number: Double? { if case .number(let n) = self { n } else { nil } }
    var bool: Bool? { if case .bool(let b) = self { b } else { nil } }

    /// Plain text for showing a value ("spread", "5", "1.15").
    var display: String {
        switch self {
        case .string(let s): s
        case .number(let n): n.rounded() == n ? String(Int(n)) : String(format: "%.2f", n)
        case .bool(let b): b ? "yes" : "no"
        default: ""
        }
    }
}

// MARK: - Shapes the app shows

typealias Spec = [String: JSON]

struct FieldDef: Codable, Hashable {
    let key: String
    let label: String
    let kind: String  // select | count | number | color
    let options: [String]?
    let min: Double?
    let max: Double?
    let step: Double?
    let hint: String?
}

struct Family: Codable, Hashable, Identifiable {
    let id: String
    let label: String
    let blurb: String
    let fields: [FieldDef]
}

struct Pt: Codable, Hashable { let x: Double; let y: Double }

struct Edge: Codable, Hashable {
    let id: String
    let pts: [Pt]
    let allowance: Double
    let kind: String?
}

struct Mark: Codable, Hashable {
    let id: String
    let kind: String
    let pts: [Pt]
    let label: String?
}

struct Panel: Codable, Hashable, Identifiable {
    struct Cut: Codable, Hashable { let count: Int; let mirror: Bool; let onFold: Bool }
    let id: String
    let name: String
    let edges: [Edge]
    let marks: [Mark]
    let cut: Cut
    let fabric: String
    let grain: [Pt]
}

struct Garment: Codable, Hashable { let panels: [Panel] }

struct Stat: Codable, Hashable { let label: String; let value: String }

struct Issue: Codable, Hashable {
    let severity: String
    let code: String
    let message: String
}

struct CheckResult: Codable, Hashable { let ok: Bool; let issues: [Issue] }

struct Composed: Codable {
    let garment: Garment
    let stats: [Stat]
    let check: CheckResult
    let featureError: String?
    let description: String
}

struct Feature: Codable, Hashable, Identifiable {
    let id: String
    let request: String
    let ops: [JSON]
    let source: String
}

struct Recipe: Codable, Hashable, Identifiable {
    let id: String
    let title: String
    let explanation: String
    let ops: [JSON]
}

struct DesignMode: Codable, Hashable, Identifiable {
    let id: String
    let label: String
    let hint: String
}

struct DesignResult: Codable {
    let mode: String
    let garment: String
    let family: String
    let fitsFamily: Bool
    let reason: String
    let spec: Spec
    let unsupported: [String]
    let notes: String
}

struct DesignInput: Codable {
    var images: [String]
    var description: String?
    var mode: String?
    var current: Spec?
}

struct DesignRequest: Codable {
    let parts: [JSON]
    let system: String
}
