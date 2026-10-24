import PhotosUI
import SwiftUI

/// Designing starts here: a full-width carousel of reference photos ("Add" first, the
/// whole width while there are none), then the description filling the rest of the
/// screen, and Design it at the bottom. Every design is a new
/// design inspired by the photos and words; Design it goes to "Creating".
struct DesignView: View {
    @EnvironmentObject private var draft: DesignDraft
    let onDesign: (DesignInput) -> Void

    @State private var picks: [PhotosPickerItem] = []
    @State private var photos: [UIImage] = []
    @FocusState private var typing: Bool

    private let maxPhotos = (try? Engine.shared.call("maxReferences", [], as: Int.self)) ?? 5
    private let tileWidth: CGFloat = 220

    var body: some View {
        GeometryReader { geo in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text("What shall we make?").titleStyle(30)
                        .padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 22)

                    section("References", "Pieces you admire: a collar, a cut, a colour. Up to \(maxPhotos).")
                    carousel.padding(.bottom, 30)

                    section("Describe it")
                    // Fills the rest of the screen; scrolls instead once the keyboard takes the room.
                    ZStack(alignment: .topLeading) {
                        if draft.words.isEmpty {
                            Text("A relaxed navy chore coat in heavy cotton, with a stand collar, hidden buttons and deep patch pockets. Hip length.")
                                .foregroundStyle(Theme.sand)
                                .padding(.horizontal, 5).padding(.vertical, 8)
                                .allowsHitTesting(false)
                        }
                        TextEditor(text: $draft.words)
                            .focused($typing)
                            .scrollContentBackground(.hidden)
                    }
                    .font(Theme.body(16))
                    .lineSpacing(3)
                    .padding(11)
                    .frame(maxWidth: .infinity, minHeight: 140, maxHeight: .infinity, alignment: .topLeading)
                    .background(Theme.linen.opacity(0.6))
                    .overlay(Rectangle().stroke(typing ? Theme.brown : Theme.hairline, lineWidth: typing ? 0.75 : 0.5))
                    .contentShape(Rectangle())
                    .onTapGesture { typing = true }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 20)
                }
                .frame(minHeight: geo.size.height, alignment: .top)
                .foregroundStyle(Theme.brown)
            }
        }
        .scrollDismissesKeyboard(.immediately)
        .background(Theme.cream.ignoresSafeArea())
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            Button("Design it") { design() }
                .buttonStyle(TailoredButtonStyle())
                .disabled(isEmpty)
                .opacity(isEmpty ? 0.45 : 1)
                .padding(.horizontal, 16).padding(.vertical, 12)
                .background(Theme.cream)
                .hairline(.top)
        }
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { typing = false }
            }
        }
        .onChange(of: picks) { _, items in Task { await load(items) } }
    }

    private func section(_ title: String, _ hint: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).titleStyle(20)
            if let hint { Text(hint).subtitleStyle(14) }
        }
        .padding(.horizontal, 20).padding(.bottom, 12)
    }

    /// Always there, edge to edge: the add tile first, then the photos.
    private var carousel: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                PhotosPicker(selection: $picks, maxSelectionCount: maxPhotos, matching: .images) {
                    Rectangle()
                        .stroke(Theme.brown, style: StrokeStyle(lineWidth: 0.75, dash: [5]))
                        .background(Theme.linen.opacity(0.4))
                        .frame(width: photos.isEmpty ? nil : tileWidth * 0.55, height: tileWidth * 4 / 3)
                        // Nothing added yet: the add tile takes the whole width.
                        .containerRelativeFrame(.horizontal) { w, _ in photos.isEmpty ? w - 40 : tileWidth * 0.55 }
                        .overlay(VStack(spacing: 10) {
                            Image(systemName: "plus").font(.system(size: 26, weight: .ultraLight))
                            Text(photos.isEmpty ? "Add photos" : "Add more").font(.system(size: 14, weight: .medium))
                            Text("\(photos.count) of \(maxPhotos)").font(.caption).foregroundStyle(Theme.sand)
                        })
                }
                .disabled(photos.count >= maxPhotos)
                ForEach(photos.indices, id: \.self) { i in
                    Color.clear
                        .frame(width: tileWidth, height: tileWidth * 4 / 3)
                        .overlay(Image(uiImage: photos[i]).resizable().scaledToFill())
                        .clipped()
                        .overlay(alignment: .topTrailing) {
                            Button { remove(i) } label: {
                                Image(systemName: "xmark").font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(Theme.cream)
                                    .frame(width: 28, height: 28)
                                    .background(Theme.ink.opacity(0.7))
                            }
                            .padding(8)
                        }
                }
            }
            .padding(.horizontal, 20)
            .animation(.easeInOut(duration: 0.3), value: photos.count)
        }
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
        // A new design grown from the photos and words; with several photos, the best of each.
        onDesign(DesignInput(images: photos.compactMap { $0.dataURL() }, description: text.isEmpty ? nil : text,
                             mode: photos.count > 1 ? "mix" : "invent", current: nil))
    }
}
