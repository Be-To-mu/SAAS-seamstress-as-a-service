import SwiftUI

/// Your measurements (Advanced: the app works without ever opening this), filled in from
/// the scan, by category: Body, Top, Arms, Bottom. Change any number; it is marked as
/// edited and can be reset to the scanned value.
struct MeasurementsView: View {
    @EnvironmentObject private var profile: BodyProfile
    let onNext: () -> Void
    @State private var group = MeasureCatalog.groups[0]

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Advanced").eyebrowStyle()
                    Text("Your measurements").titleStyle(30)
                    Text("Filled in from your scan. Tap a number to change it.").font(Theme.body(14)).opacity(0.8)
                    Picker("Category", selection: $group) {
                        ForEach(MeasureCatalog.groups, id: \.self) { Text($0) }
                    }
                    .pickerStyle(.segmented)
                    .padding(.top, 10)
                }
                .foregroundStyle(Theme.brown)
                .listRowBackground(Color.clear)
            }
            Section {
                HowToMeasure()
            }
            Section {
                ForEach(MeasureCatalog.all.filter { $0.group == group }) { m in
                    MeasureRow(def: m)
                }
            } footer: {
                Text("Tap ⓘ to see how to take a measurement, and how to check it.").font(.caption)
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
    @State private var help = false
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            row
            if help, let h = MeasureCatalog.howTo[def.id] {
                VStack(alignment: .leading, spacing: 8) {
                    Label { Text(h.measure) } icon: { Image(systemName: "ruler") }
                    Label { Text(h.check) } icon: { Image(systemName: "checkmark.circle") }
                }
                .font(Theme.body(13)).lineSpacing(2)
                .foregroundStyle(Theme.brown)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.linen.opacity(0.7))
                .transition(.opacity)
            }
        }
    }

    private var row: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(def.label).font(Theme.body(16))
                    if MeasureCatalog.howTo[def.id] != nil {
                        Button { withAnimation(.easeInOut(duration: 0.2)) { help.toggle() } } label: {
                            Image(systemName: help ? "info.circle.fill" : "info.circle").font(.system(size: 14, weight: .light))
                        }
                        .buttonStyle(.borderless)
                        .accessibilityLabel("How to measure \(def.label)")
                    }
                }
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

/// How to measure yourself, before the numbers: once, short.
private struct HowToMeasure: View {
    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button { withAnimation(.easeInOut(duration: 0.2)) { open.toggle() } } label: {
                HStack {
                    Label("How to measure yourself", systemImage: "ruler")
                        .font(.system(size: 15, weight: .semibold))
                    Spacer()
                    Image(systemName: open ? "chevron.up" : "chevron.down").font(.system(size: 12, weight: .light))
                }
            }
            .buttonStyle(.plain)
            if open {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach([
                        "Use a soft tailor's tape, not a metal one.",
                        "Wear thin, close-fitting clothes or underwear; take off belts and shoes.",
                        "Stand straight and relaxed, feet together, breathing normally.",
                        "Keep the tape level and snug, never tight: one finger should slip under it.",
                        "Ask someone to help with the back and the shoulders.",
                        "Measure twice. If the two differ by more than 1 cm, measure a third time.",
                        "To check a number, measure a garment that fits you well, laid flat, and compare.",
                    ], id: \.self) { tip in
                        HStack(alignment: .top, spacing: 8) {
                            Text("·")
                            Text(tip).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                .font(Theme.body(14)).lineSpacing(2)
                .transition(.opacity)
            }
        }
        .foregroundStyle(Theme.brown)
    }
}
