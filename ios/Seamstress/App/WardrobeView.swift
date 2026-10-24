import SwiftUI

/// Home: the wardrobe stored in MongoDB (synced to the phone by the Mac).
/// One garment per screen: swipe up or down to flip through them, drag sideways
/// to turn the garment around.
struct WardrobeView: View {
    let onOpen: (SavedGarment) -> Void
    let onTryOn: (SavedGarment) -> Void
    let onNew: () -> Void

    @State private var garments: [SavedGarment] = []
    @State private var current: String?
    @State private var cache: [String: [Int: UIImage]] = [:]

    var body: some View {
        Group {
            if garments.isEmpty {
                empty
            } else {
                GeometryReader { geo in
                    ScrollView(.vertical) {
                        LazyVStack(spacing: 0) {
                            ForEach(garments) { g in
                                page(g).frame(width: geo.size.width, height: geo.size.height).id(g.id)
                            }
                        }
                        .scrollTargetLayout()
                    }
                    .scrollTargetBehavior(.paging)
                    .scrollPosition(id: $current)
                    .scrollIndicators(.hidden)
                }
            }
        }
        .background(Theme.cream.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button(action: onNew) { Image(systemName: "plus").font(.system(size: 17, weight: .light)) }
                    .accessibilityLabel("New design")
            }
            ToolbarItem(placement: .principal) {
                Text("Seamstress").font(.system(size: 20, weight: .regular, design: .serif)).tracking(0.5)
            }
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink(value: Route.profile) { Image(systemName: "person").font(.system(size: 17, weight: .light)) }
            }
        }
        .toolbarBackground(Theme.cream, for: .navigationBar)
        .task { await reload() }
    }

    /// One garment: turntable on the taupe ground, then name and two text actions.
    private func page(_ g: SavedGarment) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Turntable(views: cache[g.id] ?? [:], autoTurn: current == g.id)
                .frame(maxHeight: .infinity)
                .onAppear { if cache[g.id] == nil { cache[g.id] = GarmentStore.views(g.id) } }
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline) {
                    Text(g.name).titleStyle(24)
                    Spacer()
                    Text("\(index(of: g) + 1) / \(garments.count)").font(.caption).foregroundStyle(Theme.sand)
                }
                Text(Engine.familyLabel(g.family)).subtitleStyle()
                HStack(spacing: 24) {
                    Button("Edit") { onOpen(g) }
                    Button("Try on") { onTryOn(g) }
                    Spacer()
                    Text(GarmentStore.isSynced(g.id) ? "Stored" : "Waiting for your Mac")
                        .font(.caption).foregroundStyle(Theme.sand)
                }
                .font(.system(size: 15, weight: .semibold))
                .underline()
                .padding(.top, 4)
            }
            .foregroundStyle(Theme.brown)
            .padding(.horizontal, 20).padding(.top, 16).padding(.bottom, 28)
            .hairline(.top)
        }
    }

    private var empty: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Your wardrobe").titleStyle(30)
            Text("Garments you design are kept here, ready to turn around, try on and make.")
                .font(Theme.body(15))
            Rectangle().fill(Theme.linen).aspectRatio(0.8, contentMode: .fit)
                .overlay(Image(systemName: "hanger").font(.system(size: 44, weight: .ultraLight)).foregroundStyle(Theme.sand))
            Button("Design a garment", action: onNew).buttonStyle(TailoredButtonStyle())
            Spacer()
        }
        .foregroundStyle(Theme.brown)
        .padding(20)
    }

    private func index(of g: SavedGarment) -> Int { garments.firstIndex(of: g) ?? 0 }

    /// The wardrobe folder changes when the Mac syncs; check every few seconds while open.
    private func reload() async {
        while !Task.isCancelled {
            let now = GarmentStore.all()
            if now.map(\.id) != garments.map(\.id) {
                garments = now
                if current == nil || !now.contains(where: { $0.id == current }) { current = now.first?.id }
            }
            try? await Task.sleep(for: .seconds(4))
        }
    }
}
