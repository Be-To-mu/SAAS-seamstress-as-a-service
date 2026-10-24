import PhotosUI
import SwiftUI

/// Designing starts here: the reference photos fill the page, and a small bar at
/// the bottom takes the description. "Design it" asks Gemini, then shows the garment.
struct DesignView: View {
    @EnvironmentObject private var draft: DesignDraft
    let onDesigned: () -> Void

    @State private var picks: [PhotosPickerItem] = []
    @State private var photos: [UIImage] = []
    @State private var mode = "mix"
    @State private var busy = false
    @State private var error: String?
    @FocusState private var typing: Bool

    private let modes: [DesignMode] = (try? Engine.shared.call("designModes", [], as: [DesignMode].self)) ?? []
    private let maxPhotos = (try? Engine.shared.call("maxReferences", [], as: Int.self)) ?? 5

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Design a garment").titleStyle(24)
                    Text("add photos of pieces you like").subtitleStyle()
                }
                references
                if photos.count > 1 {
                    Picker("Photos", selection: $mode) {
                        ForEach(modes) { Text($0.label).tag($0.id) }
                    }
                    .pickerStyle(.segmented)
                    Text(modes.first { $0.id == mode }?.hint ?? "").font(.caption).foregroundStyle(.secondary)
                }
                if let error { Text(error).font(.callout).foregroundStyle(.red) }
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

    /// The small input bar: description + Design it.
    private var describeBar: some View {
        HStack(alignment: .bottom, spacing: 10) {
            TextField("Describe it (optional)", text: $draft.words, axis: .vertical)
                .lineLimit(1...4)
                .focused($typing)
                .submitLabel(.done)
                .onSubmit { typing = false }
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(Theme.linen.opacity(0.45), in: Rectangle())
            Button { Task { await design() } } label: {
                Group {
                    if busy { ProgressView().tint(Theme.cream) } else { Text("Design it").font(Theme.display(12)).tracking(1.5).textCase(.uppercase) }
                }
                .frame(height: 22)
                .padding(.horizontal, 16).padding(.vertical, 10)
                .foregroundStyle(Theme.cream)
                .background(Theme.brown, in: Rectangle())
            }
            .disabled(busy || (photos.isEmpty && draft.words.trimmingCharacters(in: .whitespaces).isEmpty))
            .opacity(photos.isEmpty && draft.words.trimmingCharacters(in: .whitespaces).isEmpty ? 0.5 : 1)
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(.bar)
    }

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
        if out.count <= 1 { mode = "match" } else if mode == "match" { mode = "mix" }
    }

    private func design() async {
        typing = false
        busy = true
        error = nil
        defer { busy = false }
        let images = photos.compactMap(Self.dataURL)
        let text = draft.words.trimmingCharacters(in: .whitespacesAndNewlines)
        let input = DesignInput(images: images, description: text.isEmpty ? nil : text,
                                mode: images.isEmpty ? nil : (images.count == 1 ? "match" : mode), current: nil)
        do {
            draft.adopt(try await Gemini.design(input))
            draft.features = []
            draft.references = images
            onDesigned()
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// A JPEG data URL, at most 1024 px, as the web studio sends.
    static func dataURL(_ image: UIImage) -> String? {
        let side: CGFloat = 1024
        let scale = min(1, side / max(image.size.width, image.size.height))
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let small = UIGraphicsImageRenderer(size: size).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        guard let jpeg = small.jpegData(compressionQuality: 0.8) else { return nil }
        return "data:image/jpeg;base64,\(jpeg.base64EncodedString())"
    }
}
