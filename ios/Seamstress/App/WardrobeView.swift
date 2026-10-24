import SwiftUI

/// The Wardrobe tab: everything you've designed (synced with MongoDB by the Mac), each
/// shown by its generated front picture. Preloaded by `WardrobeStore` when the app starts.
/// New designs start from the Create tab.
struct WardrobeView: View {
    @EnvironmentObject private var wardrobe: WardrobeStore
    let onOpen: (SavedGarment) -> Void
    let onNew: () -> Void

    private let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Wardrobe").eyebrowStyle()
                    HStack(alignment: .firstTextBaseline) {
                        Text("Your designs").titleStyle(32)
                        Spacer()
                        if !wardrobe.garments.isEmpty {
                            Text("\(wardrobe.garments.count)").font(.caption).foregroundStyle(Theme.sand)
                        }
                    }
                }
                .padding(20)
                if !wardrobe.garments.isEmpty {
                    LazyVGrid(columns: columns, spacing: 22) {
                        ForEach(wardrobe.garments) { g in
                            Button { onOpen(g) } label: { PieceTile(garment: g) }.buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 32)
                } else if !wardrobe.loaded {
                    AtelierProgress(size: 44).frame(maxWidth: .infinity).padding(40)
                } else {
                    empty
                }
            }
            .foregroundStyle(Theme.brown)
        }
        .background(Theme.cream.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text("Seamstress").font(.system(size: 20, weight: .regular, design: .serif)).tracking(0.5)
            }
        }
        .toolbarBackground(Theme.cream, for: .navigationBar)
    }

    /// Nothing designed yet.
    private var empty: some View {
        VStack(alignment: .leading, spacing: 14) {
            Monogram(size: 46, color: Theme.brown).padding(.bottom, 6)
            Text("Nothing here yet").titleStyle(24)
            Text("Bring pieces you admire and a few words. We'll draw it, fit it on you, and cut the pattern to your measurements.")
                .font(Theme.body(15)).lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
            Button(action: onNew) {
                HStack {
                    Text("Create a design")
                    Spacer()
                    Image(systemName: "arrow.right").font(.system(size: 14, weight: .light))
                }
            }
            .buttonStyle(TailoredButtonStyle())
            .padding(.top, 6)
        }
        .padding(20)
        .background(Theme.linen)
        .padding(.horizontal, 20)
    }
}

/// One piece: its front picture on the taupe ground, then its name.
private struct PieceTile: View {
    @EnvironmentObject private var wardrobe: WardrobeStore
    let garment: SavedGarment

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Rectangle().fill(Theme.linen)
                .aspectRatio(0.75, contentMode: .fit)
                .overlay {
                    if let front = wardrobe.fronts[garment.id] {
                        Image(uiImage: front).resizable().scaledToFill().arrives()
                    } else if wardrobe.drawing.contains(garment.id) {
                        AtelierProgress(size: 40, caption: "Drawing")
                    } else {
                        MonogramPlaceholder()
                    }
                }
                .clipped()
                .overlay(alignment: .topLeading) {
                    if garment.forSale == true {
                        Text("On offer").font(.system(size: 11, weight: .medium))
                            .padding(.horizontal, 7).padding(.vertical, 4).background(Theme.cream.opacity(0.9)).padding(8)
                    }
                }
            Text(garment.name).font(.system(size: 14, weight: .semibold)).lineLimit(1)
            Text(Engine.familyLabel(garment.family)).font(.caption).foregroundStyle(Theme.sand).lineLimit(1)
        }
    }
}
