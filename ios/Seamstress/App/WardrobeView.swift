import SwiftUI

/// Home. Creating a new design comes first; below it, your pieces (the wardrobe,
/// synced with MongoDB by the Mac), each shown by its generated front picture.
/// Everything is preloaded by `WardrobeStore` when the app starts.
struct WardrobeView: View {
    @EnvironmentObject private var wardrobe: WardrobeStore
    let onOpen: (SavedGarment) -> Void
    let onNew: () -> Void

    private let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                hero
                if !wardrobe.garments.isEmpty {
                    HStack(alignment: .firstTextBaseline) {
                        Text("Your wardrobe").titleStyle(24)
                        Spacer()
                        Text("\(wardrobe.garments.count)").font(.caption).foregroundStyle(Theme.sand)
                    }
                    .padding(.horizontal, 20).padding(.top, 28).padding(.bottom, 14)
                    LazyVGrid(columns: columns, spacing: 22) {
                        ForEach(wardrobe.garments) { g in
                            Button { onOpen(g) } label: { PieceTile(garment: g) }.buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 32)
                } else if !wardrobe.loaded {
                    AtelierProgress(size: 44).frame(maxWidth: .infinity).padding(40)
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
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink(value: Route.profile) { Image(systemName: "person").font(.system(size: 17, weight: .light)) }
            }
        }
        .toolbarBackground(Theme.cream, for: .navigationBar)
    }

    /// The main thing to do here.
    private var hero: some View {
        VStack(alignment: .leading, spacing: 14) {
            Monogram(size: 46, color: Theme.brown).padding(.bottom, 10)
            Text("Made to measure").eyebrowStyle()
            Text("Create a new design").titleStyle(36)
            Text("Bring pieces you admire and a few words. We'll draw it, fit it on you, and cut the pattern to your measurements.")
                .font(Theme.body(15)).lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
            Button(action: onNew) {
                HStack {
                    Text("Begin a design")
                    Spacer()
                    Image(systemName: "arrow.right").font(.system(size: 14, weight: .light))
                }
            }
            .buttonStyle(TailoredButtonStyle())
            .padding(.top, 10)
        }
        .padding(.horizontal, 20)
        .padding(.top, 28).padding(.bottom, 26)
        .background(Theme.linen)
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
            Text(garment.name).font(.system(size: 14, weight: .semibold)).lineLimit(1)
            Text(Engine.familyLabel(garment.family)).font(.caption).foregroundStyle(Theme.sand).lineLimit(1)
        }
    }
}
