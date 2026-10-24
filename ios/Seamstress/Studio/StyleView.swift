import SwiftUI

/// The Style page: the style form on its own, with See the pattern below.
struct StyleView: View {
    let onPattern: () -> Void

    var body: some View {
        List { StyleForm() }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .listRowBackgroundCream()
            .background(Theme.cream.ignoresSafeArea())
            .navigationTitle("Style")
            .navigationBarTitleDisplayMode(.inline)
            .safeAreaInset(edge: .bottom) {
                Button("See the pattern", action: onPattern)
                    .buttonStyle(TailoredButtonStyle())
                    .padding()
                    .background(Theme.cream.opacity(0.95))
            }
    }
}

/// Adjust the design by hand (the family's own form fields), change it with words, and
/// add ready-made features. The pattern updates as you go. List sections, so it can sit
/// in the Style page or the Advanced settings sheet.
struct StyleForm: View {
    @EnvironmentObject private var draft: DesignDraft
    @EnvironmentObject private var profile: BodyProfile

    @State private var change = ""
    @State private var busy = false
    @State private var error: String?

    private var family: Family? { Engine.families.first { $0.id == draft.family } }

    var body: some View {
        Group {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 12) {
                        Circle().fill(draft.color).frame(width: 34, height: 34)
                            .overlay(Circle().stroke(Theme.brown.opacity(0.3)))
                        VStack(alignment: .leading) {
                            Text(draft.name).titleStyle(18)
                            Text(family?.label ?? "").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    if let c = composed { Text(c.description).font(Theme.body(14)) }
                    if !draft.notes.isEmpty { Text(draft.notes).font(.caption).foregroundStyle(.secondary) }
                }
                .foregroundStyle(Theme.brown)
            }

            Section("Change it with words") {
                HStack {
                    TextField("e.g. make it cropped, with a zip", text: $change)
                    Button { Task { await refine() } } label: {
                        if busy { ProgressView() } else { Image(systemName: "arrow.up.circle.fill").font(.title2) }
                    }
                    .disabled(busy || change.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                if let error { Text(error).font(.caption).foregroundStyle(.red) }
            }

            Section("Details") {
                ForEach(family?.fields ?? [], id: \.key) { field in FieldRow(field: field) }
            }

            Section("Add") {
                let added = Set(draft.features.map(\.request))
                ForEach(recipes) { r in
                    Button {
                        draft.features.append(Feature(id: "recipe-\(r.id)-\(UUID().uuidString.prefix(6))",
                                                      request: r.title, ops: r.ops, source: "template"))
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Label(r.title, systemImage: "plus.circle")
                            Text(r.explanation).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .disabled(added.contains(r.title))
                }
                ForEach(draft.features) { f in
                    HStack {
                        Label(f.request, systemImage: "checkmark.circle.fill").foregroundStyle(Theme.brown)
                        Spacer()
                        Button(role: .destructive) { draft.features.removeAll { $0.id == f.id } } label: {
                            Image(systemName: "minus.circle")
                        }
                        .buttonStyle(.borderless)
                    }
                }
            }
        }
    }

    private var composed: Composed? {
        try? Engine.shared.call("compose", [draft.spec, profile.webMeasurements, draft.features, draft.fit])
    }

    private var recipes: [Recipe] {
        (try? Engine.shared.call("recipes", [draft.spec, profile.webMeasurements, draft.features, draft.fit], as: [Recipe].self)) ?? []
    }

    private func refine() async {
        busy = true
        error = nil
        defer { busy = false }
        let input = DesignInput(images: [], description: change, mode: nil, current: draft.spec)
        do {
            draft.adopt(try await Gemini.design(input))
            change = ""
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// One form field, as the family defines it (select, count, number or colour).
private struct FieldRow: View {
    @EnvironmentObject private var draft: DesignDraft
    let field: FieldDef

    var body: some View {
        switch field.kind {
        case "select":
            Picker(field.label, selection: selectBinding) {
                ForEach(field.options ?? [], id: \.self) { Text(label($0)).tag($0) }
            }
            .pickerStyle(.menu)
        case "count":
            Stepper("\(field.label): \(Int(number))", value: numberBinding,
                    in: (field.min ?? 0)...(field.max ?? 10), step: 1)
        case "number":
            VStack(alignment: .leading) {
                Text("\(field.label): \(String(format: "%.2f", number))")
                Slider(value: numberBinding, in: (field.min ?? 0)...(field.max ?? 1), step: field.step ?? 0.05)
                    .tint(Theme.brown)
            }
        case "color":
            ColorPicker(field.label, selection: colorBinding, supportsOpacity: false)
        default:
            EmptyView()
        }
    }

    private func label(_ option: String) -> String {
        option.replacingOccurrences(of: "-", with: " ").capitalized
    }

    private var number: Double { draft.spec[field.key]?.number ?? field.min ?? 0 }

    private var numberBinding: Binding<Double> {
        Binding { number } set: { draft.spec[field.key] = .number($0) }
    }

    /// Selects hold strings, booleans ("true"/"false") or small numbers ("0"/"1"/"2"), like the web form.
    private var selectBinding: Binding<String> {
        Binding {
            draft.spec[field.key]?.display == "yes" ? "true" : draft.spec[field.key]?.display == "no" ? "false"
                : draft.spec[field.key]?.display ?? ""
        } set: { raw in
            let options = field.options ?? []
            if options.contains("true") && options.contains("false") {
                draft.spec[field.key] = .bool(raw == "true")
            } else if options.allSatisfy({ Int($0) != nil }), let n = Double(raw) {
                draft.spec[field.key] = .number(n)
            } else {
                draft.spec[field.key] = .string(raw)
            }
        }
    }

    private var colorBinding: Binding<Color> {
        Binding { Color(hex: draft.spec[field.key]?.string ?? "#a9794a") } set: { draft.spec[field.key] = .string($0.hex) }
    }
}
