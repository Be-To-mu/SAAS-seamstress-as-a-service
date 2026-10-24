import AVFoundation
import QuartzCore
import Vision

/// Watches the person twice a second with Vision's on-device 2D body pose and
/// says what to fix: too close, too far, not fully in view, arms wrong.
final class LiveCoach: @unchecked Sendable {
    enum Advice: Equatable {
        case good, notSeen, wholeBody, stepBack, comeCloser, armsUp, armsDown
    }

    /// Called on the main queue with every assessment.
    var onAdvice: ((Advice) -> Void)?
    /// Arms are only judged while facing the phone; side views hide them.
    var checkArms = true

    private let queue = DispatchQueue(label: "live-coach")
    private let lock = NSLock()
    private var busy = false
    private var last: CFTimeInterval = 0

    func handle(pixels: CVPixelBuffer) {
        let now = CACurrentMediaTime()
        lock.lock()
        guard !busy, now - last > 0.5 else { lock.unlock(); return }
        busy = true
        last = now
        let arms = checkArms
        lock.unlock()
        queue.async {
            let advice = Self.assess(pixels, checkArms: arms)
            self.lock.lock(); self.busy = false; self.lock.unlock()
            DispatchQueue.main.async { self.onAdvice?(advice) }
        }
    }

    static func assess(_ pixels: CVPixelBuffer, checkArms: Bool) -> Advice {
        let request = VNDetectHumanBodyPoseRequest()
        // The phone is held upright; .right makes the image upright for Vision,
        // so points come back in portrait coordinates (origin bottom-left).
        let handler = VNImageRequestHandler(cvPixelBuffer: pixels, orientation: .right, options: [:])
        guard (try? handler.perform([request])) != nil,
              let points = try? request.results?.first?.recognizedPoints(.all)
        else { return .notSeen }

        func p(_ name: VNHumanBodyPoseObservation.JointName) -> CGPoint? {
            guard let q = points[name], q.confidence > 0.3 else { return nil }
            return q.location
        }
        guard let head = p(.nose) ?? p(.neck) else { return p(.root) == nil ? .notSeen : .wholeBody }
        let feet = [p(.leftAnkle), p(.rightAnkle)].compactMap { $0 }
        guard let lowest = feet.map(\.y).min() else { return .wholeBody }

        let top = head.y + 0.07  // the crown is above the nose
        let bottom = lowest - 0.03  // the soles are below the ankles
        if top > 0.99 || bottom < 0.01 { return .stepBack }
        let span = top - bottom
        if span > 0.9 { return .stepBack }
        if span < 0.5 { return .comeCloser }

        if checkArms {
            // Angle of shoulder→wrist away from straight down, corrected for the 3:4 picture.
            var angles: [Double] = []
            for (shoulder, wrist) in [(p(.leftShoulder), p(.leftWrist)), (p(.rightShoulder), p(.rightWrist))] {
                guard let s = shoulder, let w = wrist else { continue }
                let dx = Double(w.x - s.x) * 0.75, dy = Double(w.y - s.y)
                angles.append(atan2(abs(dx), -dy) * 180 / .pi)
            }
            if let mean = angles.isEmpty ? nil : angles.reduce(0, +) / Double(angles.count) {
                if mean < 20 { return .armsUp }
                if mean > 65 { return .armsDown }
            }
        }
        return .good
    }
}
