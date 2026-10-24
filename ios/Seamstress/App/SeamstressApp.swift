import SwiftUI

@main
struct SeamstressApp: App {
    var body: some Scene {
        WindowGroup {
            RootView().tint(Theme.brown)
        }
    }
}

/// Landing: the camera on first launch (scan your body), afterwards the gallery
/// of garments. After a scan: body → measurements → design → style → pattern.
/// A new body scan starts from the profile button.
struct RootView: View {
    @StateObject private var profile = BodyProfile()
    @StateObject private var draft = DesignDraft()
    @State private var hasBody = !ScanStore.all().isEmpty
    @State private var scanning = false
    @State private var path = NavigationPath()

    var body: some View {
        Group {
            if !hasBody || scanning {
                ScanView(canCancel: hasBody) { finished in
                    scanning = false
                    if let finished {
                        ScanStore.keepOnly(finished)  // one body at a time
                        hasBody = true
                        path = NavigationPath([Route.body(finished)])
                    }
                }
            } else {
                NavigationStack(path: $path) {
                    GalleryView(onOpen: open, onNew: { path.append(Route.design) })
                        .navigationDestination(for: Route.self, destination: destination)
                }
            }
        }
        .environmentObject(profile)
        .environmentObject(draft)
        .onAppear(perform: openDebugRoute)
    }

    /// Debug builds: `-route measurements|design|style|pattern|body|profile` opens that screen,
    /// for screenshots in the simulator.
    private func openDebugRoute() {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-route"), i + 1 < args.count, let scan = ScanStore.current else { return }
        if let g = GarmentStore.all().first { draft.load(g) } else { draft.start(family: "coat") }
        if let m = ScanStore.measurements(of: scan) { profile.adopt(scan: scan, measurements: m) }
        let route: Route? = switch args[i + 1] {
        case "body": .body(scan)
        case "measurements": .measurements
        case "design": .design
        case "reveal": .reveal
        case "style": .style
        case "pattern": .pattern
        case "profile": .profile
        default: nil
        }
        if let route { path = NavigationPath([route]) }
        #endif
    }

    @ViewBuilder private func destination(_ route: Route) -> some View {
        switch route {
        case .profile:
            ProfileView { scanning = true }
        case .body(let scan):
            ResultView(scan: scan) { path.append(Route.measurements) }
        case .measurements:
            MeasurementsView { path.append(Route.design) }
        case .design:
            DesignView { path.append(Route.reveal) }
        case .reveal:
            RevealView { path.append(Route.style) }
        case .style:
            StyleView { path.append(Route.pattern) }
        case .pattern:
            PatternView { path = NavigationPath() }  // saved: back to the gallery
        }
    }

    private func open(_ g: SavedGarment) {
        draft.load(g)
        path.append(Route.reveal)
    }
}

enum Route: Hashable {
    case profile, body(URL), measurements, design, reveal, style, pattern
}

/// The garments made for this body, laid out like a shop category page: a serif
/// title and short intro, a filter row, then one full-width product tile per garment.
struct GalleryView: View {
    let onOpen: (SavedGarment) -> Void
    let onNew: () -> Void
    @State private var garments: [SavedGarment] = []
    @State private var filter: String?

    private var shown: [SavedGarment] { garments.filter { filter == nil || $0.family == filter } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Your garments").titleStyle(30)
                    Text("Pieces designed on your body and cut to your measurements. Choose one to restyle it or print its pattern.")
                        .font(Theme.body(15)).foregroundStyle(Theme.brown)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 24)

                filterRow

                if shown.isEmpty {
                    VStack(alignment: .leading, spacing: 16) {
                        Rectangle().fill(Theme.linen).aspectRatio(1, contentMode: .fit)
                            .overlay(Image(systemName: "scissors").font(.system(size: 40, weight: .ultraLight)).foregroundStyle(Theme.sand))
                        Text("Nothing here yet").font(.system(size: 15, weight: .semibold))
                        Text("Add photos of garments you like and describe what you want. We'll make the pattern to your measurements.")
                            .font(Theme.body(14)).foregroundStyle(Theme.sand)
                        Button("Design a garment", action: onNew).buttonStyle(TailoredButtonStyle())
                    }
                    .padding(20)
                } else {
                    ForEach(shown) { g in
                        GarmentTile(garment: g) { onOpen(g) }
                    }
                    Button("Design a new garment", action: onNew)
                        .buttonStyle(TailoredButtonStyle(filled: false))
                        .padding(20)
                }
            }
            .foregroundStyle(Theme.brown)
        }
        .background(Theme.cream.ignoresSafeArea())
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text("Seamstress").font(.system(size: 20, weight: .regular, design: .serif)).tracking(0.5)
            }
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink(value: Route.profile) { Image(systemName: "person").font(.system(size: 17, weight: .light)) }
            }
        }
        .toolbarBackground(Theme.cream, for: .navigationBar)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { garments = GarmentStore.all() }
    }

    /// Filter by kind of garment, as text links between hairlines.
    private var filterRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 20) {
                filterLink("All", nil)
                ForEach(Engine.families) { filterLink($0.label, $0.id) }
            }
            .padding(.horizontal, 20).padding(.vertical, 14)
        }
        .hairline(.top).hairline(.bottom)
    }

    private func filterLink(_ title: String, _ id: String?) -> some View {
        Button(title) { filter = id }
            .font(.system(size: 14, weight: filter == id ? .semibold : .regular))
            .underline(filter == id)
            .foregroundStyle(filter == id ? Theme.brown : Theme.sand)
    }
}

/// One garment as a product tile: picture on a taupe ground, name, a short
/// description, what it's cut to, and a full-width square button.
private struct GarmentTile: View {
    let garment: SavedGarment
    let onOpen: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button(action: onOpen) {
                Rectangle().fill(Theme.linen)
                    .aspectRatio(1, contentMode: .fit)
                    .overlay {
                        if let picture = GarmentStore.picture(garment.id) {
                            Image(uiImage: picture).resizable().scaledToFit().padding(24)
                        } else {
                            Rectangle().fill(garment.color).frame(width: 120, height: 160)
                        }
                    }
                    .clipped()
            }
            .buttonStyle(.plain)
            Text(garment.name).font(.system(size: 15, weight: .semibold))
            Text(description).font(Theme.body(14)).foregroundStyle(Theme.brown).lineLimit(3)
            HStack {
                Text(Engine.familyLabel(garment.family))
                Spacer()
                Text("Made to measure")
            }
            .font(.system(size: 13)).foregroundStyle(Theme.sand)
            Button("View pattern", action: onOpen).buttonStyle(TailoredButtonStyle())
        }
        .padding(.horizontal, 20).padding(.vertical, 24)
        .hairline(.bottom)
    }

    private var description: String {
        (try? Engine.shared.call("compose", [garment.spec, garment.measurements, garment.features], as: Composed.self))?
            .description.capitalizedFirst ?? ""
    }
}

extension String {
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}

/// Your body, your measurements, and redoing the scan. The phone keeps one body at a time.
struct ProfileView: View {
    let onRescan: () -> Void
    @State private var scan: URL?

    var body: some View {
        List {
            if let scan {
                Section {
                    NavigationLink(value: Route.body(scan)) {
                        Label("Your body", systemImage: "figure.stand")
                    }
                    NavigationLink(value: Route.measurements) {
                        Label("Your measurements", systemImage: "ruler")
                    }
                }
            }
            Section {
                Button(action: onRescan) { Label("Redo body scan", systemImage: "camera") }
            } footer: {
                Text("A new scan replaces your current body. Scan again if your measurements have changed "
                    + "or the last scan didn't come out well.")
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .listRowBackgroundCream()
        .background(Theme.cream.ignoresSafeArea())
        .navigationTitle("Profile")
        .onAppear { scan = ScanStore.current }
    }
}
