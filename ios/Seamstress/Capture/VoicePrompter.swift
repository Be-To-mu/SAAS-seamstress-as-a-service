import AVFoundation

/// Spoken scan instructions. Plays the bundled ElevenLabs clips (Voice/<id>.mp3,
/// made by tools/voice/generate.py) and falls back to the system voice.
@MainActor
final class VoicePrompter {
    /// Ids and wording match tools/voice/prompts.json.
    enum Prompt: String {
        case setup
        case turn
        case fifteen
        case ten
        case five
        case four
        case three
        case two
        case one
        case done
        case good
        case stepBack = "step_back"
        case comeCloser = "come_closer"
        case wholeBody = "whole_body"
        case notSeen = "not_seen"
        case armsUp = "arms_up"
        case armsDown = "arms_down"
        case stayCentre = "stay_centre"

        var text: String {
            switch self {
            case .setup: "Put the phone upright at waist height. Walk about two metres away and face the phone, with nothing in your hands. Hold your arms straight and a little out to the sides, like an upside-down V."
            case .turn: "Now turn slowly to your left, all the way round, keeping your arms still. You have twenty seconds."
            case .fifteen: "Fifteen."
            case .ten: "Ten seconds left."
            case .five: "Five."
            case .four: "Four."
            case .three: "Three."
            case .two: "Two."
            case .one: "One."
            case .done: "Done. You can come back to the phone."
            case .good: "Good. Hold still."
            case .stepBack: "Step back a little."
            case .comeCloser: "Come a little closer."
            case .wholeBody: "Make sure your whole body, from head to feet, is in view."
            case .notSeen: "I can't see you. Stand in front of the phone."
            case .armsUp: "Lift your arms a little away from your body, like an upside-down V."
            case .armsDown: "Lower your arms a little, to about halfway."
            case .stayCentre: "Stay in the middle of the picture while you turn."
            }
        }

        /// Spoken at this many whole seconds remaining in the turn.
        static func countdown(_ seconds: Int) -> Prompt? {
            [15: .fifteen, 10: .ten, 5: .five, 4: .four, 3: .three, 2: .two, 1: .one][seconds]
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

    func play(_ prompt: Prompt) {
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

    func stop() {
        player?.stop()
        fallback.stopSpeaking(at: .immediate)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
