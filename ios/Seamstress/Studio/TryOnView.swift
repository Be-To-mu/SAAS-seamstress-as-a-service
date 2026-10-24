import PhotosUI
import SwiftUI

/// The fitting room: you, wearing the design. The photo is the front frame from
/// your body scan (or one you pick); Gemini's image model dresses you in the
/// garment, as in Google's Virtual Fitting Room.
struct TryOnView: View {
    @EnvironmentObject private var draft: DesignDraft
    let onEdit: () -> Void
    let onPattern: () -> Void
    let onSave: () -> Void

    @AppStorage("tryOnConsent") private var consent = false
    @State private var person: UIImage?
    @State private var pick: PhotosPickerItem?
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                Theme.linen
                if let tryOn = draft.tryOn {
                    Image(uiImage: tryOn).resizable().scaledToFit()
                } else if busy {
                    VStack(spacing: 14) {
                        Monogram(size: 54, color: Theme.brown)
                        ProgressView().tint(Theme.brown)
                        Text("Dressing you in your \(draft.name.lowercased())…").font(Theme.body(15))
                    }
                } else if !consent {
                    consentCard
                } else if person == nil {
                    noPhotoCard
                } else if let error {
                    VStack(spacing: 12) {
                        Text(error).font(.callout).multilineTextAlignment(.center)
                        Button("Try again") { Task { await dress() } }.buttonStyle(TailoredButtonStyle(filled: false))
                    }
                    .padding(24)
                }
            }
            .frame(maxHeight: .infinity)
        }
        .foregroundStyle(Theme.brown)
        .background(Theme.cream.ignoresSafeArea())
        .navigationTitle("Fitting room")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { Button("Edit", action: onEdit) }
        }
        .safeAreaInset(edge: .bottom) {
            HStack(spacing: 12) {
                Button { draft.tryOn = nil; Task { await dress() } } label: { Text("Try again") }
                    .buttonStyle(TailoredButtonStyle(filled: false))
                    .disabled(busy || person == nil || !consent)
                Button("Save to wardrobe", action: onSave).buttonStyle(TailoredButtonStyle())
            }
            .padding()
            .background(Theme.cream.opacity(0.95))
        }
        .overlay(alignment: .bottomTrailing) {
            if draft.tryOn != nil {
                Button("Pattern", action: onPattern).font(.system(size: 14, weight: .semibold)).underline()
                    .padding(.trailing, 20).padding(.bottom, 92)
            }
        }
        .task {
            person = person ?? ScanStore.frontPhoto()
            if consent, draft.tryOn == nil, person != nil { await dress() }
        }
        .onChange(of: pick) { _, item in
            Task {
                if let data = try? await item?.loadTransferable(type: Data.self), let img = UIImage(data: data) {
                    person = img
                    draft.tryOn = nil
                    await dress()
                }
            }
        }
    }

    private var consentCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("See it on you").titleStyle(22)
            Text("To show the garment on you, the front photo from your body scan is sent to Google Gemini, which makes a picture of you wearing it.")
                .font(Theme.body(15))
            Button("Continue") {
                consent = true
                Task { await dress() }
            }
            .buttonStyle(TailoredButtonStyle())
            PhotosPicker(selection: $pick, matching: .images) { Text("Use another photo instead").underline() }
                .font(.system(size: 14))
                .simultaneousGesture(TapGesture().onEnded { consent = true })
        }
        .padding(24)
    }

    private var noPhotoCard: some View {
        VStack(spacing: 14) {
            Text("No scan photo found").titleStyle(20)
            Text("Pick a full-length photo of yourself, facing the camera.").font(Theme.body(15))
            PhotosPicker(selection: $pick, matching: .images) { Text("Choose a photo") }
                .buttonStyle(TailoredButtonStyle())
        }
        .padding(24)
    }

    private func dress() async {
        guard let person, let front = draft.front,
              let personURL = person.dataURL(), let garmentURL = front.dataURL() else { return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            draft.tryOn = try await Gemini.tryOn(TryOnInput(spec: draft.spec, person: personURL, garment: garmentURL))
        } catch {
            self.error = error.localizedDescription
        }
    }
}

extension ScanStore {
    /// The first colour frame of the current scan (taken facing the phone), upright.
    /// The camera records in its native landscape orientation; the phone stood upright.
    static func frontPhoto() -> UIImage? {
        guard let scan = current,
              let raw = UIImage(contentsOfFile: scan.appending(path: "rgb/0000.jpg").path),
              let cg = raw.cgImage else { return nil }
        let upright = UIImage(cgImage: cg, scale: 1, orientation: .right)
        let size = CGSize(width: upright.size.width, height: upright.size.height)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in upright.draw(in: CGRect(origin: .zero, size: size)) }
    }
}
