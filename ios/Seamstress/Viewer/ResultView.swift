import SceneKit
import SwiftUI

/// Shows the body in the standard A-pose, full screen in 3D, with a tape line
/// for every measurement, once the Mac (`bodyfit usb`) has fitted the scan and
/// copied the result back over the cable. Tap a measurement to highlight it.
struct ResultView: View {
    let scan: URL
    var onNext: (() -> Void)? = nil
    @EnvironmentObject private var profile: BodyProfile
    @State private var measurements: ScanStore.Measurements?
    @State private var meshURL: URL?
    @State private var status: ScanStore.Status?
    @State private var message = ""
    @State private var showMeasurements = false
    @State private var selected: String?

    var body: some View {
        ZStack {
            Theme.cream.ignoresSafeArea()
            if let meshURL, let measurements {
                BodyMeshView(url: meshURL, measurements: measurements, selected: selected)
                    .ignoresSafeArea(edges: .bottom)
            } else {
                waiting
            }
        }
        .safeAreaInset(edge: .bottom) {
            if measurements != nil {
                HStack(spacing: 12) {
                    Button { showMeasurements = true } label: {
                        Label(selectedLabel ?? "Tapes", systemImage: "ruler").lineLimit(1)
                    }
                    .buttonStyle(TailoredButtonStyle(filled: false))
                    if let onNext {
                        Button("Next: measurements", action: onNext).buttonStyle(TailoredButtonStyle())
                    }
                }
                .padding()
            }
        }
        .navigationTitle("Your body")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showMeasurements) {
            MeasurementsSheet(measurements: measurements, selected: $selected)
        }
        .task { await waitForResult() }
    }

    private var selectedLabel: String? {
        guard let key = selected, let value = measurements?.measurementsCm[key] ?? nil else { return nil }
        return "\(key.replacingOccurrences(of: "_", with: " ")) · \(String(format: "%.1f cm", value))"
    }

    private var waiting: some View {
        VStack(spacing: 18) {
            if status?.state != "failed" {
                AtelierProgress()
                if let progress = status?.progress {
                    ProgressView(value: progress).tint(Theme.brown).frame(maxWidth: 220)
                }
            } else {
                Monogram(size: 56, color: Theme.brown)
            }
            Text(message).font(Theme.body(16)).multilineTextAlignment(.center)
        }
        .foregroundStyle(Theme.brown)
        .padding(32)
    }

    /// Polls the scan folder; the Mac writes status.json as it goes, then the results.
    private func waitForResult() async {
        let start = Date()
        while !Task.isCancelled {
            if let mesh = ScanStore.mesh(of: scan), let m = ScanStore.measurements(of: scan) {
                measurements = m
                meshURL = mesh
                profile.adopt(scan: scan, measurements: m)
                return
            }
            status = ScanStore.status(of: scan)
            switch status?.state {
            case "failed":
                message = "Making your body model failed:\n\(status?.error ?? "unknown error")"
            case "fitting", "done":
                message = (status?.step ?? "Building your 3D body") + "…"
            default:
                message = Date().timeIntervalSince(start) < 5 ? "Looking for your Mac…"
                    : "Waiting for your Mac.\nKeep the phone plugged in and run `bodyfit usb` on the Mac."
            }
            try? await Task.sleep(for: .seconds(1))
        }
    }
}

private struct MeasurementsSheet: View {
    let measurements: ScanStore.Measurements?
    @Binding var selected: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if let m = measurements {
                    ForEach(m.order, id: \.self) { key in
                        Button {
                            selected = selected == key ? nil : key
                        } label: {
                            LabeledContent {
                                Text(m.measurementsCm[key].flatMap { $0 }.map { String(format: "%.1f cm", $0) } ?? "–")
                                    .monospacedDigit()
                            } label: {
                                Text(m.definitions[key] ?? key)
                            }
                        }
                        .foregroundStyle(Theme.ink)
                        .listRowBackground(selected == key ? Theme.linen : Color.clear)
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .listRowBackgroundCream()
            .background(Theme.cream)
            .navigationTitle("Measurements")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Done") { dismiss() } }
        }
        .presentationDetents([.fraction(0.4), .large])
        .presentationBackgroundInteraction(.enabled(upThrough: .fraction(0.4)))
    }
}

/// The fitted body in the standard pose, lit and framed, turning slowly until
/// touched, with the measurement tape lines drawn on it.
struct BodyMeshView: UIViewRepresentable {
    let url: URL
    let measurements: ScanStore.Measurements
    let selected: String?

    func makeUIView(context: Context) -> SCNView {
        let view = SCNView()
        view.allowsCameraControl = true
        view.backgroundColor = .clear
        view.antialiasingMode = .multisampling4X
        guard let loaded = try? SCNScene(url: url) else { return view }

        let scene = SCNScene()
        let body = SCNNode()
        for child in loaded.rootNode.childNodes { body.addChildNode(child) }
        body.enumerateHierarchy { node, _ in
            guard node.geometry != nil else { return }
            let material = SCNMaterial()
            material.lightingModel = .physicallyBased
            material.diffuse.contents = UIColor(Theme.linen)
            material.roughness.contents = 0.75
            node.geometry?.materials = [material]
        }
        // Stand the body on the origin, centred (measured before the tapes are added).
        let (lo, hi) = body.boundingBox
        // Tape lines live in the same coordinates as the mesh.
        for (name, loops) in measurements.tapes ?? [:] {
            let node = SCNNode()
            for loop in loops { node.addChildNode(Tape.tube(loop, radius: 0.004)) }
            context.coordinator.add(name, node, to: body)
        }
        for (name, line) in measurements.lines ?? [:] {
            context.coordinator.add(name, Tape.tube(line, radius: 0.003, dashed: true), to: body)
        }
        body.position = SCNVector3(-(lo.x + hi.x) / 2, -lo.y, -(lo.z + hi.z) / 2)
        let turntable = SCNNode()
        turntable.addChildNode(body)
        turntable.runAction(.repeatForever(.rotateBy(x: 0, y: .pi * 2, z: 0, duration: 24)))
        scene.rootNode.addChildNode(turntable)

        let height = hi.y - lo.y
        let camera = SCNNode()
        camera.camera = SCNCamera()
        camera.camera?.fieldOfView = 35
        camera.position = SCNVector3(0, height * 0.55, height * 1.9)
        camera.look(at: SCNVector3(0, height * 0.5, 0))
        scene.rootNode.addChildNode(camera)
        view.pointOfView = camera

        let key = SCNNode()
        key.light = SCNLight()
        key.light?.type = .directional
        key.light?.intensity = 900
        key.eulerAngles = SCNVector3(-0.6, 0.5, 0)
        scene.rootNode.addChildNode(key)
        let fill = SCNNode()
        fill.light = SCNLight()
        fill.light?.type = .ambient
        fill.light?.intensity = 380
        scene.rootNode.addChildNode(fill)

        view.scene = scene
        context.coordinator.turntable = turntable
        view.addGestureRecognizer(UITapGestureRecognizer(target: context.coordinator,
                                                         action: #selector(Coordinator.stopTurning)))
        view.gestureRecognizers?.forEach { $0.addTarget(context.coordinator, action: #selector(Coordinator.stopTurning)) }
        context.coordinator.highlight(selected)
        return view
    }

    func updateUIView(_ view: SCNView, context: Context) {
        context.coordinator.highlight(selected)
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject {
        var turntable: SCNNode?
        private var tapes: [String: SCNNode] = [:]
        private var current: String?? = .none

        func add(_ name: String, _ node: SCNNode, to body: SCNNode) {
            tapes[name] = node
            body.addChildNode(node)
        }

        @objc func stopTurning() { turntable?.removeAllActions() }

        /// The selected tape in cream, the others faint; with nothing selected, all brown.
        func highlight(_ name: String?) {
            if case .some(let shown) = current, shown == name { return }
            current = .some(name)
            if name != nil { stopTurning() }
            for (key, node) in tapes {
                let isSelected = key == name
                let color = isSelected ? UIColor(Theme.cream) : UIColor(Theme.brown)
                node.enumerateHierarchy { child, _ in
                    child.geometry?.firstMaterial?.diffuse.contents = color
                }
                node.opacity = name == nil || isSelected ? 1 : 0.2
            }
        }
    }
}

/// Thin tubes along a polyline, merged into one node.
enum Tape {
    static func tube(_ points: [[Double]], radius: CGFloat, dashed: Bool = false) -> SCNNode {
        let pts = points.map { SIMD3<Float>(Float($0[0]), Float($0[1]), Float($0[2])) }
        let holder = SCNNode()
        let material = SCNMaterial()
        material.lightingModel = .constant
        material.diffuse.contents = UIColor(Theme.brown)
        for (a, b) in zip(pts, pts.dropFirst()) {
            var pieces = [(a, b)]
            if dashed {
                let n = max(1, Int(simd_length(b - a) / 0.015))
                pieces = (0..<n).filter { $0.isMultiple(of: 2) }.map { i in
                    (a + (b - a) * Float(i) / Float(n), a + (b - a) * Float(i + 1) / Float(n))
                }
            }
            for (p, q) in pieces {
                let d = q - p
                let length = simd_length(d)
                guard length > 1e-5 else { continue }
                let cylinder = SCNCylinder(radius: radius, height: CGFloat(length))
                cylinder.radialSegmentCount = 6
                cylinder.materials = [material]
                let node = SCNNode(geometry: cylinder)
                node.simdPosition = (p + q) / 2
                node.simdOrientation = simd_quatf(from: [0, 1, 0], to: d / length)
                holder.addChildNode(node)
            }
        }
        let merged = holder.flattenedClone()
        merged.geometry?.materials = [material]
        return merged
    }
}
