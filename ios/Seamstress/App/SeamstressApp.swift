import SwiftUI

@main
struct SeamstressApp: App {
    init() {
        let brown = UIColor(Theme.brown)
        UINavigationBar.appearance().titleTextAttributes = [.foregroundColor: brown]
        UINavigationBar.appearance().largeTitleTextAttributes = [.foregroundColor: brown]
    }

    var body: some Scene {
        WindowGroup {
            // The palette is light only: in dark mode the system drew white titles on the cream bar.
            RootView().tint(Theme.brown).preferredColorScheme(.light)
        }
    }
}

/// Landing: the camera on first launch (scan your body); afterwards four tabs: Wardrobe
/// (everything you've designed), Create design (straight to a new design), Marketplace
/// (designs others have offered) and Profile. Each tab keeps its own navigation. A design goes
/// creating → the design, on your mannequin or turned round → Craft it (seamstress, checkout).
struct RootView: View {
    enum Tab: Hashable { case wardrobe, create, market, profile }

    @StateObject private var profile = BodyProfile()
    @StateObject private var draft = DesignDraft()
    @StateObject private var wardrobe = WardrobeStore()
    @State private var hasBody = !ScanStore.all().isEmpty
    @State private var scanning = false
    /// A new scan being finished: mannequin → measurements → what next, before the tabs appear.
    @State private var finishing: URL? = FittingFlow.pending
    @State private var tab = Tab.wardrobe
    @State private var paths: [Tab: NavigationPath] = [:]
    /// The design request waiting for the Creating page (nil = redraw the current design).
    @State private var pending: DesignInput?

    /// The open tab's navigation.
    private var path: NavigationPath {
        get { paths[tab] ?? NavigationPath() }
        nonmutating set { paths[tab] = newValue }
    }

    var body: some View {
        Group {
            if !hasBody || scanning {
                ScanView(canCancel: hasBody) { finished in
                    scanning = false
                    if let finished {
                        ScanStore.keepOnly(finished)  // one body at a time
                        hasBody = true
                        FittingFlow.pending = finished
                        finishing = finished
                    }
                }
            } else if let scan = finishing {
                FittingFlow(scan: scan) { next in
                    FittingFlow.pending = nil
                    paths = [:]
                    tab = next
                    finishing = nil
                }
            } else {
                TabView(selection: $tab) {
                    stack(.wardrobe) { WardrobeView(onOpen: open, onNew: { tab = .create }) }
                        .tabItem { Label("Wardrobe", systemImage: "hanger") }
                        .tag(Tab.wardrobe)
                    stack(.create) { DesignView(onDesign: startDesign) }
                        .tabItem { Label("Create design", systemImage: "scissors") }
                        .tag(Tab.create)
                    stack(.market) { MarketplaceView(onMake: makeFromListing, onOpen: open) }
                        .tabItem { Label("Marketplace", systemImage: "bag") }
                        .tag(Tab.market)
                    stack(.profile) { ProfileView(onRescan: { scanning = true }, onReset: resetApp) }
                        .tabItem { Label("Profile", systemImage: "person") }
                        .tag(Tab.profile)
                }
                .tint(Theme.brown)
            }
        }
        .environmentObject(profile)
        .environmentObject(draft)
        .environmentObject(wardrobe)
        .task { await wardrobe.run() }  // preload the wardrobe as the app starts
        .onAppear(perform: openDebugRoute)
    }

    /// One tab's navigation.
    private func stack<Root: View>(_ t: Tab, @ViewBuilder root: () -> Root) -> some View {
        NavigationStack(path: Binding { paths[t] ?? NavigationPath() } set: { paths[t] = $0 }) {
            root().navigationDestination(for: Route.self, destination: destination)
        }
    }

    private func startDesign(_ input: DesignInput) {
        pending = input
        path.append(Route.creating)
    }

    /// Start your own design from a marketplace listing: its picture is the reference.
    private func makeFromListing(_ l: Listing) {
        draft.reset()
        let picture = l.photo?.dataURL()
        draft.references = picture.map { [$0] } ?? []
        startDesign(DesignInput(images: draft.references, description: "\(l.title): \(l.detail)", mode: "match", current: nil))
    }

    /// Start again from scratch, as on first launch: everything on the phone goes, and reset.json asks
    /// the Mac (`bodyfit usb`) to delete the designs in MongoDB the next time the phone is plugged in.
    private func resetApp() {
        let fm = FileManager.default
        let docs = fm.urls(for: .documentDirectory, in: .userDomainMask)[0]
        for item in (try? fm.contentsOfDirectory(at: docs, includingPropertiesForKeys: nil)) ?? [] {
            try? fm.removeItem(at: item)
        }
        if let id = Bundle.main.bundleIdentifier { UserDefaults.standard.removePersistentDomain(forName: id) }
        let request = ["requested": ISO8601DateFormatter().string(from: Date())]
        try? JSONSerialization.data(withJSONObject: request).write(to: docs.appending(path: "reset.json"))
        draft.reset()
        wardrobe.reset()
        profile.reset()
        MannequinMaker.shared.reset()
        Dresser.shared.reset()
        paths = [:]
        tab = .wardrobe
        finishing = nil
        hasBody = false
    }

    /// Back to the wardrobe, where the design now is.
    private func home() {
        paths = [:]
        tab = .wardrobe
    }

    @ViewBuilder private func destination(_ route: Route) -> some View {
        switch route {
        case .body(let scan):
            ResultView(scan: scan) { path.append(Route.design) }
        case .measurements:
            MeasurementsView()  // from the profile: just the numbers, no next step
        case .design:
            DesignView(onDesign: startDesign)
        case .creating:
            CreatingView(input: pending, save: autosave) {
                pending = nil
                // Replace "creating" with the result, so Back returns to the design page.
                path.removeLast()
                path.append(Route.spin)
            }
        case .spin:
            SpinView(save: autosave, onPattern: { path.append(Route.pattern) },
                     onSave: home,  // kept: back to the wardrobe
                     onCraft: { path.append(Route.seamstress) },
                     onRedraw: { pending = nil; path.append(Route.creating) })
        case .seamstress:
            SeamstressView { path.append(Route.seamstressProfile($0.id)) }
        case .seamstressProfile(let id):
            if let s = Seamstress.find(id) {
                SeamstressProfileView(seamstress: s) { path.append(Route.checkout(id)) }
            }
        case .checkout(let id):
            if let s = Seamstress.find(id) {
                CheckoutView(seamstress: s, save: autosave) { path.append(Route.ordered) }
            }
        case .ordered:
            OrderPlacedView(onDone: home)
        case .style:
            StyleView { path.append(Route.pattern) }
        case .order(let id):
            OrderDetailView(garmentID: id)
        case .pattern:
            PatternView(onSaved: home)  // saved: back to the wardrobe
        }
    }

    /// A garment with its own front goes straight to its views; one without draws them first.
    private func open(_ g: SavedGarment) {
        draft.load(g)
        if draft.front == nil {
            pending = nil
            path.append(Route.creating)
        } else {
            path.append(Route.spin)
        }
    }

    /// Designs are kept as their pictures arrive, so they show in the wardrobe at once.
    private func autosave() {
        wardrobe.save(draft, measurements: profile.webMeasurements)
    }

    /// Debug builds: `-route <name>` opens that screen, for screenshots in the simulator.
    private func openDebugRoute() {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-route"), i + 1 < args.count else { return }
        if let g = GarmentStore.all().first { draft.load(g) }
        if let scan = ScanStore.current, let m = ScanStore.measurements(of: scan) { profile.adopt(scan: scan, measurements: m) }
        let route: Route? = switch args[i + 1] {
        case "body": ScanStore.current.map { .body($0) }
        case "measurements": .measurements
        case "design": .design
        case "spin": .spin
        case "seamstress": .seamstress
        case "checkout": .checkout("amara")
        case "maker": .seamstressProfile("amara")
        case "style": .style
        case "pattern": .pattern
        case "profile", "market": nil
        default: nil
        }
        // e.g. `-fit length=6,waist=-8` presets the fitting adjustments.
        if let j = args.firstIndex(of: "-fit"), j + 1 < args.count {
            for pair in args[j + 1].split(separator: ",") {
                let kv = pair.split(separator: "=")
                if kv.count == 2, let v = Double(kv[1]) { draft.fit[String(kv[0])] = v }
            }
        }
        if args[i + 1] == "market" { tab = .market }
        if args[i + 1] == "create" { tab = .create }
        if args[i + 1] == "profile" { tab = .profile }
        if let route { path = NavigationPath([route]) }
        #endif
    }
}

/// After a new scan, everything else waits: your mannequin, then your measurements to check
/// and confirm, then a choice of what to do first. Only then the tabs. Resumes after a relaunch.
struct FittingFlow: View {
    let scan: URL
    let onDone: (RootView.Tab) -> Void
    @State private var path = NavigationPath()

    enum Step: Hashable { case measurements, ready }

    var body: some View {
        NavigationStack(path: $path) {
            ResultView(scan: scan, onNext: { path.append(Step.measurements) }, finalising: true)
                .navigationBarBackButtonHidden()
                .navigationDestination(for: Step.self) { step in
                    switch step {
                    case .measurements:
                        MeasurementsView(onNext: { path.append(Step.ready) }, finalising: true)
                    case .ready:
                        FittingDone(onDesign: { onDone(.create) }, onMarket: { onDone(.market) })
                    }
                }
        }
    }

    /// The scan still to be finished, kept across launches.
    static var pending: URL? {
        get {
            guard let name = UserDefaults.standard.string(forKey: "fitting.pending") else { return nil }
            return ScanStore.all().first { $0.lastPathComponent == name }
        }
        set { UserDefaults.standard.set(newValue?.lastPathComponent, forKey: "fitting.pending") }
    }
}

/// The fitting is done: design something, or see what others have made.
private struct FittingDone: View {
    let onDesign: () -> Void
    let onMarket: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer()
            Monogram(size: 56, color: Theme.brown).padding(.bottom, 22)
            Text("Your fitting is done").eyebrowStyle()
            Text("You're measured").titleStyle(36).padding(.top, 6)
            Text("Your mannequin and measurements are ready. Everything you have made is cut to them.")
                .font(Theme.body(16)).lineSpacing(3).padding(.top, 12)
            Spacer()
            VStack(spacing: 12) {
                Button(action: onDesign) {
                    HStack {
                        Text("Design a garment")
                        Spacer()
                        Image(systemName: "arrow.right").font(.system(size: 14, weight: .light))
                    }
                }
                .buttonStyle(TailoredButtonStyle())
                Button(action: onMarket) {
                    HStack {
                        Text("Browse the marketplace")
                        Spacer()
                        Image(systemName: "arrow.right").font(.system(size: 14, weight: .light))
                    }
                }
                .buttonStyle(TailoredButtonStyle(filled: false))
            }
        }
        .padding(24)
        .foregroundStyle(Theme.brown)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.cream.ignoresSafeArea())
        .navigationBarBackButtonHidden()
    }
}

enum Route: Hashable {
    case body(URL), measurements, design, creating, spin, seamstress, seamstressProfile(String), checkout(String), ordered, order(String), style, pattern
}

/// Your body (the mannequin's sex, the measurements), your orders, and redoing the scan.
/// The phone keeps one body at a time.
struct ProfileView: View {
    let onRescan: () -> Void
    let onReset: () -> Void
    @State private var confirmReset = false
    @EnvironmentObject private var profile: BodyProfile
    @ObservedObject private var maker = MannequinMaker.shared
    @State private var scan: URL?
    @State private var orders: [(garment: SavedGarment, order: Order)] = []

    var body: some View {
        List {
            if let scan {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Body").font(.caption).foregroundStyle(Theme.sand)
                        Picker("Body", selection: $profile.sex) {
                            Text("From my scan").tag(BodyProfile.Sex?.none)
                            ForEach(BodyProfile.Sex.allCases, id: \.self) { Text($0.label).tag(BodyProfile.Sex?.some($0)) }
                        }
                        .pickerStyle(.segmented)
                        if let sex = profile.sex, maker.madeAs != sex.rawValue, !maker.images.isEmpty {
                            Button(maker.state == .making ? "Remaking your mannequin…" : "Remake my mannequin as \(sex.label.lowercased())") {
                                Task { await maker.remake(sex: sex) }
                            }
                            .disabled(maker.state == .making)
                            .font(.system(size: 14, weight: .semibold))
                        }
                    }
                    .padding(.vertical, 4)
                    NavigationLink(value: Route.measurements) {
                        Label("Body measurements", systemImage: "ruler")
                    }
                    Button(action: onRescan) { Label("Redo body scan", systemImage: "camera") }
                } header: {
                    Text("You")
                } footer: {
                    Text("Your mannequin is always made with this body. A new scan replaces your current body: "
                        + "scan again if your measurements have changed or the last scan didn't come out well.")
                        .font(.caption).foregroundStyle(Theme.sand)
                }
            }
            Section("Your orders") {
                if orders.isEmpty {
                    Text("Nothing ordered yet. When a design is made for you, it shows here.")
                        .font(Theme.body(14)).foregroundStyle(Theme.sand)
                }
                ForEach(orders, id: \.order.number) { item in
                    NavigationLink(value: Route.order(item.garment.id)) { OrderRow(garment: item.garment, order: item.order) }
                }
            }
            Section {
                Button(role: .destructive) { confirmReset = true } label: {
                    Label("Reset the app", systemImage: "arrow.counterclockwise")
                }
            } footer: {
                Text("Start again from scratch, with a new body scan.").font(.caption).foregroundStyle(Theme.sand)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .listRowBackgroundCream()
        .background(Theme.cream.ignoresSafeArea())
        .navigationTitle("Profile")
        .confirmationDialog("Reset the app?", isPresented: $confirmReset, titleVisibility: .visible) {
            Button("Reset everything", role: .destructive, action: onReset)
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This deletes your scan, mannequin, measurements, designs and orders on this phone, and your MongoDB wardrobe the next time the phone is plugged into your Mac. You'll start again with a new body scan.")
        }
        .onAppear {
            scan = ScanStore.current
            if let scan { maker.load(scan) }
            orders = GarmentStore.all().compactMap { g in GarmentStore.order(g.id).map { (g, $0) } }
                .sorted { $0.order.placed > $1.order.placed }
        }
    }
}

/// One past purchase: the piece, who made it, the price, and where it is.
private struct OrderRow: View {
    let garment: SavedGarment
    let order: Order

    var body: some View {
        HStack(spacing: 14) {
            Color.clear.frame(width: 54, height: 72)
                .overlay { if let f = GarmentStore.front(garment.id) { Image(uiImage: f).resizable().scaledToFill() } else { MonogramPlaceholder() } }
                .clipped()
            VStack(alignment: .leading, spacing: 3) {
                Text(garment.name).font(.system(size: 15, weight: .semibold)).lineLimit(1)
                Text("By \(order.seamstressName) · \(CheckoutView.money(order.price))").font(Theme.body(13))
                Text(order.status).font(.caption).foregroundStyle(Theme.sand)
            }
        }
        .padding(.vertical, 4)
    }
}

extension Order {
    /// Where the order is, from its dates.
    var status: String {
        let ready = self.ready.formatted(date: .abbreviated, time: .omitted)
        return Date() >= self.ready ? "Delivered \(ready)" : "Being made · ready by \(ready)"
    }
}

/// One past order, in full.
struct OrderDetailView: View {
    let garmentID: String

    var body: some View {
        let g = GarmentStore.get(garmentID), o = GarmentStore.order(garmentID)
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Color.clear.aspectRatio(0.8, contentMode: .fit)
                    .overlay { if let f = GarmentStore.front(garmentID) { Image(uiImage: f).resizable().scaledToFill() } else { MonogramPlaceholder() } }
                    .clipped()
                if let g, let o {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Order \(o.number)").eyebrowStyle()
                        Text(g.name).titleStyle(28)
                        Text(o.status).font(Theme.body(15))
                    }
                    .padding(20)
                    VStack(spacing: 12) {
                        line("Made by", o.seamstressName)
                        line("Ordered", o.placed.formatted(date: .long, time: .omitted))
                        line("Ready by", o.ready.formatted(date: .long, time: .omitted))
                        line("Delivered to", "\(o.deliverTo.name)\n\(o.deliverTo.line1)\(o.deliverTo.line2.isEmpty ? "" : ", " + o.deliverTo.line2)\n\(o.deliverTo.city) \(o.deliverTo.postcode)")
                        line("Paid", "\(CheckoutView.money(o.price)) · card ending \(o.cardLast4)")
                    }
                    .padding(20)
                    .hairline(.top)
                }
            }
            .foregroundStyle(Theme.brown)
        }
        .background(Theme.cream.ignoresSafeArea())
        .navigationTitle("Order")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func line(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(.caption).foregroundStyle(Theme.sand)
            Spacer()
            Text(value).font(Theme.body(15)).multilineTextAlignment(.trailing)
        }
    }
}
