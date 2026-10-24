import SwiftUI

/// The marketplace: designs people have made and offered up, each made to your measurements
/// by a seamstress. Yours appear too when you offer a design (Advanced settings). The demo's
/// community designs are fictional; their pictures are made by Gemini (Makers/market_<n>.jpg).
struct MarketplaceView: View {
    @EnvironmentObject private var wardrobe: WardrobeStore
    /// Start a design of your own from a listing.
    let onMake: (Listing) -> Void
    /// Open one of your own designs.
    let onOpen: (SavedGarment) -> Void

    @State private var opened: Listing?
    private let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]

    private var yours: [SavedGarment] { wardrobe.garments.filter { $0.forSale == true } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Marketplace").eyebrowStyle()
                    Text("Designed by others").titleStyle(32)
                    Text("Designs from the community, made to your measurements by a seamstress.")
                        .font(Theme.body(15)).lineSpacing(3)
                }
                .padding(20)
                if !yours.isEmpty {
                    Text("Yours on offer").eyebrowStyle().padding(.horizontal, 20).padding(.bottom, 10)
                    LazyVGrid(columns: columns, spacing: 22) {
                        ForEach(yours) { g in
                            Button { onOpen(g) } label: {
                                ListingTile(image: wardrobe.fronts[g.id], title: g.name, by: "You", price: Listing.price(for: g.family))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 20).padding(.bottom, 28)
                    Text("From the community").eyebrowStyle().padding(.horizontal, 20).padding(.bottom, 10)
                }
                LazyVGrid(columns: columns, spacing: 22) {
                    ForEach(Listing.all) { l in
                        Button { opened = l } label: { ListingTile(image: l.photo, title: l.title, by: l.designer, price: l.price, likes: l.likes) }
                            .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 20).padding(.bottom, 32)
            }
            .foregroundStyle(Theme.brown)
        }
        .background(Theme.cream.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $opened) { l in
            ListingView(listing: l) {
                opened = nil
                onMake(l)
            }
            .presentationDetents([.large])
            .presentationBackground(Theme.cream)
            .presentationDragIndicator(.visible)
        }
    }
}

private struct ListingTile: View {
    let image: UIImage?
    let title: String
    let by: String
    let price: Double
    var likes: Int?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Rectangle().fill(Theme.linen)
                .aspectRatio(0.75, contentMode: .fit)
                .overlay { if let image { Image(uiImage: image).resizable().scaledToFill() } else { MonogramPlaceholder() } }
                .clipped()
                .overlay(alignment: .topTrailing) {
                    if let likes {
                        Label("\(likes)", systemImage: "heart").font(.system(size: 11, weight: .medium))
                            .padding(.horizontal, 7).padding(.vertical, 4)
                            .background(Theme.cream.opacity(0.9)).padding(8)
                    }
                }
            Text(title).font(.system(size: 14, weight: .semibold)).lineLimit(1)
            HStack {
                Text("by \(by)").font(.caption).foregroundStyle(Theme.sand).lineLimit(1)
                Spacer()
                Text(CheckoutView.pounds(price)).font(.system(size: 13, weight: .semibold)).monospacedDigit()
            }
        }
    }
}

/// One listing: the picture, who designed it, the price, and Make it mine.
private struct ListingView: View {
    let listing: Listing
    let onMake: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Color.clear.aspectRatio(0.8, contentMode: .fit)
                    .overlay { if let p = listing.photo { Image(uiImage: p).resizable().scaledToFill() } }
                    .clipped()
                VStack(alignment: .leading, spacing: 8) {
                    Text("Designed by \(listing.designer)").eyebrowStyle()
                    Text(listing.title).titleStyle(28)
                    Text(listing.detail).font(Theme.body(15)).lineSpacing(3)
                    HStack(spacing: 16) {
                        Label("\(listing.likes)", systemImage: "heart")
                        Label("\(listing.made) made", systemImage: "scissors")
                    }
                    .font(.caption).foregroundStyle(Theme.sand).padding(.top, 4)
                    Text("Made to your measurements from \(CheckoutView.pounds(listing.price)), fitted on your mannequin first.")
                        .font(Theme.body(14)).padding(.top, 8)
                }
                .padding(20)
            }
            .foregroundStyle(Theme.brown)
        }
        .safeAreaInset(edge: .bottom) {
            Button(action: onMake) {
                HStack {
                    Text("Make it mine")
                    Spacer()
                    Image(systemName: "arrow.right").font(.system(size: 14, weight: .light))
                }
            }
            .buttonStyle(TailoredButtonStyle())
            .padding(.horizontal, 16).padding(.vertical, 12)
            .background(Theme.cream)
        }
    }
}

/// A design someone offered in the marketplace.
struct Listing: Identifiable, Hashable {
    let id: Int
    let title: String
    let detail: String
    let designer: String
    let price: Double
    let likes: Int
    let made: Int

    var photo: UIImage? {
        Bundle.main.url(forResource: "market_\(id)", withExtension: "jpg").flatMap { UIImage(contentsOfFile: $0.path) }
    }

    /// What having a design made costs, by kind, for designs offered from the wardrobe.
    static func price(for family: String) -> Double { family == "skirt" ? 260 : family == "knit" ? 240 : 340 }

    static let all: [Listing] = [
        .init(id: 1, title: "Corduroy chore coat", detail: "Rust needlecord with a shearling collar and three patch pockets.", designer: "Noor Aziz", price: 360, likes: 214, made: 38),
        .init(id: 2, title: "Boxy wool jacket", detail: "Black melton, dropped shoulders, oversized patch pockets.", designer: "Felix Wren", price: 380, likes: 167, made: 22),
        .init(id: 3, title: "Quilted field jacket", detail: "Forest-green diamond quilting, cord collar, brass snaps.", designer: "Hana Sato", price: 340, likes: 301, made: 51),
        .init(id: 4, title: "Linen overshirt", detail: "Sand linen with a camp collar, light enough for summer.", designer: "Leo Marchetti", price: 260, likes: 98, made: 17),
        .init(id: 5, title: "Herringbone car coat", detail: "Charcoal tweed, hip length, hidden placket.", designer: "Ruth Ellison", price: 420, likes: 188, made: 29),
        .init(id: 6, title: "Funnel-neck rib top", detail: "Mustard ribbed knit with a soft funnel neck.", designer: "Kwame Asante", price: 220, likes: 76, made: 12),
        .init(id: 7, title: "A-line wool skirt", detail: "Plum wool to mid-calf with a wide waistband.", designer: "Ines Duarte", price: 250, likes: 132, made: 24),
        .init(id: 8, title: "Canvas work jacket", detail: "Ecru canvas with contrast navy stitching.", designer: "Sam Okoro", price: 320, likes: 245, made: 44),
    ]
}
