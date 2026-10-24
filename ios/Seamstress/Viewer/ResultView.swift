import SceneKit
import SwiftUI

/// Sends a scan to bodyfit, waits for the fit, then shows the body and its measurements.
struct ResultView: View {
    let scan: URL
    @State private var status: BodyfitClient.Status?
    @State private var message = ""
    @State private var meshURL: URL?

    var body: some View {
        List {
            if let meshURL {
                Section { BodyMeshView(url: meshURL).frame(height: 420) }
            }
            if let m = status?.measurementsCm {
                Section("Measurements") {
                    ForEach(status?.order ?? m.keys.sorted(), id: \.self) { key in
                        LabeledContent(status?.definitions?[key] ?? key) {
                            Text(m[key].flatMap { $0 }.map { String(format: "%.1f cm", $0) } ?? "–")
                                .monospacedDigit()
                        }
                    }
                }
            }
            if !message.isEmpty {
                Section { Text(message).foregroundStyle(.secondary) }
            }
        }
        .navigationTitle(scan.lastPathComponent)
        .navigationBarTitleDisplayMode(.inline)
        .task { await run() }
    }

    private func run() async {
        guard let client = BodyfitClient.configured else {
            message = "No fitting service configured (BODYFIT_SERVICE_URL in ios/Local.xcconfig)."
            return
        }
        do {
            var id = ScanStore.remoteID(of: scan)
            if id == nil {
                message = "Sending scan to \(client.base.host() ?? "service")…"
                id = try await client.upload(scan: scan)
                try ScanStore.setRemoteID(id!, of: scan)
            }
            while true {
                let s = try await client.status(id: id!)
                status = s
                switch s.state {
                case "done":
                    let url = scan.appending(path: "body.obj")
                    try await client.downloadMesh(id: id!, to: url)
                    meshURL = url
                    message = ""
                    return
                case "failed":
                    message = "Fitting failed: \(s.error ?? "unknown error")"
                    return
                default:
                    message = s.state == "queued" ? "Waiting for the fitting service…" : "Fitting your body model (about 2 minutes)…"
                    try await Task.sleep(for: .seconds(3))
                }
            }
        } catch {
            message = "\(error.localizedDescription)\nThe scan is saved on the phone; open it again to retry."
        }
    }
}

struct BodyMeshView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> SCNView {
        let view = SCNView()
        view.allowsCameraControl = true
        view.autoenablesDefaultLighting = true
        view.backgroundColor = .secondarySystemBackground
        if let scene = try? SCNScene(url: url) {
            scene.rootNode.enumerateChildNodes { node, _ in
                node.geometry?.firstMaterial?.diffuse.contents = UIColor(white: 0.85, alpha: 1)
            }
            view.scene = scene
        }
        return view
    }

    func updateUIView(_ view: SCNView, context: Context) {}
}
