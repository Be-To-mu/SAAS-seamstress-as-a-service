import AVFoundation
import CoreMotion
import SwiftUI

/// Runs one turn scan. The person is ~2 m from the phone and can't read the
/// screen, so every instruction is also spoken, and the live coach tells them
/// what to fix before (and while) recording.
@MainActor
final class ScanSession: ObservableObject {
    enum Phase: Equatable {
        case idle, countdown(Int), positioning, recording(secondsLeft: Int, progress: Double), saving, done(URL), failed(String)
    }

    static let countdownSeconds = 10
    static let recordSeconds = 20
    static let repeatAdvice = 4.0  // seconds between repeated spoken corrections

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
    private var badSince: Date?

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
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { self.startRecording() }
                    }
                } else {
                    self.goodSince = nil
                    self.speakAdvice()
                }
            }
        }
    }

    private func speakAdvice() {
        guard Date().timeIntervalSince(lastSpoken) >= Self.repeatAdvice,
              let prompt = VoicePrompter.Prompt.advice(advice), advice != .good else { return }
        lastSpoken = Date()
        voice.play(prompt)
    }

    private func startRecording() {
        recorder.start(folder: ScanStore.newScanFolder())
        coach.checkArms = false  // side views hide the arms
        let total = Double(Self.recordSeconds)
        let until = Date().addingTimeInterval(total)
        phase = .recording(secondsLeft: Self.recordSeconds, progress: 0)
        voice.play(.turn)
        var lastSecond = Self.recordSeconds
        badSince = nil
        lastSpoken = Date()  // let the turn instruction finish first
        ticker = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                let remaining = max(0, until.timeIntervalSinceNow)
                let seconds = Int(remaining.rounded(.up))
                self.phase = .recording(secondsLeft: seconds, progress: 1 - remaining / total)
                self.frames = self.recorder.frameCount
                if seconds < lastSecond {
                    lastSecond = seconds
                    if let prompt = VoicePrompter.Prompt.countdown(seconds) {
                        self.voice.play(prompt)
                        self.lastSpoken = Date()
                    }
                }
                // Drifting out of the picture while turning.
                let lost = [.notSeen, .wholeBody, .stepBack].contains(self.advice)
                if lost {
                    if self.badSince == nil { self.badSince = Date() }
                    if Date().timeIntervalSince(self.badSince!) > 1.5,
                       Date().timeIntervalSince(self.lastSpoken) >= Self.repeatAdvice, seconds > 5 {
                        self.voice.play(.stayCentre)
                        self.lastSpoken = Date()
                    }
                } else {
                    self.badSince = nil
                }
                if remaining <= 0 { self.finishRecording() }
            }
        }
    }

    private func finishRecording() {
        guard case .recording = phase else { return }
        ticker?.invalidate()
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

/// Keeps a keyframe every 0.25 s while recording. Everything here runs on `queue`.
private final class Recorder: @unchecked Sendable {
    static let keyframeInterval = 0.25

    private let queue = DispatchQueue(label: "scan-recorder")
    private let motion: CMMotionManager
    private var folder: URL?
    private var writer: BundleWriter?
    private var lastKept: CMTime?
    private var count = 0

    init(motion: CMMotionManager) { self.motion = motion }

    var frameCount: Int { queue.sync { count } }

    func start(folder: URL) {
        queue.sync {
            self.folder = folder
            writer = nil
            lastKept = nil
            count = 0
        }
    }

    func handle(pixels: CVPixelBuffer, depth: AVDepthData, time: CMTime) {
        queue.sync {
            guard let folder else { return }
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

    func finish(done: @escaping (Result<URL, Error>) -> Void) {
        queue.async {
            let writer = self.writer
            self.folder = nil
            self.writer = nil
            do {
                guard let writer, writer.frameCount > 10 else { throw ScanError.tooFewFrames }
                try writer.finish()
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
