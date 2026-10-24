import SwiftUI

/// Step 3: the sewing pattern for your body: every piece drawn to scale, the
/// finished sizes, the seam check, a 1:1 PDF to print, and Save.
struct PatternView: View {
    @EnvironmentObject private var draft: DesignDraft
    @EnvironmentObject private var profile: BodyProfile
    @EnvironmentObject private var wardrobe: WardrobeStore
    let onSaved: () -> Void

    @State private var pdfURL: URL?
    @State private var error: String?

    var body: some View {
        let composed: Composed? = try? Engine.shared.call("compose", [draft.spec, profile.webMeasurements, draft.features])
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(draft.name).titleStyle(22)
                    Text("cut to your measurements").subtitleStyle()
                }
                if let c = composed {
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 14) {
                        ForEach(c.garment.panels) { panel in PanelCard(panel: panel, color: draft.color) }
                    }
                    stats(c)
                    check(c)
                } else {
                    Text("This design can't be made for these measurements. Check your measurements.")
                }
                if let error { Text(error).font(.caption).foregroundStyle(.red) }
            }
            .foregroundStyle(Theme.brown)
            .padding(20)
        }
        .background(Theme.cream.ignoresSafeArea())
        .navigationTitle("Pattern")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            HStack(spacing: 12) {
                if let pdfURL {
                    ShareLink(item: pdfURL) { Label("PDF", systemImage: "square.and.arrow.up") }
                        .buttonStyle(TailoredButtonStyle(filled: false))
                } else {
                    Button { makePDF() } label: { Label("PDF", systemImage: "doc") }
                        .buttonStyle(TailoredButtonStyle(filled: false))
                }
                Button("Save") { save() }.buttonStyle(TailoredButtonStyle())
            }
            .padding()
            .background(Theme.cream.opacity(0.95))
        }
        .onChange(of: draft.spec) { pdfURL = nil }
        .onChange(of: draft.features) { pdfURL = nil }
    }

    private func stats(_ c: Composed) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Finished garment").titleStyle(13)
            ForEach(c.stats, id: \.self) { s in
                LabeledContent(s.label, value: s.value).font(Theme.body(15))
            }
        }
    }

    @ViewBuilder private func check(_ c: Composed) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Seam check").titleStyle(13)
            if c.check.issues.isEmpty {
                Label("All seams match", systemImage: "checkmark.seal").foregroundStyle(.green)
            }
            ForEach(c.check.issues, id: \.self) { issue in
                Label(issue.message, systemImage: issue.severity == "error" ? "xmark.octagon" : "exclamationmark.triangle")
                    .foregroundStyle(issue.severity == "error" ? .red : .orange)
                    .font(.callout)
            }
            if let e = c.featureError { Text(e).font(.callout).foregroundStyle(.orange) }
        }
    }

    private func makePDF() {
        do {
            let b64: String = try Engine.shared.call("patternPdf", [draft.spec, profile.webMeasurements, draft.features, draft.name])
            guard let data = Data(base64Encoded: b64) else { throw Engine.Failure(message: "PDF failed") }
            let url = FileManager.default.temporaryDirectory.appending(path: "\(draft.name) pattern.pdf")
            try data.write(to: url)
            pdfURL = url
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func save() {
        do {
            guard wardrobe.save(draft, measurements: profile.webMeasurements) != nil else {
                throw Engine.Failure(message: "Could not save the garment.")
            }
            onSaved()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// One pattern piece, drawn to scale inside its card, with grain line and marks.
private struct PanelCard: View {
    let panel: Panel
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Canvas { ctx, size in
                let pts = panel.edges.flatMap(\.pts)
                guard let minX = pts.map(\.x).min(), let maxX = pts.map(\.x).max(),
                      let minY = pts.map(\.y).min(), let maxY = pts.map(\.y).max() else { return }
                let scale = min((size.width - 12) / max(maxX - minX, 1), (size.height - 12) / max(maxY - minY, 1))
                let ox = (size.width - (maxX - minX) * scale) / 2, oy = (size.height - (maxY - minY) * scale) / 2
                func p(_ q: Pt) -> CGPoint { CGPoint(x: ox + (q.x - minX) * scale, y: oy + (q.y - minY) * scale) }

                var outline = Path()
                for (i, edge) in panel.edges.enumerated() {
                    for (j, q) in edge.pts.enumerated() {
                        if i == 0 && j == 0 { outline.move(to: p(q)) } else { outline.addLine(to: p(q)) }
                    }
                }
                outline.closeSubpath()
                ctx.fill(outline, with: .color(color.opacity(0.25)))
                ctx.stroke(outline, with: .color(Theme.brown), lineWidth: 1.2)
                for edge in panel.edges where edge.kind == "fold" {
                    var fold = Path()
                    fold.addLines(edge.pts.map(p))
                    ctx.stroke(fold, with: .color(Theme.brown), style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                }
                if panel.grain.count == 2 {
                    var grain = Path()
                    grain.addLines(panel.grain.map(p))
                    ctx.stroke(grain, with: .color(Theme.brown.opacity(0.7)), style: StrokeStyle(lineWidth: 0.8, dash: [2, 2]))
                }
                for mark in panel.marks where mark.kind != "label" {
                    var m = Path()
                    if mark.pts.count == 1 {
                        m.addEllipse(in: CGRect(origin: p(mark.pts[0]), size: .zero).insetBy(dx: -2, dy: -2))
                    } else {
                        m.addLines(mark.pts.map(p))
                    }
                    ctx.stroke(m, with: .color(Theme.brown), lineWidth: 0.8)
                }
            }
            .frame(height: 150)
            Text(panel.name).font(Theme.body(13).weight(.semibold))
            Text("Cut \(panel.cut.count)\(panel.cut.onFold ? " on fold" : "")\(panel.fabric == "shell" ? "" : " · \(panel.fabric)")")
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding(10)
        .background(Theme.linen.opacity(0.3), in: Rectangle())
    }
}
