import SwiftUI

@main
struct SeamstressApp: App {
    var body: some Scene {
        WindowGroup {
            RootView().tint(Theme.brown)
        }
    }
}

/// Landing: the camera on first launch (scan your body), afterwards the wardrobe.
/// After a scan: body → measurements → design → creating → turn it around →
/// try it on → (edit → pattern). A new body scan starts from the profile button.
struct RootView: View {
    @StateObject private var profile = BodyProfile()
    @StateObject private var draft = DesignDraft()
    @State private var hasBody = !ScanStore.all().isEmpty
    @State private var scanning = false
    @State private var path = NavigationPath()
    /// The design request waiting for the Creating page (nil = redraw the current design).
    @State private var pending: DesignInput?

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
                    WardrobeView(onOpen: open, onTryOn: { g in open(g); path.append(Route.tryOn) },
                                 onNew: { path.append(Route.design) })
                        .navigationDestination(for: Route.self, destination: destination)
                }
            }
        }
        .environmentObject(profile)
        .environmentObject(draft)
        .onAppear(perform: openDebugRoute)
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
            DesignView { input in
                pending = input
                path.append(Route.creating)
            }
        case .creating:
            CreatingView(input: pending) {
                pending = nil
                // Replace "creating" with the result, so Back returns to the design page.
                path.removeLast()
                path.append(Route.spin)
            }
        case .spin:
            SpinView(onEdit: { path.append(Route.style) },
                     onTryOn: { path.append(Route.tryOn) },
                     onRedraw: { pending = nil; path.append(Route.creating) })
        case .tryOn:
            TryOnView(onEdit: { path.append(Route.style) },
                      onPattern: { path.append(Route.pattern) },
                      onSave: save)
        case .style:
            StyleView { path.append(Route.pattern) }
        case .pattern:
            PatternView { path = NavigationPath() }  // saved: back to the wardrobe
        }
    }

    private func open(_ g: SavedGarment) {
        draft.load(g)
        path.append(Route.spin)
    }

    private func save() {
        if (try? GarmentStore.save(draft, measurements: profile.webMeasurements)) != nil {
            path = NavigationPath()
        }
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
        case "tryon": .tryOn
        case "style": .style
        case "pattern": .pattern
        case "profile": .profile
        default: nil
        }
        if let route { path = NavigationPath([route]) }
        #endif
    }
}

enum Route: Hashable {
    case profile, body(URL), measurements, design, creating, spin, tryOn, style, pattern
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
