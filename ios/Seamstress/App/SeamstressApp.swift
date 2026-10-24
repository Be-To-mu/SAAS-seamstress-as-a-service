import SwiftUI

@main
struct SeamstressApp: App {
    var body: some Scene {
        WindowGroup {
            NavigationStack { HomeView() }
        }
    }
}

struct HomeView: View {
    @AppStorage("ageYears") private var ageYears: Double = 0
    @State private var scans: [URL] = []
    @State private var scanning = false
    @State private var openScan: URL?

    var body: some View {
        List {
            Section {
                LabeledContent("Your age") {
                    TextField("years", value: $ageYears, format: .number)
                        .keyboardType(.numberPad)
                        .multilineTextAlignment(.trailing)
                }
                Button {
                    scanning = true
                } label: {
                    Label("New body scan", systemImage: "figure.stand")
                }
                .disabled(ageYears < 16 || ageYears > 100)
            } footer: {
                Text("Age helps the body model get your proportions right. Wear tight clothing, tie long hair up, "
                    + "and scan in an open space at least a metre from walls.")
            }

            if !scans.isEmpty {
                Section("Scans") {
                    ForEach(scans, id: \.self) { scan in
                        NavigationLink(value: scan) {
                            VStack(alignment: .leading) {
                                Text(scan.lastPathComponent)
                                Text(ScanStore.remoteID(of: scan) == nil ? "Not sent yet" : "Sent")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Seamstress")
        .navigationDestination(for: URL.self) { ResultView(scan: $0) }
        .navigationDestination(item: $openScan) { ResultView(scan: $0) }
        .fullScreenCover(isPresented: $scanning) {
            ScanView(ageYears: ageYears) { finished in
                scanning = false
                scans = ScanStore.all()
                openScan = finished
            }
        }
        .onAppear { scans = ScanStore.all() }
    }
}
