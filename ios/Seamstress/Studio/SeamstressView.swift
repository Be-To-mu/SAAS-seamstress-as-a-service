import SwiftUI

/// Craft it: pick a seamstress from the platform, check out, and the order is placed.
/// The seamstress receives the pattern cut to your measurements and fitting, the
/// measurements and the views. The order is kept with the garment (order.json, synced
/// to MongoDB by the Mac). Demo platform: the seamstresses are fictional and no payment is taken.
struct SeamstressView: View {
    @EnvironmentObject private var draft: DesignDraft
    /// Opens a seamstress's page, with their work.
    let onPick: (Seamstress) -> Void

    enum Sort: String, CaseIterable { case recommended = "Recommended", rating = "Rating", made = "Most made" }
    @State private var verifiedOnly = false
    @State private var sort = Sort.recommended

    private var shown: [Seamstress] {
        let list = Seamstress.all.filter { !verifiedOnly || $0.verified }
        switch sort {
        case .recommended: return list
        case .rating: return list.sorted { ($0.rating, $0.reviews) > ($1.rating, $1.reviews) }
        case .made: return list.sorted { $0.made > $1.made }
        }
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Craft it").eyebrowStyle()
                    Text("Choose your seamstress").titleStyle(30)
                    Text("Each makes your \(draft.name.lowercased()) from the pattern cut to your measurements and fitting.")
                        .font(Theme.body(15)).lineSpacing(3).padding(.top, 4)
                }
                .padding(20)
                filters.padding(.horizontal, 20).padding(.bottom, 8)
                ForEach(shown) { s in
                    Button { onPick(s) } label: { SeamstressCard(seamstress: s) }
                        .buttonStyle(.plain)
                }
                Text("\(shown.count) seamstresses").font(.caption).foregroundStyle(Theme.sand)
                    .frame(maxWidth: .infinity).padding(24)
            }
            .foregroundStyle(Theme.brown)
        }
        .background(Theme.cream.ignoresSafeArea())
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var filters: some View {
        HStack(spacing: 10) {
            Button { withAnimation { verifiedOnly.toggle() } } label: {
                Label("Verified only", systemImage: verifiedOnly ? "checkmark.seal.fill" : "checkmark.seal")
                    .font(.system(size: 13, weight: .medium))
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(verifiedOnly ? Theme.brown : .clear)
                    .foregroundStyle(verifiedOnly ? Theme.cream : Theme.brown)
                    .overlay(Rectangle().stroke(Theme.brown, lineWidth: 0.75))
            }
            .buttonStyle(.plain)
            Spacer()
            Menu {
                Picker("Sort", selection: $sort) { ForEach(Sort.allCases, id: \.self) { Text($0.rawValue) } }
            } label: {
                HStack(spacing: 4) {
                    Text(sort.rawValue)
                    Image(systemName: "chevron.down").font(.system(size: 10, weight: .semibold))
                }
                .font(.system(size: 13, weight: .medium))
            }
        }
    }
}

/// One seamstress in the gallery: portrait, name, where, what they make best, rating, pieces made, verified.
private struct SeamstressCard: View {
    let seamstress: Seamstress

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Color.clear.aspectRatio(4 / 3, contentMode: .fit)
                .overlay { if let p = seamstress.photo { Image(uiImage: p).resizable().scaledToFill() } else { Theme.linen } }
                .clipped()
                .overlay(alignment: .topLeading) {
                    if seamstress.verified { VerifiedBadge().padding(12) }
                }
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline) {
                    Text(seamstress.name).titleStyle(22)
                    Spacer()
                    Stars(rating: seamstress.rating)
                    Text(String(format: "%.1f", seamstress.rating)).font(.system(size: 14, weight: .semibold)).monospacedDigit()
                }
                Text("\(seamstress.city) · \(seamstress.specialty)").font(Theme.body(14))
                HStack(spacing: 14) {
                    Label("\(seamstress.made) made", systemImage: "scissors")
                    Label("\(seamstress.reviews) reviews", systemImage: "text.bubble")
                    Spacer()
                    Text("Ready in \(seamstress.weeks) weeks")
                }
                .font(.caption).foregroundStyle(Theme.sand)
                HStack(spacing: 6) {
                    ForEach(seamstress.work) { w in
                        Color.clear.frame(width: 40, height: 52)
                            .overlay { if let p = w.photo { Image(uiImage: p).resizable().scaledToFill() } }
                            .clipped()
                    }
                    Text("Their work").font(.caption).underline().padding(.leading, 4).fixedSize()
                    Spacer()
                    Text(CheckoutView.pounds(seamstress.price)).font(.system(size: 17, weight: .semibold)).monospacedDigit()
                        .fixedSize()
                }
                .padding(.top, 6)
                if !seamstress.verified {
                    Text("Not yet verified by Seamstress").font(.caption).foregroundStyle(Theme.sand).italic()
                }
            }
            .padding(.horizontal, 20).padding(.top, 14).padding(.bottom, 26)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityHint("Choose \(seamstress.name)")
    }
}

private struct VerifiedBadge: View {
    var body: some View {
        Label("Verified", systemImage: "checkmark.seal.fill")
            .font(.system(size: 12, weight: .semibold))
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(Theme.cream.opacity(0.92))
            .foregroundStyle(Theme.brown)
    }
}

private struct Stars: View {
    let rating: Double
    var body: some View {
        HStack(spacing: 1) {
            ForEach(0..<5, id: \.self) { i in
                Image(systemName: rating >= Double(i) + 0.75 ? "star.fill" : rating >= Double(i) + 0.25 ? "star.leadinghalf.filled" : "star")
            }
        }
        .font(.system(size: 10))
        .foregroundStyle(Theme.accent)
        .accessibilityLabel(String(format: "Rated %.1f out of 5", rating))
    }
}

// MARK: - A seamstress's page

/// One seamstress: who they are, what they've made (a quality check before choosing them), the price.
struct SeamstressProfileView: View {
    @EnvironmentObject private var draft: DesignDraft
    let seamstress: Seamstress
    let onChoose: () -> Void
    @State private var opened: Work?

    private let columns = [GridItem(.flexible(), spacing: 2), GridItem(.flexible(), spacing: 2)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Color.clear.aspectRatio(4 / 3, contentMode: .fit)
                    .overlay { if let p = seamstress.photo { Image(uiImage: p).resizable().scaledToFill() } }
                    .clipped()
                    .overlay(alignment: .topLeading) { if seamstress.verified { VerifiedBadge().padding(12) } }
                VStack(alignment: .leading, spacing: 8) {
                    Text(seamstress.city).eyebrowStyle()
                    Text(seamstress.name).titleStyle(30)
                    Text(seamstress.specialty).font(Theme.body(16))
                    HStack(spacing: 16) {
                        HStack(spacing: 4) {
                            Stars(rating: seamstress.rating)
                            Text(String(format: "%.1f", seamstress.rating)).font(.system(size: 14, weight: .semibold))
                            Text("(\(seamstress.reviews))").font(.caption).foregroundStyle(Theme.sand)
                        }
                        Label("\(seamstress.made) made", systemImage: "scissors").font(.caption)
                        Label("\(seamstress.weeks) weeks", systemImage: "clock").font(.caption)
                    }
                    .padding(.top, 4)
                    Text(seamstress.verified
                         ? "Verified: Seamstress has checked their workshop, their finishing and a sample piece."
                         : "Not yet verified by Seamstress. See their work below before you choose.")
                        .font(.caption).foregroundStyle(Theme.sand).padding(.top, 4)
                }
                .padding(20)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Their work").eyebrowStyle()
                    Text("Pieces made to measure by \(seamstress.name.split(separator: " ").first ?? "")").font(Theme.body(14))
                }
                .padding(.horizontal, 20).padding(.bottom, 12)
                LazyVGrid(columns: columns, spacing: 2) {
                    ForEach(seamstress.work) { w in
                        Button { opened = w } label: {
                            Color.clear.aspectRatio(3 / 4, contentMode: .fit)
                                .overlay { if let p = w.photo { Image(uiImage: p).resizable().scaledToFill() } else { Theme.linen } }
                                .clipped()
                                .overlay(alignment: .bottomLeading) {
                                    Text(w.title).font(.system(size: 12, weight: .medium))
                                        .padding(.horizontal, 8).padding(.vertical, 5)
                                        .background(Theme.cream.opacity(0.9)).padding(8)
                                }
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.bottom, 24)
            }
            .foregroundStyle(Theme.brown)
        }
        .background(Theme.cream.ignoresSafeArea())
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            Button(action: onChoose) {
                HStack {
                    Text("Choose \(seamstress.name.split(separator: " ").first ?? "") · \(CheckoutView.pounds(seamstress.price))")
                    Spacer()
                    Image(systemName: "arrow.right").font(.system(size: 14, weight: .light))
                }
            }
            .buttonStyle(TailoredButtonStyle())
            .padding(.horizontal, 16).padding(.vertical, 12)
            .background(Theme.cream)
            .hairline(.top)
        }
        .sheet(item: $opened) { w in
            VStack(alignment: .leading, spacing: 10) {
                Color.clear.aspectRatio(3 / 4, contentMode: .fit)
                    .overlay { if let p = w.photo { Image(uiImage: p).resizable().scaledToFill() } }
                    .clipped()
                Text(w.title).titleStyle(22).padding(.horizontal, 20)
                Text(w.detail).font(Theme.body(15)).padding(.horizontal, 20)
                Spacer()
            }
            .foregroundStyle(Theme.brown)
            .presentationDetents([.large])
            .presentationBackground(Theme.cream)
            .presentationDragIndicator(.visible)
        }
    }
}

// MARK: - Checkout

/// A proper checkout: the order, where it's delivered, payment, the total, Pay.
/// Prefilled for the demo; the card is a test card and nothing is charged.
struct CheckoutView: View {
    @EnvironmentObject private var draft: DesignDraft
    let seamstress: Seamstress
    let save: () -> Void
    let onPlaced: () -> Void

    @State private var name = "Tom Kluyver"
    @State private var line1 = "12 Bermondsey Street"
    @State private var line2 = "Flat 3"
    @State private var city = "London"
    @State private var postcode = "SE1 3TQ"
    @State private var email = "orders@example.com"
    @State private var card = "4242 4242 4242 4242"
    @State private var expiry = "12 / 29"
    @State private var cvc = "123"
    @State private var cardName = "Tom Kluyver"
    @State private var paying = false
    @FocusState private var focus: Bool

    private var valid: Bool {
        let digits = card.filter(\.isNumber)
        return ![name, line1, city, postcode, cardName].contains { $0.trimmingCharacters(in: .whitespaces).isEmpty }
            && digits.count == 16 && expiry.filter(\.isNumber).count == 4 && (3...4).contains(cvc.filter(\.isNumber).count)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Checkout").eyebrowStyle()
                    Text("Your order").titleStyle(30)
                }
                .padding(20)
                summary
                section("Delivery") {
                    field("Full name", $name, content: .name)
                    field("Address", $line1, content: .streetAddressLine1)
                    field("Flat, floor (optional)", $line2, content: .streetAddressLine2)
                    HStack(spacing: 12) {
                        field("Town or city", $city, content: .addressCity)
                        field("Postcode", $postcode, content: .postalCode).frame(width: 120)
                    }
                    field("Email for updates", $email, content: .emailAddress, keyboard: .emailAddress)
                }
                section("Payment") {
                    HStack {
                        field("Card number", $card, content: .creditCardNumber, keyboard: .numberPad)
                        Image(systemName: "creditcard").font(.system(size: 18, weight: .light)).foregroundStyle(Theme.sand)
                    }
                    HStack(spacing: 12) {
                        field("Expiry (MM / YY)", $expiry, keyboard: .numberPad)
                        field("CVC", $cvc, keyboard: .numberPad).frame(width: 100)
                    }
                    field("Name on card", $cardName, content: .name)
                    Label("Demo checkout: this is a test card and no payment is taken.", systemImage: "lock")
                        .font(.caption).foregroundStyle(Theme.sand)
                }
                totals.padding(20)
            }
            .foregroundStyle(Theme.brown)
        }
        .scrollDismissesKeyboard(.immediately)
        .background(Theme.cream.ignoresSafeArea())
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            Button { Task { await pay() } } label: {
                HStack {
                    if paying { ProgressView().tint(Theme.cream) } else { Image(systemName: "lock.fill").font(.system(size: 13)) }
                    Text(paying ? "Paying…" : "Pay \(Self.money(seamstress.price))")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(TailoredButtonStyle())
            .disabled(!valid || paying)
            .opacity(valid ? 1 : 0.45)
            .padding(.horizontal, 16).padding(.vertical, 12)
            .background(Theme.cream)
            .hairline(.top)
        }
    }

    private var summary: some View {
        HStack(alignment: .top, spacing: 14) {
            Color.clear.frame(width: 84, height: 112)
                .overlay { if let f = draft.front { Image(uiImage: f).resizable().scaledToFill() } else { MonogramPlaceholder() } }
                .clipped()
            VStack(alignment: .leading, spacing: 5) {
                Text(draft.name).font(.system(size: 16, weight: .semibold))
                Text("Made to measure by \(seamstress.name), \(seamstress.city)").font(Theme.body(14))
                Text("Pattern cut to your measurements\(draft.fit.isEmpty ? "" : " and fitting")").font(.caption).foregroundStyle(Theme.sand)
                Text("Ready in about \(seamstress.weeks) weeks").font(.caption).foregroundStyle(Theme.sand)
            }
            Spacer()
        }
        .padding(20)
        .hairline(.top).hairline(.bottom)
    }

    private var totals: some View {
        VStack(spacing: 10) {
            row("Making, cloth and fitting", Self.money(seamstress.price))
            row("Delivery", "Free")
            Rectangle().fill(Theme.hairline).frame(height: 0.5)
            HStack {
                Text("Total").font(.system(size: 17, weight: .semibold))
                Spacer()
                Text(Self.money(seamstress.price)).font(.system(size: 17, weight: .semibold)).monospacedDigit()
            }
            Text("Includes VAT").font(.caption).foregroundStyle(Theme.sand).frame(maxWidth: .infinity, alignment: .trailing)
        }
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).font(Theme.body(15))
            Spacer()
            Text(value).font(Theme.body(15)).monospacedDigit()
        }
    }

    private func section<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(title).eyebrowStyle()
            content()
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .hairline(.bottom)
    }

    private func field(_ label: String, _ text: Binding<String>, content: UITextContentType? = nil,
                       keyboard: UIKeyboardType = .default) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption).foregroundStyle(Theme.sand)
            TextField("", text: text)
                .font(Theme.body(16))
                .textContentType(content)
                .keyboardType(keyboard)
                .autocorrectionDisabled()
                .focused($focus)
                .padding(.bottom, 6)
                .overlay(alignment: .bottom) { Rectangle().fill(Theme.hairline).frame(height: 0.75) }
        }
    }

    private func pay() async {
        focus = false
        paying = true
        try? await Task.sleep(for: .seconds(1.6))  // the demo's payment
        let placed = Date()
        draft.order = Order(
            number: "SM-" + String(Int(placed.timeIntervalSince1970) % 1_000_000),
            seamstressID: seamstress.id, seamstressName: seamstress.name, price: seamstress.price, currency: "GBP",
            deliverTo: Order.Address(name: name, line1: line1, line2: line2, city: city, postcode: postcode, email: email),
            cardLast4: String(card.filter(\.isNumber).suffix(4)), placed: placed,
            ready: Calendar.current.date(byAdding: .day, value: 7 * seamstress.weeks, to: placed) ?? placed)
        save()
        paying = false
        onPlaced()
    }

    static func money(_ v: Double) -> String { v.formatted(.currency(code: "GBP")) }
    /// Whole pounds, for prices in lists: "£350".
    static func pounds(_ v: Double) -> String { v.formatted(.currency(code: "GBP").precision(.fractionLength(0))) }
}

// MARK: - Placed

struct OrderPlacedView: View {
    @EnvironmentObject private var draft: DesignDraft
    let onDone: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer()
            Image(systemName: "checkmark.circle").font(.system(size: 44, weight: .ultraLight)).padding(.bottom, 18)
            Text("Order placed").eyebrowStyle()
            Text("Thank you").titleStyle(36).padding(.top, 6)
            if let o = draft.order {
                Text("\(o.seamstressName) has your pattern, measurements and the views of your \(draft.name.lowercased()), and starts once they've checked them.")
                    .font(Theme.body(16)).lineSpacing(3).padding(.top, 12)
                VStack(spacing: 10) {
                    line("Order", o.number)
                    line("Ready by", o.ready.formatted(date: .long, time: .omitted))
                    line("Delivered to", "\(o.deliverTo.line1), \(o.deliverTo.postcode)")
                    line("Paid", "\(CheckoutView.money(o.price)) · card ending \(o.cardLast4)")
                }
                .padding(.vertical, 20)
                .hairline(.top).hairline(.bottom)
                .padding(.top, 24)
            }
            Spacer()
        }
        .padding(24)
        .foregroundStyle(Theme.brown)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.cream.ignoresSafeArea())
        .navigationBarBackButtonHidden()
        .safeAreaInset(edge: .bottom) {
            Button("Back to your wardrobe", action: onDone)
                .buttonStyle(TailoredButtonStyle())
                .padding(.horizontal, 16).padding(.vertical, 12)
        }
    }

    private func line(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(.caption).foregroundStyle(Theme.sand)
            Spacer()
            Text(value).font(Theme.body(15)).multilineTextAlignment(.trailing)
        }
    }
}

// MARK: - Data

/// An order for one garment (order.json with the garment).
struct Order: Codable, Equatable {
    struct Address: Codable, Equatable {
        var name, line1, line2, city, postcode, email: String
    }

    var number: String
    var seamstressID: String
    var seamstressName: String
    var price: Double
    var currency: String
    var deliverTo: Address
    var cardLast4: String
    var placed: Date
    var ready: Date
}

/// A finished piece in a seamstress's portfolio (Makers/work_<n>.jpg, made by Gemini).
struct Work: Identifiable, Hashable {
    let id: Int
    let title: String
    let detail: String

    var photo: UIImage? {
        Bundle.main.url(forResource: "work_\(id)", withExtension: "jpg").flatMap { UIImage(contentsOfFile: $0.path) }
    }

    static let all: [Work] = [
        .init(id: 1, title: "Navy overcoat", detail: "Wool, peak lapels, horn buttons"),
        .init(id: 2, title: "Olive chore coat", detail: "Cotton twill, contrast topstitching"),
        .init(id: 3, title: "Pleated midi skirt", detail: "Fine camel wool"),
        .init(id: 4, title: "Cable-knit jumper", detail: "Cream wool, ribbed crew neck"),
        .init(id: 5, title: "Linen shirt-jacket", detail: "Indigo linen, mother-of-pearl buttons"),
    ]
}

/// A seamstress on the platform. The demo's seamstresses are fictional; their portraits are
/// made by Gemini (Makers/maker_<id>.jpg).
struct Seamstress: Identifiable, Hashable {
    let id: String
    let name: String
    let city: String
    let specialty: String
    let rating: Double
    let reviews: Int
    let made: Int
    let verified: Bool
    let weeks: Int
    /// What they charge to make a garment: making, cloth and fitting.
    let price: Double

    var photo: UIImage? {
        Bundle.main.url(forResource: "maker_\(id)", withExtension: "jpg").flatMap { UIImage(contentsOfFile: $0.path) }
    }

    static func find(_ id: String) -> Seamstress? { all.first { $0.id == id } }

    /// Pieces they've made. For the proof of concept every seamstress shows the same five.
    var work: [Work] { Work.all }

    static let all: [Seamstress] = [
        .init(id: "amara", name: "Amara Okafor", city: "Peckham, London", specialty: "Tailored coats and jackets", rating: 4.9, reviews: 212, made: 486, verified: true, weeks: 3, price: 350),
        .init(id: "kenji", name: "Kenji Morita", city: "Shoreditch, London", specialty: "Workwear and chore coats", rating: 4.9, reviews: 156, made: 390, verified: true, weeks: 3, price: 320),
        .init(id: "marco", name: "Marco Rossi", city: "Glasgow", specialty: "Bespoke tailoring", rating: 4.9, reviews: 188, made: 452, verified: true, weeks: 5, price: 480),
        .init(id: "priya", name: "Priya Raman", city: "Leicester", specialty: "Fine knits and jersey", rating: 5.0, reviews: 64, made: 142, verified: true, weeks: 2, price: 290),
        .init(id: "isla", name: "Isla MacLeod", city: "Edinburgh", specialty: "Tweed and wool outerwear", rating: 4.9, reviews: 133, made: 301, verified: true, weeks: 4, price: 420),
        .init(id: "tomasz", name: "Tomasz Wójcik", city: "Leeds", specialty: "Outerwear in heavy cottons", rating: 4.8, reviews: 98, made: 231, verified: true, weeks: 3, price: 330),
        .init(id: "grace", name: "Grace Mensah", city: "Birmingham", specialty: "Occasion wear and skirts", rating: 4.8, reviews: 77, made: 164, verified: true, weeks: 3, price: 360),
        .init(id: "eleanor", name: "Eleanor Hughes", city: "Bath", specialty: "Skirts and soft tailoring", rating: 4.7, reviews: 41, made: 88, verified: false, weeks: 4, price: 300),
        .init(id: "lena", name: "Lena Fischer", city: "Brighton", specialty: "Linen and summer pieces", rating: 4.7, reviews: 52, made: 110, verified: false, weeks: 2, price: 270),
        .init(id: "fatima", name: "Fatima Haddad", city: "Manchester", specialty: "Linings and finishing", rating: 4.6, reviews: 27, made: 53, verified: false, weeks: 3, price: 260),
        .init(id: "joao", name: "João Pereira", city: "Bristol", specialty: "Denim and casualwear", rating: 4.5, reviews: 19, made: 37, verified: false, weeks: 2, price: 240),
        .init(id: "aisha", name: "Aisha Rahman", city: "Cardiff", specialty: "Knitwear", rating: 4.4, reviews: 12, made: 21, verified: false, weeks: 2, price: 220),
    ]
}
