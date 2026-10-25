import AVFoundation

/// Spoken scan instructions, always finished before the next: the bundled ElevenLabs clips
/// (Voice/<id>.mp3, made by tools/voice/generate.py), or the system voice if one is missing.
@MainActor
final class VoicePrompter {
    /// Ids and wording match tools/voice/prompts.json (the ElevenLabs clips in Voice/ are made from it).
    enum Prompt: String {
        case introPrepare = "intro_prepare"
        case introPose = "intro_pose"
        case setup
        case good
        case stop1 = "stop_1"
        case stop2 = "stop_2"
        case stop3 = "stop_3"
        case stop4 = "stop_4"
        case stop5 = "stop_5"
        case stop6 = "stop_6"
        case stop7 = "stop_7"
        case hold
        case done
        case stepBack = "step_back"
        case comeCloser = "come_closer"
        case wholeBody = "whole_body"
        case notSeen = "not_seen"
        case armsUp = "arms_up"
        case armsDown = "arms_down"
        case stayCentre = "stay_centre"

        var text: String {
            switch self {
            case .introPrepare: "Hello, and welcome to your fitting. Before we start: wear something close-fitting, and tie long hair up if you can. Stand the phone upright at about waist height, somewhere with a little space around you. You'll stand about two metres away. Tap okay when you're ready."
            case .introPose: "Lovely. When we begin, face the phone with your hands empty and your arms straight, a little away from your sides, like an upside-down V. Then I'll ask you to turn to your left, a little at a time, and to hold still at each step while I take a picture. There are eight steps in all, and I'll tell you each time when to turn and when to hold."
            case .setup: "Right, let's begin. Walk about two metres back and face the phone. Hands empty, arms straight and a little out to the sides."
            case .good: "That's perfect. Hold still, just like that, while I take the first picture."
            case .stop1: "Now turn a little to your left, about an eighth of the way round, and hold still."
            case .stop2: "Lovely. A little more to your left, until your side faces the phone. And hold."
            case .stop3: "And a little more. Hold it there."
            case .stop4: "Keep going, until your back is to the phone. And hold still."
            case .stop5: "Lovely. A little more to your left, and hold."
            case .stop6: "Now your other side faces the phone. Hold still."
            case .stop7: "Last one. A little more, and hold."
            case .hold: "Please hold still for a moment while I take the picture."
            case .done: "And that's it. You're all done. Thank you so much for your patience. You can come back to the phone now."
            case .stepBack: "Please take one small step back."
            case .comeCloser: "Please take one step closer to the phone."
            case .wholeBody: "I need to see all of you, from your head to your feet. Please take one step back."
            case .notSeen: "I can't see you yet. Please stand in front of the phone, about two metres away."
            case .armsUp: "Please lift your arms a little away from your body, like an upside-down V, and keep them there."
            case .armsDown: "Please lower your arms a little, to about halfway between your sides and your shoulders."
            case .stayCentre: "Please move back to the middle of the picture, then hold still."
            }
        }

        /// What to say before stop `k` (1…7) of the turn.
        static func stop(_ k: Int) -> Prompt? {
            [1: .stop1, 2: .stop2, 3: .stop3, 4: .stop4, 5: .stop5, 6: .stop6, 7: .stop7][k]
        }

        static func advice(_ a: LiveCoach.Advice) -> Prompt? {
            switch a {
            case .good: .good
            case .notSeen: .notSeen
            case .wholeBody: .wholeBody
            case .stepBack: .stepBack
            case .comeCloser: .comeCloser
            case .armsUp: .armsUp
            case .armsDown: .armsDown
            }
        }
    }

    private var player: AVAudioPlayer?
    private let fallback = AVSpeechSynthesizer()

    init() {
        // .playback is audible with the ringer switch on silent; duck any music.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    /// True while a line is still being spoken.
    var isSpeaking: Bool { (player?.isPlaying ?? false) || fallback.isSpeaking }

    /// Speaking, or with lines still waiting.
    var isBusy: Bool { isSpeaking || !queue.isEmpty }

    /// Lines waiting for the one being spoken to finish.
    private var queue: [Prompt] = []
    private var pump: Task<Void, Never>?

    /// Speak a line, always to the end: if another is playing, this one follows it. A correction
    /// (step back, arms up…) waiting in line is replaced by a newer one, and a line already waiting
    /// isn't queued twice. `interrupt` is only for the person moving on (tapping to the next screen).
    func play(_ prompt: Prompt, interrupt: Bool = false) {
        if interrupt {
            queue = []
            player?.stop()
            fallback.stopSpeaking(at: .immediate)
            start(prompt)
            return
        }
        guard isSpeaking || !queue.isEmpty else { start(prompt); return }
        if queue.contains(prompt) { return }
        if prompt.isCorrection { queue.removeAll(where: \.isCorrection) }
        queue.append(prompt)
        guard pump == nil else { return }
        pump = Task { [weak self] in
            while let self, !self.queue.isEmpty {
                while self.isSpeaking { try? await Task.sleep(for: .milliseconds(80)) }
                try? await Task.sleep(for: .milliseconds(250))  // a breath between lines
                if self.queue.isEmpty { break }
                self.start(self.queue.removeFirst())
            }
            self?.pump = nil
        }
    }

    private func start(_ prompt: Prompt) {
        if let url = Bundle.main.url(forResource: prompt.rawValue, withExtension: "mp3"),
           let clip = try? AVAudioPlayer(contentsOf: url) {
            player = clip
            clip.play()
        } else {
            fallback.speak(AVSpeechUtterance(string: prompt.text))
        }
    }

    func stop() {
        queue = []
        pump?.cancel()
        player?.stop()
        fallback.stopSpeaking(at: .immediate)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

extension VoicePrompter.Prompt {
    /// Corrections to how the person stands; only the latest one matters.
    var isCorrection: Bool {
        [.stepBack, .comeCloser, .wholeBody, .notSeen, .armsUp, .armsDown, .stayCentre].contains(self)
    }
}
