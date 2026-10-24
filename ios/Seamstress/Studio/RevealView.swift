import SwiftUI

/// The garment Gemini just designed: its picture, name and what it is, before styling.
struct RevealView: View {
    @EnvironmentObject private var draft: DesignDraft
    let onStyle: () -> Void

    @State private var drawing = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                ZStack {
                    Rectangle().fill(Theme.linen.opacity(0.45))
                    if let picture = draft.picture {
                        Image(uiImage: picture).resizable().scaledToFit()
                            .clipShape(Rectangle())
                    } else if drawing {
                        VStack(spacing: 14) {
                            Monogram(size: 56, color: Theme.brown)
                            ProgressView().tint(Theme.brown)
                            Text("Drawing your garment…").font(Theme.body(15))
                        }
                    } else {
                        VStack(spacing: 10) {
                            Circle().fill(draft.color).frame(width: 90, height: 90)
                            Text(error ?? "No picture").font(.caption).multilineTextAlignment(.center).padding(.horizontal)
                        }
                    }
                }
                .aspectRatio(0.75, contentMode: .fit)

                VStack(spacing: 6) {
                    Text(draft.name).titleStyle(22).multilineTextAlignment(.center)
                    Text(Engine.familyLabel(draft.family)).subtitleStyle()
                }
                if let description = (try? Engine.shared.call("compose", [draft.spec, BodyProfile.sampleBody, draft.features],
                                                               as: Composed.self))?.description {
                    Text(description).font(Theme.body(15)).multilineTextAlignment(.center)
                }
                if !draft.notes.isEmpty {
                    Text(draft.notes).font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
            }
            .foregroundStyle(Theme.brown)
            .padding(20)
        }
        .background(Theme.cream.ignoresSafeArea())
        .navigationTitle("Your design")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            HStack(spacing: 12) {
                Button { Task { await draw() } } label: { Label("New picture", systemImage: "arrow.clockwise") }
                    .buttonStyle(TailoredButtonStyle(filled: false))
                    .disabled(drawing || Gemini.apiKey == nil)
                Button("Style it", action: onStyle).buttonStyle(TailoredButtonStyle())
            }
            .padding()
            .background(Theme.cream.opacity(0.95))
        }
        .task { if draft.picture == nil { await draw() } }
    }

    private func draw() async {
        guard Gemini.apiKey != nil else {
            error = "Demo mode: add a Gemini key to see a picture."
            return
        }
        drawing = true
        error = nil
        defer { drawing = false }
        let words = draft.words.trimmingCharacters(in: .whitespacesAndNewlines)
        let input = PictureInput(spec: draft.spec, images: draft.references,
                                 description: words.isEmpty ? nil : words, extras: draft.features.map(\.request))
        do {
            draft.picture = try await Gemini.picture(input)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

extension BodyProfile {
    /// For describing a design before any body is involved (the sentence doesn't depend on it).
    static let sampleBody: [String: Double] = (try? Engine.shared.call("sampleBody", [], as: [String: Double].self)) ?? [:]
}
