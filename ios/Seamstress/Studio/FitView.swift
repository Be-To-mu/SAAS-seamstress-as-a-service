import SwiftUI

/// On me: your mannequin wearing the garment, from any of the eight angles. Pick a side,
/// pull the red line to move the hem or the blue marks to move the cuffs, go to another
/// side and adjust again; waist and shoulders in Advanced settings (`FitControls`). The fit is one for all
/// angles: every view is drawn with the same lines, and from the first view at that fit.
/// Pictures are kept per garment, angle and fit: garments/<id>/onme/<angle>-<key>.jpg.
struct FitStage: View {
    @EnvironmentObject private var draft: DesignDraft
    @EnvironmentObject private var profile: BodyProfile
    @ObservedObject private var maker = MannequinMaker.shared
    @ObservedObject private var dresser = Dresser.shared
    let save: () -> Void

    @State private var angle = 0
    /// The last picture shown at each angle: kept on screen while a changed fit redraws.
    @State private var shown: [Int: UIImage] = [:]
    @State private var drag: (key: String, cm: Double)?
    @State private var saveTask: Task<Void, Never>?

    private var angles: [Int] { maker.images.keys.sorted() }
    private var fitting: Fitting { Fitting(draft: draft, profile: profile, mannequins: maker.images, maps: dresser.maps) }

    var body: some View {
        let fitting = fitting
        VStack(spacing: 0) {
            ZStack {
                Theme.linen
                if let mannequin = maker.images[angle] {
                    let current = fitting.cached(angle)
                    // The lines sit on the hem and cuffs found in the picture, when it's the one at this fit.
                    let found = current.flatMap { dresser.edges(of: $0) }
                    picture(current ?? shown[angle] ?? mannequin, fitting: fitting, found: found)
                    if current == nil, dresser.isBusy(fitting, angle) {
                        AtelierProgress(size: 40, caption: shown[angle] == nil ? "Dressing your mannequin…" : "Refitting…")
                            .padding(14).background(Theme.cream.opacity(0.9))
                            .frame(maxHeight: .infinity, alignment: .bottom).padding(.bottom, 16)
                    } else if current == nil, let error = dresser.error(fitting, angle) {
                        VStack(spacing: 10) {
                            Text(error).font(.callout).multilineTextAlignment(.center)
                            Button("Try again") { Task { await dresser.dress(fitting, angle) } }
                                .buttonStyle(TailoredButtonStyle(filled: false))
                        }
                        .padding(18).background(Theme.cream.opacity(0.92)).padding(24)
                    }
                } else if let scan = ScanStore.current, !MannequinStore.angles(scan).isEmpty {
                    MannequinPanel(scan: scan)
                } else {
                    Text("Redo your body scan to see garments on your mannequin.")
                        .font(Theme.body(15)).multilineTextAlignment(.center).padding(24)
                }
            }
            .clipped()
            if angles.count > 1 { angleStrip(fitting) }
        }
        .foregroundStyle(Theme.brown)
        .onAppear { if let scan = ScanStore.current { maker.load(scan) } }
        .task(id: maker.images.count) { await dresser.measure(maker.images) }
        .task(id: "\(angle)|\(fitting.key)|\(dresser.maps.count)") {
            let fitting = self.fitting
            if let image = fitting.cached(angle) { shown[angle] = image }
            try? await Task.sleep(for: .milliseconds(600))  // let stepper taps add up
            guard !Task.isCancelled, fitting.ready else { return }
            if let image = await dresser.dress(fitting, angle) { shown[angle] = image }
            // Then the rest in the background: all of them at first, the neighbours after a change.
            let rest = fitting.order(from: angle).dropFirst()
            dresser.preload(fitting, Array(draft.fit.isEmpty ? rest : rest.prefix(2)))
        }
    }

    // MARK: - Picture and guide lines

    /// The picture fitted to the space, with the hem and cuff marks over it to pull.
    private func picture(_ image: UIImage, fitting: Fitting, found: GarmentEdges.Found?) -> some View {
        GeometryReader { geo in
            let rect = fitted(image.size, in: geo.size)
            ZStack(alignment: .topLeading) {
                Image(uiImage: image).resizable().frame(width: rect.width, height: rect.height)
                    .offset(x: rect.minX, y: rect.minY)
                if let map = fitting.map(angle) {
                    ForEach(fitting.guides(angle, moving: drag, found: found), id: \.key) { g in
                        guideLine(g, map: map, rect: rect, height: fitting.height)
                    }
                }
            }
        }
    }

    private func guideLine(_ g: Fitting.Guide, map: FigureMap, rect: CGRect, height: Double) -> some View {
        let perCm = rect.height * (map.soles - map.crown) / height  // points per cm on screen
        let y = rect.minY + rect.height * g.y
        let colour = g.key == "length" ? Color(red: 0.72, green: 0.18, blue: 0.14) : Color(red: 0.16, green: 0.33, blue: 0.62)
        let x = { (v: Double) in rect.minX + rect.width * v }
        let right = x(g.spans.map(\.upperBound).max() ?? 0.7)
        let label = HStack(spacing: 6) {
            Text(g.key == "length" ? "Hem" : "Cuffs").font(.system(size: 11, weight: .semibold))
            if drag?.key == g.key {
                Text(String(format: "%+.1f cm", (draft.fit[g.key] ?? 0) + (drag?.cm ?? 0))).font(.system(size: 11)).monospacedDigit()
            }
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 8).padding(.vertical, 4)
        .background(colour, in: Capsule())
        .fixedSize()
        let left = x(g.spans.map(\.lowerBound).min() ?? 0.3)
        return ZStack {
            ForEach(g.spans.indices, id: \.self) { i in
                let s = g.spans[i]
                Rectangle().fill(colour.opacity(0.9)).frame(width: max(6, x(s.upperBound) - x(s.lowerBound)), height: 2)
                    .position(x: (x(s.lowerBound) + x(s.upperBound)) / 2, y: y)
            }
            label.position(x: min(right + 30, rect.maxX - 34), y: y)
            // The handle: the marks and their label, a finger high.
            Color.clear.frame(width: right - left + 64, height: 40).contentShape(Rectangle())
                .position(x: (left + right) / 2 + 32, y: y)
                .gesture(
                    DragGesture(minimumDistance: 2)
                        .onChanged { v in drag = (g.key, clampDelta(g.key, Double(v.translation.height / perCm))) }
                        .onEnded { _ in
                            if let d = drag { set(d.key, (((draft.fit[d.key] ?? 0) + d.cm) * 2).rounded() / 2) }
                            drag = nil
                        }
                )
        }
        .accessibilityLabel(g.key == "length" ? "Hem line, drag to lengthen or shorten" : "Cuff marks, drag to lengthen or shorten the sleeves")
    }

    private func fitted(_ size: CGSize, in space: CGSize) -> CGRect {
        let s = min(space.width / size.width, space.height / size.height)
        let w = size.width * s, h = size.height * s
        return CGRect(x: (space.width - w) / 2, y: (space.height - h) / 2, width: w, height: h)
    }

    // MARK: - Angles and steppers

    private func angleStrip(_ fitting: Fitting) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(angles, id: \.self) { a in
                    Button { angle = a } label: {
                        Color.clear.frame(width: 42, height: 56)
                            .overlay {
                                if let m = fitting.cached(a) ?? shown[a] ?? maker.images[a] { Image(uiImage: m).resizable().scaledToFill() }
                            }
                            .clipped()
                            .overlay(Rectangle().stroke(a == angle ? Theme.brown : Theme.hairline, lineWidth: a == angle ? 1.5 : 0.5))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Self.angleName(a))
                }
            }
            .padding(.horizontal, 20).padding(.vertical, 10)
        }
        .background(Theme.cream)
        .hairline(.top)
    }

    static func angleName(_ a: Int) -> String {
        [0: "Front", 45: "Front left", 90: "Left side", 135: "Back left", 180: "Back",
         225: "Back right", 270: "Right side", 315: "Front right"][a] ?? "\(a)°"
    }

    private func set(_ key: String, _ value: Double) {
        let v = min(max(value, range(key).lowerBound), range(key).upperBound)
        draft.fit[key] = v == 0 ? nil : v
        saveSoon()
    }

    private func clampDelta(_ key: String, _ cm: Double) -> Double {
        let now = draft.fit[key] ?? 0
        return min(max(now + cm, range(key).lowerBound), range(key).upperBound) - now
    }

    /// Keep the adjustment with the garment, once the fingers stop moving.
    private func saveSoon() {
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(for: .milliseconds(600))
            if !Task.isCancelled { save() }
        }
    }

    private func range(_ key: String) -> ClosedRange<Double> {
        let l = Fitting.limits[key] ?? [-10, 10]
        return l[0]...l[1]
    }

}

/// The fitting adjustments as steppers (in Advanced settings): length, waist, shoulders, sleeves.
struct FitControls: View {
    @EnvironmentObject private var draft: DesignDraft
    let save: () -> Void
    @State private var saveTask: Task<Void, Never>?

    private var controls: [(key: String, label: String)] {
        draft.family == "skirt"
            ? [("length", "Length"), ("waist", "Waist")]
            : [("length", "Length"), ("waist", "Waist"), ("shoulder", "Shoulders"), ("sleeve", "Sleeves")]
    }

    var body: some View {
        Section {
            ForEach(controls, id: \.key) { c in
                HStack {
                    Text(c.label).font(Theme.body(15))
                    Spacer()
                    Text(String(format: "%+.1f cm", draft.fit[c.key] ?? 0)).monospacedDigit()
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle((draft.fit[c.key] ?? 0) == 0 ? Theme.sand : Theme.brown)
                        .frame(width: 80, alignment: .trailing)
                    Stepper("", value: binding(c.key), in: range(c.key), step: 0.5).labelsHidden()
                }
            }
            if !draft.fit.isEmpty {
                Button("Reset to the pattern") { draft.fit = [:]; saveSoon() }
                    .font(.system(size: 13)).underline().foregroundStyle(Theme.sand)
            }
        } header: {
            Text("Fit")
        } footer: {
            Text("Or pull the red and blue lines on your mannequin.")
        }
    }

    private func range(_ key: String) -> ClosedRange<Double> {
        let l = Fitting.limits[key] ?? [-10, 10]
        return l[0]...l[1]
    }

    private func binding(_ key: String) -> Binding<Double> {
        Binding { draft.fit[key] ?? 0 } set: { v in
            let r = range(key), cm = min(max((v * 2).rounded() / 2, r.lowerBound), r.upperBound)
            draft.fit[key] = cm == 0 ? nil : cm
            saveSoon()
        }
    }

    private func saveSoon() {
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(for: .milliseconds(600))
            if !Task.isCancelled { save() }
        }
    }
}

/// One garment at one fit on your mannequin: where its hem and cuffs fall, the key its
/// pictures are kept under, and what to ask Gemini for each angle. A value, so a background
/// preload keeps working on the fit it was started for.
struct Fitting {
    static let limits: [String: [Double]] = (try? Engine.shared.call("fitLimits", [], as: [String: [Double]].self)) ?? [:]

    struct Guide {
        let key: String  // length | sleeve
        let y: Double  // normalised in the picture
        let spans: [ClosedRange<Double>]  // normalised x: across the body for the hem, across each arm for the cuffs
        let above: Double  // cm above the floor
    }

    let spec: Spec
    let family: String
    let features: [Feature]
    let look: String
    let drawnAt: Date
    let fit: [String: Double]
    let front: UIImage?
    let views: [Int: UIImage]
    let savedID: String?
    let mannequins: [Int: UIImage]
    let maps: [Int: FigureMap]
    let height: Double
    let backLength: Double?
    let armLength: Double
    let waistLevel: Double
    let shape: FitShape?
    let scanName: String
    /// cm to add to where the pattern says the hem and cuffs fall, measured on the dressed front
    /// (see `GarmentEdges`), so the marks sit on the cuffs and hem Gemini actually drew.
    let offsets: [String: Double]

    @MainActor
    init(draft: DesignDraft, profile: BodyProfile, mannequins: [Int: UIImage], maps: [Int: FigureMap]) {
        // The design the pictures in Images were drawn from: On me shows that same garment.
        let design = draft.drawn ?? DesignDraft.Drawn(spec: draft.spec, features: draft.features, look: draft.look)
        spec = design.spec
        family = design.spec["family"]?.string ?? "coat"
        features = design.features
        look = design.look
        drawnAt = design.at
        fit = draft.fit
        front = draft.front
        views = draft.views
        savedID = draft.savedID
        self.mannequins = mannequins
        self.maps = maps
        let h = profile.value("height") ?? 170
        height = h
        backLength = profile.value("back_length")
        armLength = profile.value("arm_length") ?? 0.335 * h
        let scan = ScanStore.current
        // The scan and when its mannequin was made: a remade mannequin is dressed afresh.
        scanName = (scan?.lastPathComponent ?? "") + "@" + String(Int(MannequinMaker.shared.stamp.timeIntervalSince1970))
        if let scan, let w = ScanStore.measurements(of: scan)?.levels?["waist"], (0.57...0.64).contains(w / h) {
            waistLevel = w  // the natural waist is ~61% of height; trust only a plausible fit
        } else {
            waistLevel = 0.61 * h
        }
        let m = profile.webMeasurements.isEmpty ? BodyProfile.sampleBody : profile.webMeasurements
        shape = try? Engine.shared.call("fitShape", [design.spec, m, design.features, draft.fit])
        offsets = Dresser.shared.offsets[Self.designKey(spec: design.spec, features: design.features, at: design.at, scan: scanName)] ?? [:]
    }

    var ready: Bool { front != nil && !mannequins.isEmpty }

    func map(_ angle: Int) -> FigureMap? { maps[angle] ?? (mannequins[angle] == nil ? nil : FigureMap.fallback) }

    /// Changes with anything that changes the picture: the design, the fit, the mannequin.
    var key: String {
        let fitText = fit.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: ",")
        return Self.hash([designKey, fitText, "v3"])
    }

    /// The garment and mannequin, whatever the fit.
    var designKey: String { Self.designKey(spec: spec, features: features, at: drawnAt, scan: scanName) }

    static func designKey(spec: Spec, features: [Feature], at: Date, scan: String) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys  // dictionaries encode in random order otherwise
        let specText = (try? encoder.encode(spec)).flatMap { String(data: $0, encoding: .utf8) } ?? ""
        return hash([specText, features.map(\.request).joined(separator: ";"), scan, String(Int(at.timeIntervalSince1970))])
    }

    private static func hash(_ parts: [String]) -> String {
        var hash: UInt64 = 0xcbf2_9ce4_8422_2325  // FNV-1a
        for byte in parts.joined(separator: "|").utf8 { hash = (hash ^ UInt64(byte)) &* 0x100_0000_01b3 }
        return String(hash, radix: 36)
    }

    func file(_ angle: Int) -> URL? {
        savedID.map { GarmentStore.folder($0).appending(path: "onme/\(angle)-\(key).jpg") }
    }

    /// Kept pictures, so redrawing the screen (every frame of a drag) doesn't read them from disk.
    private static let memory = NSCache<NSString, UIImage>()

    func cached(_ angle: Int) -> UIImage? {
        guard let file = file(angle) else { return nil }
        if let image = Self.memory.object(forKey: file.path as NSString) { return image }
        guard let image = UIImage(contentsOfFile: file.path) else { return nil }
        Self.memory.setObject(image, forKey: file.path as NSString)
        return image
    }

    /// Angles nearest `angle` first.
    func order(from angle: Int) -> [Int] {
        mannequins.keys.sorted { a, b in
            let da = min(abs(a - angle), 360 - abs(a - angle)), db = min(abs(b - angle), 360 - abs(b - angle))
            return da == db ? a < b : da < db
        }
    }

    // MARK: Where the hem and cuffs fall

    private var nape: Double { waistLevel + (backLength ?? 0.235 * height) }

    /// The wrists, from where the fingertips end on the front view (arms hang by the sides): one
    /// height for every angle, so the cuffs sit at the same place on the body all the way round.
    private var wrist: Double {
        for a in [0, 180, 45, 315, 135, 225] {
            if let m = maps[a], let tips = m.fingertips { return m.above(tips, height: height) + 0.108 * height }
        }
        return 0.485 * height
    }

    /// The marks for `angle`, cm above the floor turned into picture y on that view's own figure, or —
    /// when `found` has them — exactly where the hem and cuffs are in the picture shown.
    /// `moving` is a drag in progress (cm added to one of them).
    func guides(_ angle: Int, moving: (key: String, cm: Double)? = nil, found: GarmentEdges.Found? = nil) -> [Guide] {
        guard let shape, let map = map(angle) else { return [] }
        var out: [Guide] = []
        func add(_ key: String, _ above: Double) {
            let drag = moving?.key == key ? moving!.cm : 0
            let at = above - drag  // longer = lower
            let perCm = (map.soles - map.crown) / height
            if key == "length", let hem = found?.hem, let span = found?.hemSpan {
                out.append(Guide(key: key, y: hem + drag * perCm, spans: [span], above: at))
                return
            }
            if key == "sleeve", let cuff = found?.cuff, let spans = found?.cuffSpans, !spans.isEmpty {
                out.append(Guide(key: key, y: cuff + drag * perCm, spans: spans, above: at))
                return
            }
            let y = map.y(at, height: height)
            let runs = map.runs(at: y)
            let spans: [ClosedRange<Double>]
            if key == "sleeve", runs.count >= 3 {
                spans = [runs.first!, runs.last!].map { ($0.lowerBound - 0.01)...($0.upperBound + 0.01) }  // across each arm
            } else {
                let e = map.extent(at: y)
                spans = [(e.lowerBound - 0.025)...(e.upperBound + 0.025)]
            }
            out.append(Guide(key: key, y: y, spans: spans, above: at))
        }
        for (key, raw) in rawLevels { add(key, raw + (offsets[key] ?? 0)) }
        return out
    }

    /// Where the pattern puts the hem and cuffs, in cm above the floor, before any calibration.
    var rawLevels: [(String, Double)] {
        guard let shape else { return [] }
        var out = [("length", (family == "skirt" ? waistLevel : nape) - shape.length)]
        if family != "skirt", shape.sleeve > 0 { out.append(("sleeve", wrist - (shape.sleeve - armLength))) }
        return out
    }

    /// Where the hem falls on the body, in words: image models follow these better than the lines alone.
    var hemWords: String? {
        guard let hem = guides(0).first(where: { $0.key == "length" }) ?? guides(mannequins.keys.min() ?? 0).first else { return nil }
        let levels: [(Double, String)] = [
            (0.585, "at the waist"), (0.545, "at the high hip"), (0.505, "at the hip, just covering the seat"),
            (0.455, "at the top of the thigh"), (0.385, "at mid-thigh"), (0.315, "just above the knee"),
            (0.265, "at the knee"), (0.215, "just below the knee"), (0.15, "at mid-calf"), (0.08, "just above the ankle"),
        ]
        return levels.first { hem.above / height >= $0.0 }?.1 ?? "at the ankle"
    }

    /// Where the cuffs fall, in words, from the sleeve against the arm.
    var sleeveWords: String? {
        guard let shape, shape.sleeve > 0, armLength > 0 else { return nil }
        let r = shape.sleeve / armLength
        return r < 0.3 ? "on the upper arm (short sleeves)" : r < 0.55 ? "at the elbow" : r < 0.8 ? "on the forearm (three-quarter sleeves)"
            : r < 0.95 ? "just above the wrist" : r < 1.04 ? "at the wrist bone" : "past the wrist, over the top of the hand"
    }

    /// Waist and shoulder changes, in words for the image model.
    var fitNotes: [String]? {
        var notes: [String] = []
        if let w = fit["waist"], w != 0 {
            notes.append(String(format: w < 0 ? "taken in %.1f cm at the waist" : "let out %.1f cm at the waist", abs(w)))
        }
        if let s = fit["shoulder"], s != 0 {
            notes.append(String(format: s < 0 ? "%.1f cm narrower across the shoulders" : "%.1f cm wider across the shoulders", abs(s)))
        }
        return notes.isEmpty ? nil : notes
    }

    // MARK: What to ask for

    /// The request for `angle`: the mannequin with the marks drawn on, the garment, and — so lengths match
    /// all the way round — the nearest view already drawn at this fit.
    func input(_ angle: Int) -> DressInput? {
        guard let mannequin = mannequins[angle], let garment = front?.dataURL() else { return nil }
        let guides = guides(angle)
        guard let marked = mark(mannequin, guides: guides).dataURL() else { return nil }
        let sameFit = order(from: angle).dropFirst().lazy.compactMap { cached($0) }.first
        return DressInput(spec: spec, extras: features.map(\.request), mannequin: marked, garment: garment,
                          garmentView: angle == 0 ? nil : views[angle]?.dataURL(), angle: angle,
                          guides: guides.isEmpty ? nil : .init(hem: guides.contains { $0.key == "length" } ? true : nil,
                                                                sleeve: guides.contains { $0.key == "sleeve" } ? true : nil),
                          hemAt: hemWords, sleeveAt: sleeveWords, notes: fitNotes, look: look.isEmpty ? nil : look,
                          sameFit: sameFit?.dataURL(side: 768))
    }

    /// The mannequin with thin red (hem) and blue (cuff) marks drawn where they should fall.
    private func mark(_ image: UIImage, guides: [Guide]) -> UIImage {
        guard !guides.isEmpty else { return image }
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: image.size, format: format).image { _ in
            image.draw(at: .zero)
            let w = image.size.width, h = image.size.height
            for g in guides {
                (g.key == "length" ? UIColor.red : UIColor.blue).setStroke()
                for s in g.spans {
                    let path = UIBezierPath()
                    path.move(to: CGPoint(x: w * s.lowerBound, y: h * g.y))
                    path.addLine(to: CGPoint(x: w * s.upperBound, y: h * g.y))
                    path.lineWidth = max(3, h * 0.004)
                    path.stroke()
                }
            }
        }
    }
}

/// Dresses the mannequin: one request per angle and fit at a time (a preload and the view
/// asking for the same picture share it), kept on disk; and the figure of each mannequin view.
@MainActor
final class Dresser: ObservableObject {
    static let shared = Dresser()

    @Published private(set) var maps: [Int: FigureMap] = [:]
    /// Per garment (`Fitting.designKey`): cm between where the pattern puts the hem and cuffs and where
    /// they are in the dressed front. From the front because the arms hang clear of the body there.
    @Published private(set) var offsets: [String: [String: Double]] = [:]
    /// Per dressed picture: where its hem and cuffs are.
    @Published private var found: [ObjectIdentifier: (UIImage, GarmentEdges.Found)] = [:]
    @Published private var busy: Set<String> = []
    @Published private var errors: [String: String] = [:]
    private var running: [String: Task<UIImage?, Never>] = [:]
    private var preloading: Task<Void, Never>?

    /// Forget everything (Reset the app).
    func reset() {
        preloading?.cancel()
        running.values.forEach { $0.cancel() }
        running = [:]
        maps = [:]
        offsets = [:]
        found = [:]
        busy = []
        errors = [:]
        measured = [:]
    }
    private var measured: [ObjectIdentifier: Int] = [:]

    func isBusy(_ f: Fitting, _ angle: Int) -> Bool { busy.contains(id(f, angle)) }
    func error(_ f: Fitting, _ angle: Int) -> String? { errors[id(f, angle)] }

    private func id(_ f: Fitting, _ angle: Int) -> String { "\(f.savedID ?? "-")|\(angle)|\(f.key)" }

    /// Find the figure in each mannequin view (once per picture).
    func measure(_ mannequins: [Int: UIImage]) async {
        for (angle, image) in mannequins where measured[ObjectIdentifier(image)] != angle {
            measured[ObjectIdentifier(image)] = angle
            if let map = await Task.detached(priority: .userInitiated, operation: { MannequinStore.figureMap(image) }).value {
                maps[angle] = map
            }
        }
    }

    /// The picture for `angle` at `f`'s fit: from disk, from a request already running, or a new one.
    @discardableResult
    func dress(_ f: Fitting, _ angle: Int) async -> UIImage? {
        if let kept = f.cached(angle) { await calibrate(f, angle, kept); return kept }
        let key = id(f, angle)
        if let task = running[key] { return await task.value }
        let task = Task<UIImage?, Never> {
            busy.insert(key)
            errors[key] = nil
            defer { busy.remove(key); running[key] = nil }
            guard let input = f.input(angle) else { return nil }
            do {
                let image = try await Gemini.dress(input)
                if let file = f.file(angle) {
                    try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
                    try? image.jpegData(compressionQuality: 0.85)?.write(to: file)
                }
                await calibrate(f, angle, image)
                return image
            } catch {
                errors[key] = error.localizedDescription
                return nil
            }
        }
        running[key] = task
        return await task.value
    }

    /// The hem and cuffs found in a dressed picture (see `calibrate`).
    func edges(of image: UIImage) -> GarmentEdges.Found? { found[ObjectIdentifier(image)]?.1 }

    /// Find where the hem and cuffs really are in a dressed picture, once per picture. From the front,
    /// this also calibrates where the marks go on the next pictures.
    private func calibrate(_ f: Fitting, _ angle: Int, _ image: UIImage) async {
        let key = ObjectIdentifier(image)
        guard found[key] == nil, let mannequin = f.mannequins[angle], let mannequinMap = maps[angle] else { return }
        let result = await Task.detached(priority: .userInitiated) { () -> (FigureMap, GarmentEdges.Found)? in
            guard let map = MannequinStore.figureMap(image) else { return nil }
            return (map, GarmentEdges.find(dressed: image, map: map, mannequin: mannequin, mannequinMap: mannequinMap, angle: angle))
        }.value
        guard let (map, edges) = result else { return }
        found[key] = (image, edges)  // the picture is kept so its identity stays its own
        guard angle == 0 else { return }
        var cm: [String: Double] = offsets[f.designKey] ?? [:]
        for (k, raw) in f.rawLevels {
            guard let y = k == "length" ? edges.hem : edges.cuff else { continue }
            let offset = map.above(y, height: f.height) - raw
            if abs(offset) < 30 { cm[k] = offset }  // more than that is a misreading, not a fit
        }
        offsets[f.designKey] = cm
    }

    /// Get the mannequin ready and dress `angles` of the draft in the background: called as soon as
    /// the front is drawn, so On me opens with the garment already on.
    func prepare(_ draft: DesignDraft, _ profile: BodyProfile, angles: [Int]) async {
        guard draft.front != nil, let scan = ScanStore.current else { return }
        let maker = MannequinMaker.shared
        maker.load(scan)
        guard !maker.images.isEmpty else { return }
        await measure(maker.images)
        preload(Fitting(draft: draft, profile: profile, mannequins: maker.images, maps: maps), angles)
    }

    /// Dress `angles` in the background, two at a time; a new preload replaces the last one.
    /// Angles whose garment view isn't drawn yet wait: without it the back would be guessed.
    func preload(_ f: Fitting, _ angles: [Int]) {
        preloading?.cancel()
        let todo = angles.filter { f.cached($0) == nil && ($0 == 0 || f.views[$0] != nil) }
        guard f.ready, !todo.isEmpty else { return }
        preloading = Task {
            for pair in stride(from: 0, to: todo.count, by: 2).map({ Array(todo[$0..<min($0 + 2, todo.count)]) }) {
                if Task.isCancelled { return }
                await withTaskGroup(of: Void.self) { group in
                    for a in pair { group.addTask { await self.dress(f, a) } }
                }
            }
        }
    }
}

/// The finished garment's shape, from the pattern (engine `fitShape`), in cm.
struct FitShape: Codable, Equatable {
    let family: String
    let length: Double
    let chest: Double
    let waist: Double
    let hem: Double
    let shoulderHalf: Double
    let sleeve: Double
}
