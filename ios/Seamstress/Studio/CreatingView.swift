import SwiftUI

/// "Creating your design": Gemini reads the references and words, then draws the
/// garment from the front and from every side. The front shows as soon as it's ready.
struct CreatingView: View {
    @EnvironmentObject private var draft: DesignDraft
    @EnvironmentObject private var profile: BodyProfile
    /// The design request from the Design page; nil when redrawing an existing design.
    let input: DesignInput?
    /// Keeps the design in the wardrobe as its pictures arrive.
    let save: () -> Void
    let onDone: () -> Void

    enum Step: Int { case reading, front, sides, done }
    @State private var step = Step.reading
    @State private var drawn = 0
    @State private var error: String?
    @State private var running = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                Text("In the atelier").eyebrowStyle()
                Text("Creating your design").titleStyle(30)
                Text(draft.name == "Garment" ? "This takes about half a minute." : draft.name).subtitleStyle(14)
            }
            .padding(20)

            // The picture, with the steps on it.
            Color.clear
                .aspectRatio(0.8, contentMode: .fit)
                .frame(maxWidth: .infinity)
                .overlay {
                    if draft.front != nil {
                        Turntable(views: draft.views, autoTurn: false)
                    } else {
                        Theme.linen.overlay(AtelierProgress().offset(y: -50))
                    }
                }
                .overlay(alignment: .bottomLeading) { steps }
                .clipped()

            if let error {
                VStack(alignment: .leading, spacing: 10) {
                    Text(error).font(.callout).foregroundStyle(.red)
                    Button("Try again") { Task { await run() } }.buttonStyle(TailoredButtonStyle(filled: false))
                }
                .padding(20)
            }
            Spacer(minLength: 0)
        }
        .foregroundStyle(Theme.brown)
        .background(Theme.cream.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(running)
        .safeAreaInset(edge: .bottom) {
            if draft.front != nil && step != .done {
                Button("Continue while it draws", action: onDone).buttonStyle(TailoredButtonStyle(filled: false)).padding()
            }
        }
        .task { if !running && step != .done { await run() } }
    }

    private var steps: some View {
        VStack(alignment: .leading, spacing: 10) {
            stepRow("Reading your references", .reading)
            stepRow("Drawing the front", .front)
            stepRow("Drawing it from every side · \(min(drawn, 8)) of 8", .sides)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.cream.opacity(0.88))
    }

    private func stepRow(_ title: String, _ s: Step) -> some View {
        HStack(spacing: 12) {
            Group {
                if step.rawValue > s.rawValue { Image(systemName: "checkmark") }
                else if step == s && error == nil { ProgressView().controlSize(.small) }
                else { Image(systemName: "circle").foregroundStyle(Theme.hairline) }
            }
            .frame(width: 18)
            Text(title).font(Theme.body(15)).foregroundStyle(step.rawValue >= s.rawValue ? Theme.brown : Theme.sand)
        }
    }

    private func run() async {
        running = true
        error = nil
        defer { running = false }
        do {
            if input == nil, draft.viewsStale { draft.views = [:] }  // redraw after an edit
            if let input, step == .reading {
                draft.adopt(try await Gemini.design(input))
                draft.features = []
                draft.references = input.images
            }
            step = .front
            try await draft.drawViews(keepExisting: input == nil && !draft.viewsStale, onFront: {
                save()
                // Dress the mannequin in it straight away, while the other sides are drawn.
                Task { await Dresser.shared.prepare(draft, profile, angles: [0]) }
            }) { n in
                drawn = n
                if n >= 1 { step = .sides }
            }
            step = .done
            save()
            onDone()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
