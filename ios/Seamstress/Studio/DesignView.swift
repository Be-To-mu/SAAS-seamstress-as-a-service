import PhotosUI
import SwiftUI

/// Designing starts here: the reference photos fill the page, with a full-width
/// description field and Design it button underneath. Every design is a new
/// design inspired by the photos and words; Design it goes to "Creating".
struct DesignView: View {
    @EnvironmentObject private var draft: DesignDraft
    let onDesign: (DesignInput) -> Void

    @State private var picks: [PhotosPickerItem] = []
    @State private var photos: [UIImage] = []
    @FocusState private var typing: Bool

    private let maxPhotos = (try? Engine.shared.call("maxReferences", [], as: Int.self)) ?? 5

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Design a garment").titleStyle(24)
                    Text("add photos of pieces you like").subtitleStyle()
                }
                references
            }
            .foregroundStyle(Theme.brown)
            .padding(20)
        }
        .scrollDismissesKeyboard(.immediately)
        .contentShape(Rectangle())
        .onTapGesture { typing = false }
        .background(Theme.cream.ignoresSafeArea())
        .navigationTitle("Design")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) { describeBar }
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { typing = false }
            }
        }
        .onChange(of: picks) { _, items in Task { await load(items) } }
    }

    /// Full-page grid of reference photos, with an add tile.
    private var references: some View {
        let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]
        return LazyVGrid(columns: columns, spacing: 12) {
            ForEach(photos.indices, id: \.self) { i in
                Image(uiImage: photos[i]).resizable().scaledToFill()
                    .frame(minWidth: 0, maxWidth: .infinity)
                    .aspectRatio(0.75, contentMode: .fit)
                    .clipShape(Rectangle())
                    .overlay(alignment: .topTrailing) {
                        Button { remove(i) } label: {
                            Image(systemName: "xmark.circle.fill").font(.title3)
                                .symbolRenderingMode(.palette).foregroundStyle(Theme.cream, Theme.brown.opacity(0.8))
                        }
                        .padding(8)
                    }
            }
            if photos.count < maxPhotos {
                PhotosPicker(selection: $picks, maxSelectionCount: maxPhotos, matching: .images) {
                    Rectangle()
                        .stroke(Theme.brown, style: StrokeStyle(lineWidth: 1, dash: [5]))
                        .aspectRatio(0.75, contentMode: .fit)
                        .overlay(VStack(spacing: 10) {
                            Image(systemName: "photo.badge.plus").font(.system(size: 30, weight: .light))
                            Text(photos.isEmpty ? "Add reference photos" : "Add more").titleStyle(11)
                            Text("up to \(maxPhotos)").font(.caption)
                        })
                }
            }
        }
    }

    /// The describe field, full width, with Design it underneath.
    private var describeBar: some View {
        VStack(spacing: 10) {
            TextField("Describe it (optional)", text: $draft.words, axis: .vertical)
                .lineLimit(1...4)
                .focused($typing)
                .submitLabel(.done)
                .onSubmit { typing = false }
                .padding(.horizontal, 14).padding(.vertical, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.linen.opacity(0.7))
                .overlay(Rectangle().stroke(Theme.hairline, lineWidth: 0.5))
            Button("Design it") { design() }
                .buttonStyle(TailoredButtonStyle())
                .disabled(isEmpty)
                .opacity(isEmpty ? 0.45 : 1)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(Theme.cream)
        .hairline(.top)
    }

    private var isEmpty: Bool { photos.isEmpty && draft.words.trimmingCharacters(in: .whitespaces).isEmpty }

    private func remove(_ i: Int) {
        photos.remove(at: i)
        if i < picks.count { picks.remove(at: i) }
    }

    private func load(_ items: [PhotosPickerItem]) async {
        var out: [UIImage] = []
        for item in items.prefix(maxPhotos) {
            if let data = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: data) { out.append(img) }
        }
        photos = out
    }

    private func design() {
        typing = false
        let text = draft.words.trimmingCharacters(in: .whitespacesAndNewlines)
        draft.reset()
        // Always a new design, using the photos and words as inspiration.
        onDesign(DesignInput(images: photos.compactMap { $0.dataURL() }, description: text.isEmpty ? nil : text,
                             mode: "invent", current: nil))
    }
}
