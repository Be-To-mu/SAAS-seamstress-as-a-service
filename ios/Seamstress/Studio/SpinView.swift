import SwiftUI

/// The design. Two tabs at the top: On me (your mannequin wearing it, from any of eight
/// angles, pull the lines to adjust; shown first) and Images (the drawn views, drag to turn).
/// Advanced settings opens a sheet over the lower half, with the fit and the style form,
/// so the garment stays in view while you change it. At the bottom: Save it (to the
/// wardrobe) or Craft it (to a seamstress, with the pattern cut to you).
struct SpinView: View {
    enum Tab: String, CaseIterable { case onMe = "On me", images = "Images" }

    @EnvironmentObject private var draft: DesignDraft
    @EnvironmentObject private var profile: BodyProfile
    let save: () -> Void
    let onPattern: () -> Void
    let onSave: () -> Void
    let onCraft: () -> Void
    let onRedraw: () -> Void

    /// On me first, when there's a mannequin to dress.
    @State private var tab: Tab = ScanStore.current.map { MannequinStore.angles($0).isEmpty } ?? true ? .images : .onMe
    @State private var advanced = false
    @State private var detent = PresentationDetent.fraction(0.45)

    var body: some View {
        GeometryReader { geo in
            VStack(spacing: 0) {
                tabs
                if draft.viewsStale {
                    HStack {
                        Text("Your design changed.").font(Theme.body(14))
                        Spacer()
                        Button("Redraw") { advanced = false; onRedraw() }.font(.system(size: 14, weight: .semibold)).underline()
                    }
                    .padding(.horizontal, 20).padding(.vertical, 10)
                    .background(Theme.linen.opacity(0.6))
                }
                Group {
                    switch tab {
                    case .images:
                        Turntable(views: draft.views)
                    case .onMe:
                        FitStage(save: save)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .transition(.opacity)
                // With the sheet half up, the garment sits in the half above it.
                .padding(.bottom, advanced && detent != .large ? max(0, geo.size.height * 0.45 - 70) : 0)
                .animation(.easeInOut(duration: 0.3), value: advanced)
            }
        }
        .foregroundStyle(Theme.brown)
        .background(Theme.cream.ignoresSafeArea())
        .navigationTitle(draft.name)
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 10) {
                Button { advanced = true } label: {
                    HStack {
                        Image(systemName: "slider.horizontal.3").font(.system(size: 14, weight: .light))
                        Text("Advanced settings")
                        Spacer()
                        Image(systemName: "chevron.up").font(.system(size: 12, weight: .light))
                    }
                    .font(.system(size: 14, weight: .medium))
                    .padding(.vertical, 6)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                HStack(spacing: 12) {
                    Button("Save it") { save(); onSave() }
                        .buttonStyle(TailoredButtonStyle(filled: false))
                        .frame(width: 130)
                    Button(action: onCraft) {
                        HStack {
                            Text("Craft it")
                            Spacer()
                            Image(systemName: "arrow.right").font(.system(size: 14, weight: .light))
                        }
                    }
                    .buttonStyle(TailoredButtonStyle())
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            .background(Theme.cream)
            .hairline(.top)
        }
        .sheet(isPresented: $advanced) {
            AdvancedSettings(save: save) {
                advanced = false
                onPattern()
            }
            .presentationDetents([.fraction(0.45), .large], selection: $detent)
            .presentationBackgroundInteraction(.enabled(upThrough: .fraction(0.45)))
            .presentationBackground(Theme.cream)
            .presentationDragIndicator(.visible)
        }
        .onAppear {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-onme") { tab = .onMe }
            if ProcessInfo.processInfo.arguments.contains("-advanced") { advanced = true }
            #endif
        }
        .task {
            // Opened from the wardrobe with only some views: draw the rest in the background.
            guard draft.front != nil, draft.views.count < DesignDraft.angles.count, !draft.viewsStale else { return }
            try? await draft.drawViews(keepExisting: true) { _ in }
            save()
        }
        .task(id: draft.savedID) { await preloadOnMe() }
    }

    /// Dress the mannequin from every angle while the design is being looked at.
    private func preloadOnMe() async {
        guard draft.savedID != nil else { return }
        await Dresser.shared.prepare(draft, profile, angles: DesignDraft.angles)
    }

    private var tabs: some View {
        HStack(spacing: 0) {
            ForEach(Tab.allCases, id: \.self) { t in
                Button {
                    withAnimation(.easeInOut(duration: 0.25)) { tab = t }
                } label: {
                    VStack(spacing: 10) {
                        Text(t.rawValue).font(.system(size: 15, weight: tab == t ? .semibold : .regular))
                            .foregroundStyle(tab == t ? Theme.brown : Theme.sand)
                        Rectangle().fill(tab == t ? Theme.brown : .clear).frame(height: 1.5)
                    }
                    .frame(maxWidth: .infinity)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.top, 6)
        .hairline(.bottom)
    }
}

/// The sheet behind Advanced settings: the fit, then the style form, then the pattern.
private struct AdvancedSettings: View {
    let save: () -> Void
    let onPattern: () -> Void

    var body: some View {
        List {
            Section {
                Text("Advanced settings").titleStyle(22).listRowBackground(Color.clear)
            }
            FitControls(save: save)
            MarketSection(save: save)
            StyleForm()
            Section {
                Button(action: onPattern) {
                    HStack {
                        Text("See the pattern")
                        Spacer()
                        Image(systemName: "arrow.right").font(.system(size: 13, weight: .light))
                    }
                }
                .foregroundStyle(Theme.brown)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .listRowBackgroundCream()
        .foregroundStyle(Theme.brown)
        .padding(.top, 12)
    }
}

/// Offer the design in the marketplace, for others to have it made to their measurements.
private struct MarketSection: View {
    @EnvironmentObject private var draft: DesignDraft
    let save: () -> Void

    var body: some View {
        Section {
            Toggle(isOn: Binding { draft.forSale } set: { draft.forSale = $0; save() }) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Offer in the marketplace").font(Theme.body(15))
                    Text("Others can have it made to their measurements.").font(.caption).foregroundStyle(Theme.sand)
                }
            }
            .tint(Theme.brown)
        } header: {
            Text("Marketplace")
        }
    }
}

extension BodyProfile {
    /// For describing a design before any body is involved.
    static let sampleBody: [String: Double] = (try? Engine.shared.call("sampleBody", [], as: [String: Double].self)) ?? [:]
}
