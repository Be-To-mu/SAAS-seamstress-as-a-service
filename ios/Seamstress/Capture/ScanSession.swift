import AVFoundation
import CoreMotion
import SwiftUI

/// Runs one turn scan. The person is ~2 m from the phone and can't read the
/// screen, so every instruction is also spoken.
@MainActor
final class ScanSession: ObservableObject {
    enum Phase: Equatable {
        case idle, countdown(Int), recording(Double), saving, done(URL), failed(String)
    }

    static let countdownSeconds = 10
    static let recordSeconds = 30.0

    @Published private(set) var phase: Phase = .idle
    @Published private(set) var frames = 0

    let capture = DepthCapture()
    private let motion = CMMotionManager()
    private let recorder: Recorder
    private let voice = AVSpeechSynthesizer()
    private var ticker: Timer?
    private let ageYears: Double

    init(ageYears: Double) {
        self.ageYears = ageYears
        recorder = Recorder(motion: motion)
    }

    func prepare() {
        do {
            try capture.configure()
        } catch {
            phase = .failed(error.localizedDescription)
            return
        }
        let recorder = recorder
        capture.onFrame = { pixels, depth, time in recorder.handle(pixels: pixels, depth: depth, time: time) }
        motion.deviceMotionUpdateInterval = 1.0 / 30
        motion.startDeviceMotionUpdates()
        capture.start()
    }

    func shutdown() {
        ticker?.invalidate()
        capture.stop()
        motion.stopDeviceMotionUpdates()
    }

    func begin() {
        say("Put the phone at waist height. Walk about two metres away, face the phone, "
            + "and hold your arms slightly away from your body.")
        var left = Self.countdownSeconds
        phase = .countdown(left)
        ticker = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                left -= 1
                if left > 0 {
                    self.phase = .countdown(left)
                    if left <= 3 { self.say("\(left)") }
                } else {
                    self.ticker?.invalidate()
                    self.startRecording()
                }
            }
        }
    }

    func stopEarly() { finishRecording() }

    private func startRecording() {
        recorder.start(folder: ScanStore.newScanFolder())
        let until = Date().addingTimeInterval(Self.recordSeconds)
        phase = .recording(0)
        say("Now turn slowly to your left, all the way round, keeping your arms still.")
        var halfwaySaid = false
        ticker = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                let progress = min(1, 1 - until.timeIntervalSinceNow / Self.recordSeconds)
                self.phase = .recording(progress)
                self.frames = self.recorder.frameCount
                if progress >= 0.5 && !halfwaySaid {
                    halfwaySaid = true
                    self.say("Halfway. Keep turning.")
                }
                if progress >= 1 { self.finishRecording() }
            }
        }
    }

    private func finishRecording() {
        guard case .recording = phase else { return }
        ticker?.invalidate()
        phase = .saving
        say("Done. You can come back to the phone.")
        recorder.finish(ageYears: ageYears) { [weak self] result in
            DispatchQueue.main.async {
                switch result {
                case .success(let folder): self?.phase = .done(folder)
                case .failure(let error): self?.phase = .failed(error.localizedDescription)
                }
            }
        }
    }

    private func say(_ text: String) {
        voice.stopSpeaking(at: .immediate)
        voice.speak(AVSpeechUtterance(string: text))
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

    func finish(ageYears: Double, done: @escaping (Result<URL, Error>) -> Void) {
        queue.async {
            let writer = self.writer
            self.folder = nil
            self.writer = nil
            do {
                guard let writer, writer.frameCount > 10 else { throw ScanError.tooFewFrames }
                try writer.finish(ageYears: ageYears)
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
