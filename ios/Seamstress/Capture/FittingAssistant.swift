import AVFoundation
import Speech
import SwiftUI

/// Questions during setup: hold Ask, speak, let go. Speech is recognised on the
/// phone, Gemini answers in a sentence or two (it knows how the scan works), and the
/// answer is spoken in the same ElevenLabs voice as the instructions.
@MainActor
final class FittingAssistant: ObservableObject {
    enum State: Equatable { case idle, listening, thinking, answering, failed(String) }

    @Published private(set) var state = State.idle
    @Published private(set) var question = ""
    @Published private(set) var answer = ""

    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private let recognizer = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer(locale: Locale(identifier: "en-GB"))

    func startListening() {
        guard state != .listening else { return }
        question = ""
        answer = ""
        SFSpeechRecognizer.requestAuthorization { status in
            Task { @MainActor in
                guard status == .authorized else { self.state = .failed("Allow speech recognition in Settings to ask questions."); return }
                AVAudioApplication.requestRecordPermission { granted in
                    Task { @MainActor in
                        if granted { self.beginRecording() } else { self.state = .failed("Allow the microphone in Settings to ask questions.") }
                    }
                }
            }
        }
    }

    private func beginRecording() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker, .duckOthers])
            try session.setActive(true)
            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            if recognizer?.supportsOnDeviceRecognition == true { request.requiresOnDeviceRecognition = true }
            self.request = request
            let input = engine.inputNode
            input.removeTap(onBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in
                request.append(buffer)
            }
            engine.prepare()
            try engine.start()
            task = recognizer?.recognitionTask(with: request) { result, _ in
                guard let text = result?.bestTranscription.formattedString else { return }
                Task { @MainActor in self.question = text }
            }
            state = .listening
        } catch {
            state = .failed("Couldn't start listening.")
        }
    }

    /// Stop listening and answer what was asked, in `voice`.
    func stopAndAnswer(voice: VoicePrompter) {
        guard state == .listening else { return }
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.finish()
        state = .thinking
        Task {
            try? await Task.sleep(for: .milliseconds(350))  // let the last words come through
            let asked = question.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !asked.isEmpty else { state = .idle; return }
            do {
                let reply = try await Gemini.answer(asked, context: Self.briefing)
                answer = reply
                state = .answering
                if let audio = try? await ElevenLabs.speech(reply) { voice.play(data: audio) } else { voice.say(reply) }
            } catch {
                state = .failed("Sorry, I couldn't answer that just now.")
            }
        }
    }

    /// What the assistant knows about the fitting.
    static let briefing = """
    You are the friendly fitting assistant in Seamstress, an app that makes made-to-measure clothing.
    The person is about to have their body scanned by the iPhone's LiDAR camera so their garments can be cut to their measurements.
    How the scan works:
    - Wear close-fitting clothes (leggings, a fitted top), tie long hair up, avoid thick-soled shoes or bulky layers.
    - Stand the phone upright at about waist height against something steady, in an open space at least a metre from walls.
    - Stand about two metres from the phone, with the whole body, head to feet, in the picture.
    - Face the phone first, hands empty, arms straight and a little out to the sides, like an upside-down V, palms towards the legs.
    - Then the phone asks them to turn a little to their left, eight times (an eighth of a turn each), and to hold still at each stop while it takes a picture. Keep the arms as they are. It takes about half a minute.
    - The eight pictures become a plain tailor's mannequin with their shape, made by Google Gemini (only with their permission); the photos are then deleted from the phone. The app only ever shows the mannequin, never a photo of them.
    - The scan is processed on the person's Mac over the cable; their body and measurements appear in the app a minute or so later.
    - Measurements can be checked and edited afterwards. The scan can be redone at any time from the profile.
    Answer in one or two short, warm, spoken-style sentences, in British English. No lists, no markdown.
    If the question is not about the fitting or the app, answer briefly and kindly steer back to the fitting.
    """
}

/// ElevenLabs text-to-speech, for answers (the fixed instructions are pre-made clips).
enum ElevenLabs {
    static var apiKey: String? {
        let key = Bundle.main.object(forInfoDictionaryKey: "ElevenLabsAPIKey") as? String
        return (key?.isEmpty ?? true) ? nil : key
    }

    static var voice: String {
        let v = Bundle.main.object(forInfoDictionaryKey: "ElevenLabsVoiceID") as? String
        return (v?.isEmpty ?? true) ? "pFZP5JQG7iQjIQuC4Bku" : v!
    }

    /// MP3 audio of `text` in the app's voice.
    static func speech(_ text: String) async throws -> Data {
        guard let key = apiKey else { throw Engine.Failure(message: "No ElevenLabs key") }
        var req = URLRequest(url: URL(string: "https://api.elevenlabs.io/v1/text-to-speech/\(voice)?output_format=mp3_44100_128")!)
        req.httpMethod = "POST"
        req.setValue(key, forHTTPHeaderField: "xi-api-key")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("audio/mpeg", forHTTPHeaderField: "Accept")
        req.httpBody = try JSONEncoder().encode(["text": text, "model_id": "eleven_multilingual_v2"])
        req.timeoutInterval = 30
        let (data, response) = try await URLSession.shared.data(for: req)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw Engine.Failure(message: "ElevenLabs: \(String(data: data, encoding: .utf8)?.prefix(160) ?? "error")")
        }
        return data
    }
}

/// The Ask button: hold to speak, release for the answer; shows the question and answer.
struct AskBar: View {
    @ObservedObject var assistant: FittingAssistant
    let voice: VoicePrompter

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !assistant.question.isEmpty {
                Text("“\(assistant.question)”").font(Theme.body(14)).opacity(0.85)
            }
            switch assistant.state {
            case .thinking:
                Text("Thinking…").font(.system(size: 14, weight: .medium))
            case .answering:
                Text(assistant.answer).font(Theme.body(15)).lineSpacing(3)
            case .failed(let message):
                Text(message).font(.system(size: 13)).opacity(0.85)
            default:
                EmptyView()
            }
            HStack(spacing: 10) {
                Image(systemName: assistant.state == .listening ? "waveform" : "mic")
                    .font(.system(size: 16, weight: .light))
                    .symbolEffect(.variableColor.iterative, isActive: assistant.state == .listening)
                Text(assistant.state == .listening ? "Listening… let go to ask" : "Hold to ask a question")
                    .font(.system(size: 14, weight: .medium))
            }
            .frame(maxWidth: .infinity, minHeight: 46)
            .overlay(Rectangle().stroke(Theme.cream.opacity(0.6), lineWidth: 0.75))
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { _ in if assistant.state != .listening { assistant.startListening() } }
                    .onEnded { _ in assistant.stopAndAnswer(voice: voice) }
            )
            .accessibilityAddTraits(.isButton)
            .accessibilityLabel("Hold to ask a question")
        }
    }
}
