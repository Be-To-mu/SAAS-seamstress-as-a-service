import SwiftUI

/// The design, full screen, to turn around. Edit (top right) opens the styling
/// form; "See it on me" opens the fitting room.
struct SpinView: View {
    @EnvironmentObject private var draft: DesignDraft
    @EnvironmentObject private var profile: BodyProfile
    let save: () -> Void
    let onEdit: () -> Void
    let onTryOn: () -> Void
    let onRedraw: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if draft.viewsStale {
                    HStack {
                        Text("Your design changed.").font(Theme.body(14))
                        Spacer()
                        Button("Redraw", action: onRedraw).font(.system(size: 14, weight: .semibold)).underline()
                    }
                    .padding(.horizontal, 20).padding(.vertical, 12)
                    .background(Theme.linen.opacity(0.6))
                }
                Turntable(views: draft.views)
                    .aspectRatio(0.8, contentMode: .fit)
                VStack(alignment: .leading, spacing: 10) {
                    Text("\(Engine.familyLabel(draft.family)) · made to measure").eyebrowStyle()
                    Text(draft.name).titleStyle(30)
                    if let c = composed {
                        Text(c.description.withoutColourCodes.capitalizedFirst).font(Theme.body(15)).lineSpacing(3)
                        ForEach(c.stats.prefix(3), id: \.self) { s in
                            LabeledContent(s.label, value: s.value).font(Theme.body(14)).hairline(.bottom).padding(.bottom, 6)
                        }
                    }
                    Text("Drag the garment to turn it around.").font(.caption).foregroundStyle(Theme.sand).padding(.top, 4)
                }
                .padding(20)
            }
            .foregroundStyle(Theme.brown)
        }
        .background(Theme.cream.ignoresSafeArea())
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { Button("Edit", action: onEdit) }
        }
        .task {
            // Opened from the wardrobe with only some views: draw the rest in the background.
            guard draft.front != nil, draft.views.count < DesignDraft.angles.count, !draft.viewsStale else { return }
            try? await draft.drawViews(keepExisting: true) { _ in }
            save()
        }
        .safeAreaInset(edge: .bottom) {
            Button("See it on me", action: onTryOn)
                .buttonStyle(TailoredButtonStyle())
                .padding()
                .background(Theme.cream.opacity(0.95))
                .disabled(draft.front == nil)
        }
    }

    private var composed: Composed? {
        try? Engine.shared.call("compose", [draft.spec, profile.webMeasurements.isEmpty ? BodyProfile.sampleBody : profile.webMeasurements,
                                            draft.features])
    }
}

extension BodyProfile {
    /// For describing a design before any body is involved.
    static let sampleBody: [String: Double] = (try? Engine.shared.call("sampleBody", [], as: [String: Double].self)) ?? [:]
}
