import AudioToolbox
import AVFoundation
import CoreMotion
import SwiftUI

/// Runs one scan: eight guided stops, 45° apart. The person is ~2 m from the phone
/// and can't read the screen, so every instruction is spoken; at each stop they hold
/// still and the phone takes a sharp photo (for their mannequin). Depth keyframes are
/// recorded the whole way round, for the body fit on the Mac.
@MainActor
final class ScanSession: ObservableObject {
    enum Phase: Equatable {
        case idle, countdown(Int), positioning, stops(taken: Int, holding: Bool), saving, done(URL), failed(String)
    }

    static let countdownSeconds = 10
    static let stopCount = 8
    static let repeatAdvice = 3.0  // seconds of quiet before a correction is repeated

    @Published private(set) var phase: Phase = .idle
    @Published private(set) var frames = 0
    @Published private(set) var advice: LiveCoach.Advice = .notSeen

    let capture = DepthCapture()
    private let motion = CMMotionManager()
    private let recorder: Recorder
    private let coach = LiveCoach()
    private let voice = VoicePrompter()
    private var ticker: Timer?
    private var goodSince: Date?
    private var lastSpoken = Date.distantPast
    private var stopsTask: Task<Void, Never>?

    init() {
        recorder = Recorder(motion: motion)
    }

    func prepare() {
        UIApplication.shared.isIdleTimerDisabled = true  // the person is away from the phone
        do {
            try capture.configure()
        } catch {
            phase = .failed(error.localizedDescription)
            return
        }
        let recorder = recorder, coach = coach
        capture.onFrame = { pixels, depth, time in
            recorder.handle(pixels: pixels, depth: depth, time: time)
            coach.handle(pixels: pixels)
        }
        coach.onAdvice = { [weak self] advice in self?.advice = advice }
        motion.deviceMotionUpdateInterval = 1.0 / 30
        motion.startDeviceMotionUpdates()
        capture.start()
    }

    func shutdown() {
        ticker?.invalidate()
        stopsTask?.cancel()
        capture.stop()
        motion.stopDeviceMotionUpdates()
        UIApplication.shared.isIdleTimerDisabled = false
    }

    func begin() {
        voice.play(.setup)
        var left = Self.countdownSeconds
        phase = .countdown(left)
        ticker = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                left -= 1
                if left > 0 {
                    self.phase = .countdown(left)
                } else {
                    self.ticker?.invalidate()
                    self.startPositioning()
                }
            }
        }
    }

    func stopEarly() { finishRecording() }

    /// Read out one of the setup screens.
    func speak(_ prompt: VoicePrompter.Prompt) { voice.play(prompt, interrupt: true) }

    /// Wait until the whole body is in view, at a good distance, arms out.
    private func startPositioning() {
        phase = .positioning
        coach.checkArms = true
        goodSince = nil
        lastSpoken = .distantPast
        ticker = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                if self.advice == .good {
                    if self.goodSince == nil { self.goodSince = Date() }
                    if Date().timeIntervalSince(self.goodSince!) >= 1 {
                        self.ticker?.invalidate()
                        self.voice.play(.good)
                        self.startStops()
                    }
                } else {
                    self.goodSince = nil
                    self.speakAdvice()
                }
            }
        }
    }

    private func speakAdvice() {
        if voice.isBusy { lastSpoken = Date(); return }  // the gap counts from the end of the last line
        guard Date().timeIntervalSince(lastSpoken) >= Self.repeatAdvice,
              let prompt = VoicePrompter.Prompt.advice(advice), advice != .good else { return }
        lastSpoken = Date()
        voice.play(prompt)
    }

    /// The eight stops. Stop k is the person turned 45°·k to their left, so the camera
    /// sees them from view angle 360 − 45k (0 front, 90 their left side, as the garment views).
    private func startStops() {
        recorder.start(folder: ScanStore.newScanFolder())
        coach.checkArms = false  // side views hide the arms
        phase = .stops(taken: 0, holding: true)
        stopsTask = Task { [weak self] in
            guard let self else { return }
            for k in 0..<Self.stopCount {
                if k > 0 {
                    self.phase = .stops(taken: k, holding: false)
                    if let prompt = VoicePrompter.Prompt.stop(k) { self.voice.play(prompt) }
                }
                await self.waitWhileSpeaking()  // every instruction is heard in full first
                self.phase = .stops(taken: k, holding: true)
                await self.waitForStillness()
                if Task.isCancelled { return }
                let angle = (360 - 45 * k) % 360
                await self.recorder.takeStill(angle: angle)
                AudioServicesPlaySystemSound(1108)  // the camera shutter
            }
            self.finishRecording()
        }
    }

    private func waitWhileSpeaking() async {
        try? await Task.sleep(for: .milliseconds(300))
        while voice.isBusy, !Task.isCancelled { try? await Task.sleep(for: .milliseconds(100)) }
    }

    /// Until the picture stops changing (the person has finished turning), at least 0.8 s and
    /// at most 4 s; if they've drifted out of the picture, ask them to come back first.
    private func waitForStillness() async {
        let start = Date()
        var stillSince: Date?
        var asked = false
        while !Task.isCancelled {
            try? await Task.sleep(for: .milliseconds(100))
            let elapsed = Date().timeIntervalSince(start)
            let lost = [.notSeen, .wholeBody, .stepBack].contains(advice)
            if lost {
                if elapsed > 1.5, !asked { voice.play(.stayCentre); asked = true }
                if elapsed < 8 { stillSince = nil; continue }
            }
            if recorder.change < Recorder.stillMotion {
                if stillSince == nil { stillSince = Date() }
            } else {
                stillSince = nil
            }
            let held = stillSince.map { Date().timeIntervalSince($0) } ?? 0
            if (elapsed >= 0.8 && held >= 0.5) || elapsed >= 4 { return }
            if elapsed >= 2.5, !asked, held == 0 { voice.play(.hold); asked = true }
        }
    }

    private func finishRecording() {
        guard case .stops = phase else { return }
        ticker?.invalidate()
        stopsTask?.cancel()
        phase = .saving
        voice.play(.done)
        recorder.finish { [weak self] result in
            DispatchQueue.main.async {
                switch result {
                case .success(let folder): self?.phase = .done(folder)
                case .failure(let error): self?.phase = .failed(error.localizedDescription)
                }
            }
        }
    }
}

/// Keeps a keyframe every 0.25 s while recording, measures how much the picture is
/// changing, and takes the full-size stills at the stops. Everything here runs on `queue`.
final class Recorder: @unchecked Sendable {
    static let keyframeInterval = 0.25
    /// Mean change of a coarse grey grid between frames (0…255) below which the person counts as still.
    static let stillMotion = 2.5

    private let queue = DispatchQueue(label: "scan-recorder")
    private let motion: CMMotionManager
    private var folder: URL?
    private var writer: BundleWriter?
    private var lastKept: CMTime?
    private var count = 0
    private var grid: [UInt8] = []
    private var pictureChange = 99.0
    private var still: (angle: Int, done: CheckedContinuation<Void, Never>)?
    private var stills: [[String: Any]] = []

    init(motion: CMMotionManager) { self.motion = motion }

    var frameCount: Int { queue.sync { count } }
    var change: Double { queue.sync { pictureChange } }

    /// Take a full-size photo at the next frame: stops/<angle>.jpg, upright.
    func takeStill(angle: Int) async {
        await withCheckedContinuation { done in
            queue.sync {
                if folder == nil { done.resume() } else { still = (angle, done) }
            }
        }
    }

    func start(folder: URL) {
        queue.sync {
            self.folder = folder
            writer = nil
            lastKept = nil
            count = 0
            stills = []
        }
    }

    func handle(pixels: CVPixelBuffer, depth: AVDepthData, time: CMTime) {
        queue.sync {
            guard let folder else { return }
            measureChange(pixels)
            if let request = still {
                still = nil
                if let entry = try? BundleWriter.writeStill(pixels, angle: request.angle, in: folder) { stills.append(entry) }
                request.done.resume()
            }
            if let lastKept, CMTimeGetSeconds(time - lastKept) < Self.keyframeInterval { return }
            lastKept = time
            do {
                if writer == nil { writer = try BundleWriter(folder: folder, start: time) }
                let g = motion.deviceMotion?.gravity
                try writer?.add(pixels: pixels, depth: depth, time: time,
                                gravity: SIMD3(g?.x ?? 0, g?.y ?? -1, g?.z ?? 0))
                count = writer?.frameCount ?? 0
            } catch {
                print("frame dropped: \(error)")
            }
        }
    }

    /// How much a coarse 48×36 grid of the picture changed since the last frame (smoothed).
    private func measureChange(_ pixels: CVPixelBuffer) {
        CVPixelBufferLockBaseAddress(pixels, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixels, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(pixels)?.assumingMemoryBound(to: UInt8.self) else { return }
        let (w, h, row) = (CVPixelBufferGetWidth(pixels), CVPixelBufferGetHeight(pixels), CVPixelBufferGetBytesPerRow(pixels))
        var next = [UInt8](repeating: 0, count: 48 * 36)
        for j in 0..<36 {
            for i in 0..<48 {
                next[j * 48 + i] = base[(j * h / 36 + h / 72) * row + (i * w / 48 + w / 96) * 4 + 1]  // green of BGRA
            }
        }
        if grid.count == next.count {
            let diff = zip(grid, next).reduce(0) { $0 + abs(Int($1.0) - Int($1.1)) }
            pictureChange = 0.6 * pictureChange + 0.4 * Double(diff) / Double(next.count)
        }
        grid = next
    }

    func finish(done: @escaping (Result<URL, Error>) -> Void) {
        queue.async {
            let writer = self.writer
            let stills = self.stills
            if let pending = self.still { self.still = nil; pending.done.resume() }
            self.folder = nil
            self.writer = nil
            do {
                guard let writer, writer.frameCount > 10 else { throw ScanError.tooFewFrames }
                try writer.finish()
                let doc: [String: Any] = ["version": 1, "stops": stills,
                                          "note": "angle = camera view around the person (0 front, 90 their left side)"]
                try JSONSerialization.data(withJSONObject: doc, options: [.prettyPrinted, .sortedKeys])
                    .write(to: writer.folder.appending(path: "stops.json"))
                done(.success(writer.folder))
            } catch {
                done(.failure(error))
            }
        }
    }
}

enum ScanError: LocalizedError {
    case tooFewFrames
    var errorDescription: String? { "The scan recorded too few frames. Try again." }
}
