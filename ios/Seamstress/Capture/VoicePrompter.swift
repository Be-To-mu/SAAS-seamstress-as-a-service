import AVFoundation

/// Spoken scan instructions. Plays the bundled ElevenLabs clips (Voice/<id>.mp3,
/// made by tools/voice/generate.py) and falls back to the system voice.
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
            case .introPose: "Lovely. When we begin, face the phone with your hands empty and your arms straight, a little away from your sides, like an upside-down V. Then I'll ask you to turn to your left, a little at a time, and hold still at each step while I take a picture. There are eight in all, and I'll guide you the whole way. If anything's unclear, just tap Ask and ask me."
            case .setup: "Right, let's begin. Walk about two metres back and face the phone. Hands empty, arms straight and a little out to the sides."
            case .good: "That's perfect. Hold still, just like that."
            case .stop1: "Now turn a little to your left, about an eighth of the way round, and hold still."
            case .stop2: "Lovely. A little more to your left, until your side faces the phone. And hold."
            case .stop3: "And a little more. Hold it there."
            case .stop4: "Keep going, until your back is to the phone. And hold still."
            case .stop5: "Lovely. A little more to your left, and hold."
            case .stop6: "Now your other side faces the phone. Hold still."
            case .stop7: "Last one. A little more, and hold."
            case .hold: "Hold still for me, just a moment."
            case .done: "And that's it. You're all done. Thank you so much for your patience. You can come back to the phone now."
            case .stepBack: "Could you take a small step back for me?"
            case .comeCloser: "Come a little closer, please."
            case .wholeBody: "I need to see all of you, from head to toe. Try taking a step back."
            case .notSeen: "I can't quite see you yet. Please stand in front of the phone."
            case .armsUp: "Lift your arms a little away from your body, like an upside-down V."
            case .armsDown: "Lower your arms a little, to about halfway."
            case .stayCentre: "Lovely. Try to stay in the middle of the picture as you turn."
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

    /// Speak a line. With `interrupt: false` it is skipped if another line is still playing
    /// (countdown numbers shouldn't cut off an instruction).
    func play(_ prompt: Prompt, interrupt: Bool = true) {
        if !interrupt, isSpeaking { return }
        player?.stop()
        fallback.stopSpeaking(at: .immediate)
        if let url = Bundle.main.url(forResource: prompt.rawValue, withExtension: "mp3"),
           let clip = try? AVAudioPlayer(contentsOf: url) {
            player = clip
            clip.play()
        } else {
            fallback.speak(AVSpeechUtterance(string: prompt.text))
        }
    }

    /// Play speech audio from elsewhere (an answer to a question), cutting off any line in progress.
    func play(data: Data) {
        player?.stop()
        fallback.stopSpeaking(at: .immediate)
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        if let clip = try? AVAudioPlayer(data: data) {
            player = clip
            clip.play()
        }
    }

    func say(_ text: String) {
        player?.stop()
        fallback.stopSpeaking(at: .immediate)
        fallback.speak(AVSpeechUtterance(string: text))
    }

    func stop() {
        player?.stop()
        fallback.stopSpeaking(at: .immediate)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
