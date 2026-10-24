import SwiftUI

/// Your measurements, filled in from the scan. Change any number; it is marked
/// as edited and can be reset to the scanned value.
struct MeasurementsView: View {
    @EnvironmentObject private var profile: BodyProfile
    let onNext: () -> Void

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Your measurements").titleStyle(22)
                    Text("Filled in from your scan. Tap a number to change it.").font(Theme.body(14)).opacity(0.8)
                }
                .foregroundStyle(Theme.brown)
                .listRowBackground(Color.clear)
            }
            ForEach(MeasureCatalog.groups, id: \.self) { group in
                Section(group) {
                    ForEach(MeasureCatalog.all.filter { $0.group == group }) { m in
                        MeasureRow(def: m)
                    }
                }
            }
            if !profile.problems.isEmpty {
                Section {
                    Label("Check \(profile.problems.map(\.label).joined(separator: ", ")) before designing.",
                          systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.orange)
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .listRowBackgroundCream()
        .background(Theme.cream.ignoresSafeArea())
        .navigationTitle("Measurements")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            Button(action: onNext) { Text("Design a garment") }
                .buttonStyle(TailoredButtonStyle())
                .padding()
                .background(Theme.cream.opacity(0.95))
        }
    }
}

private struct MeasureRow: View {
    @EnvironmentObject private var profile: BodyProfile
    let def: MeasureDef
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(def.label).font(Theme.body(16))
                Text(def.hint).font(.caption).foregroundStyle(.secondary)
                if profile.isEdited(def.id) {
                    Button("Edited · reset to scan") { profile.reset(def.id); text = shown }
                        .font(.caption.weight(.semibold)).foregroundStyle(Theme.brown)
                        .buttonStyle(.plain)
                } else if profile.value(def.id) != nil {
                    Text("from scan").font(.caption).foregroundStyle(Theme.sand)
                }
            }
            Spacer()
            if outOfRange {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                    .accessibilityLabel("Outside the usual range \(Int(def.range.lowerBound))–\(Int(def.range.upperBound)) cm")
            }
            TextField("–", text: $text)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .monospacedDigit()
                .frame(width: 70)
                .focused($focused)
                .onSubmit(commit)
                .onChange(of: focused) { _, isFocused in if !isFocused { commit() } }
            Text("cm").foregroundStyle(.secondary)
        }
        .onAppear { text = shown }
        .toolbar {
            if focused {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") { focused = false }
                }
            }
        }
    }

    private var shown: String { profile.value(def.id).map { String(format: "%.1f", $0) } ?? "" }

    private var outOfRange: Bool {
        guard let v = profile.value(def.id) else { return def.webKey.map(MeasureCatalog.requiredWebKeys.contains) ?? false }
        return !def.range.contains(v)
    }

    private func commit() {
        let cleaned = text.replacingOccurrences(of: ",", with: ".")
        if let v = Double(cleaned) {
            profile.set(def.id, (v * 10).rounded() / 10)
        } else if cleaned.isEmpty {
            profile.reset(def.id)
        }
        text = shown
    }
}
