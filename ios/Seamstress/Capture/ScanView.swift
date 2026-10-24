import AVFoundation
import SwiftUI

/// Full-screen camera with the scan instructions on top. The camera stays open
/// from the first screen to the end of the turn; numbers are huge so they can be
/// read from where the person stands, and everything is spoken too.
struct ScanView: View {
    @StateObject private var session = ScanSession()
    @StateObject private var assistant = FittingAssistant()
    @State private var introStep = 0
    var canCancel = false
    let onClose: (URL?) -> Void

    var body: some View {
        ZStack {
            CameraPreview(session: session.capture.session).ignoresSafeArea()
            Theme.ink.opacity(0.45).ignoresSafeArea()  // flat tint so the text reads over the camera
            if showsFramingBorder {
                Rectangle()
                    .stroke(session.advice == .good ? Color.green : Theme.linen, lineWidth: 6)
                    .ignoresSafeArea()
                    .animation(.easeInOut, value: session.advice)
            }
            overlay
                .foregroundStyle(Theme.cream)
                .padding(24)
        }
        .onAppear { session.prepare() }
        .onDisappear { session.shutdown() }
        .onChange(of: session.phase) { _, phase in
            if case .done(let folder) = phase { onClose(folder) }
        }
    }

    private var showsFramingBorder: Bool {
        switch session.phase {
        case .countdown, .positioning, .stops: true
        default: false
        }
    }

    @ViewBuilder private var overlay: some View {
        switch session.phase {
        case .idle:
            intro
        case .countdown(let s):
            BigNumber(value: s, caption: "Walk about 2 m away and face the phone", hint: adviceText)
        case .positioning:
            VStack(spacing: 16) {
                Spacer()
                APoseFigure().frame(height: 160)
                Text(adviceText ?? "Getting ready…").titleStyle(20).multilineTextAlignment(.center)
                Spacer()
            }
        case .stops(let taken, let holding):
            VStack {
                BigNumber(value: taken + 1, caption: holding ? "Hold still" : "Turn a little to your left",
                          hint: session.advice == .good || session.advice == .armsUp || session.advice == .armsDown ? nil : adviceText,
                          of: ScanSession.stopCount)
                StopDots(taken: taken, total: ScanSession.stopCount)
                Button("Stop") { session.stopEarly() }
                    .buttonStyle(TailoredButtonStyle(filled: false, onDark: true)).frame(width: 160).padding(.top)
            }
        case .saving:
            ProgressView("Saving…").tint(Theme.cream).frame(maxHeight: .infinity)
        case .done:
            Text("Saved").titleStyle().frame(maxHeight: .infinity)
        case .failed(let message):
            VStack(spacing: 16) {
                Spacer()
                Text(message).font(Theme.body(17))
                Button("Close") { onClose(nil) }.buttonStyle(TailoredButtonStyle(onDark: true))
            }
        }
    }

    /// Before scanning: first how to prepare (clothing, phone, where to stand), then — after
    /// "Okay" — how to hold the arms and turn, with Start.
    @ViewBuilder private var intro: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Monogram(size: 40)
                Spacer()
                if canCancel {
                    Button { onClose(nil) } label: { Image(systemName: "xmark").font(.system(size: 17, weight: .light)) }
                }
            }
            .padding(.bottom, 28)
            Text(introStep == 0 ? "Step 1 of 2 · Prepare" : "Step 2 of 2 · Pose").eyebrowStyle(onDark: true)
            Text(introStep == 0 ? "Your fitting" : "Eight stops").titleStyle(34).padding(.top, 8)
            Spacer()
            Group {
                if introStep == 0 { prepare } else { pose }
            }
            .transition(.asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity), removal: .opacity))
        }
        .animation(.easeInOut(duration: 0.35), value: introStep)
        .onAppear { session.speak(.introPrepare) }
        .onChange(of: introStep) { _, step in session.speak(step == 0 ? .introPrepare : .introPose) }
    }

    private var prepare: some View {
        VStack(alignment: .leading, spacing: 0) {
            IntroRow(icon: "tshirt", title: "What to wear",
                     text: "Close-fitting clothes, such as leggings and a fitted top. Tie long hair up and take off shoes with thick soles.")
            IntroRow(icon: "iphone", title: "Place the phone",
                     text: "Stand it upright at waist height, against something steady, in an open space.")
            IntroRow(icon: "figure.stand", title: "Where to stand",
                     text: "About two metres from the phone, with your whole body, head to feet, in the picture.")
            AskBar(assistant: assistant, voice: session.voicePrompter).padding(.top, 20)
            Button("Okay") { introStep = 1 }
                .buttonStyle(TailoredButtonStyle(onDark: true))
                .padding(.top, 12)
        }
    }

    private var pose: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 22) {
                APoseFigure().frame(height: 160)
                VStack(alignment: .leading, spacing: 8) {
                    Text("Arms").font(.system(size: 15, weight: .semibold))
                    Text("Straight and a little away from your sides, like an upside-down V. Hands empty, palms towards your legs.")
                        .font(Theme.body(15)).lineSpacing(3)
                }
            }
            .padding(.vertical, 16)
            .hairline(.bottom, onDark: true)
            IntroRow(icon: "arrow.counterclockwise", title: "Turn, and hold",
                     text: "Start facing the phone. It asks you to turn a little to your left, eight times, and to hold still at each stop while it takes a picture. Keep your arms as they are.")
            Text("The phone speaks every step, so you don't need to see the screen.")
                .font(.system(size: 13)).opacity(0.75).padding(.top, 14)
            AskBar(assistant: assistant, voice: session.voicePrompter).padding(.top, 14)
            HStack(spacing: 12) {
                Button("Back") { introStep = 0 }
                    .buttonStyle(TailoredButtonStyle(filled: false, onDark: true))
                    .frame(width: 110)
                Button("Start") { session.begin() }
                    .buttonStyle(TailoredButtonStyle(onDark: true))
            }
            .padding(.top, 20)
        }
    }

    private var adviceText: String? {
        switch session.advice {
        case .good: "Good — hold still"
        case .notSeen: "Stand in front of the phone"
        case .wholeBody: "Head to feet in view"
        case .stepBack: "Step back a little"
        case .comeCloser: "Come a little closer"
        case .armsUp: "Arms a little further out"
        case .armsDown: "Arms a little lower"
        }
    }
}

private struct BigNumber: View {
    let value: Int
    let caption: String
    var hint: String?
    /// Shown as "3 of 8" in small type under the number.
    var of: Int?

    var body: some View {
        VStack(spacing: 10) {
            Spacer()
            Text("\(value)")
                .font(.system(size: 220, weight: .semibold).width(.expanded))
                .monospacedDigit()
                .contentTransition(.numericText(countsDown: true))
                .animation(.default, value: value)
                .shadow(radius: 12)
            if let of { Text("of \(of)").eyebrowStyle(onDark: true) }
            Text(caption).titleStyle(18).multilineTextAlignment(.center)
            if let hint {
                Text(hint).font(Theme.body(20).weight(.semibold))
                    .padding(.horizontal, 16).padding(.vertical, 8)
                    .background(Theme.brown.opacity(0.8), in: Rectangle())
            }
            Spacer()
        }
    }
}

/// The eight stops round the turn: taken ones filled.
private struct StopDots: View {
    let taken: Int
    let total: Int

    var body: some View {
        HStack(spacing: 10) {
            ForEach(0..<total, id: \.self) { i in
                Circle()
                    .fill(i < taken ? Theme.cream : .clear)
                    .overlay(Circle().stroke(Theme.cream, lineWidth: 1))
                    .frame(width: 9, height: 9)
            }
        }
        .animation(.easeInOut, value: taken)
    }
}

/// Live camera picture so the person can frame themselves before walking away.
struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspectFill
        return view
    }

    func updateUIView(_ view: PreviewView, context: Context) {}

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
        override func layoutSubviews() {
            super.layoutSubviews()
            if let connection = previewLayer.connection, connection.isVideoRotationAngleSupported(90) {
                connection.videoRotationAngle = 90
            }
        }
    }
}

/// One instruction: icon, short title, a sentence; hairline below.
private struct IntroRow: View {
    let icon: String
    let title: String
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            Image(systemName: icon).font(.system(size: 20, weight: .light)).frame(width: 28)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.system(size: 15, weight: .semibold))
                Text(text).font(Theme.body(15)).lineSpacing(3).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .hairline(.bottom, onDark: true)
    }
}
