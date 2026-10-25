import SwiftUI

/// The wardrobe in memory: every garment and a small front picture for each,
/// loaded as soon as the app starts so the first page appears complete.
/// Designs are saved here as their pictures arrive, so they show up at once.
/// Garments without a front of their own (e.g. saved on the web, which only
/// keeps the reference photo) get one drawn in the background.
@MainActor
final class WardrobeStore: ObservableObject {
    @Published private(set) var garments: [SavedGarment] = []
    @Published private(set) var fronts: [String: UIImage] = [:]
    @Published private(set) var drawing: Set<String> = []
    @Published private(set) var loaded = false

    private var signature = ""

    /// The Mac has deleted the designs in MongoDB after a reset (reset-done.json): drop both notes.
    private static func finishReset() {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        guard FileManager.default.fileExists(atPath: docs.appending(path: "reset-done.json").path) else { return }
        for name in ["reset.json", "reset-done.json"] { try? FileManager.default.removeItem(at: docs.appending(path: name)) }
    }

    /// Forget everything (Reset the app; the files are already gone).
    func reset() {
        garments = []
        fronts = [:]
        drawing = []
        signature = ""
    }

    /// Load everything (thumbnails decoded off the main thread), then keep an eye
    /// on the folder for garments the Mac syncs down.
    func run() async {
        await reload()
        await drawMissingFronts()
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(4))
            Self.finishReset()
            if GarmentStore.signature() != signature {
                await reload()
                await drawMissingFronts()
            }
        }
    }

    func reload() async {
        let (items, thumbs) = await Task.detached(priority: .userInitiated) { () -> ([SavedGarment], [String: UIImage]) in
            let items = GarmentStore.all()
            var thumbs: [String: UIImage] = [:]
            for g in items {
                if let t = GarmentStore.frontFile(g.id).flatMap({ UIImage(contentsOfFile: $0.path) })?
                    .preparingThumbnail(of: CGSize(width: 600, height: 800)) {
                    thumbs[g.id] = t
                }
            }
            return (items, thumbs)
        }.value
        garments = items
        fronts = thumbs
        signature = GarmentStore.signature()
        loaded = true
    }

    /// Save the design being worked on and show it in the wardrobe straight away.
    @discardableResult
    func save(_ draft: DesignDraft, measurements: [String: Double]) -> SavedGarment? {
        guard let g = try? GarmentStore.save(draft, measurements: measurements) else { return nil }
        draft.savedID = g.id
        garments.removeAll { $0.id == g.id }
        garments.insert(g, at: 0)
        if let front = draft.front { fronts[g.id] = front.preparingThumbnail(of: CGSize(width: 600, height: 800)) ?? front }
        signature = GarmentStore.signature()
        return g
    }

    /// Draw a front view for garments that have none, one at a time.
    func drawMissingFronts() async {
        guard Gemini.apiKey != nil else { return }
        for g in garments where fronts[g.id] == nil && !drawing.contains(g.id) {
            drawing.insert(g.id)
            defer { drawing.remove(g.id) }
            let reference = GarmentStore.reference(g.id)?.dataURL()
            guard let front = try? await Gemini.picture(PictureInput(spec: g.spec, images: reference.map { [$0] } ?? [],
                                                                     description: nil, look: g.look, extras: g.features.map(\.request)))
            else { continue }
            GarmentStore.setFront(g.id, front)
            fronts[g.id] = front.preparingThumbnail(of: CGSize(width: 600, height: 800)) ?? front
            signature = GarmentStore.signature()
        }
    }
}
