import AVFoundation
import SwiftUI

/// Full-screen camera with the scan instructions on top. The camera stays open
/// from the first screen to the end of the turn; numbers are huge so they can be
/// read from where the person stands, and everything is spoken too.
struct ScanView: View {
    @StateObject private var session = ScanSession()
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
        case .countdown, .positioning, .recording: true
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
        case .recording(let seconds, let progress):
            VStack {
                BigNumber(value: seconds, caption: "Keep turning slowly to your left",
                          hint: session.advice == .good ? nil : adviceText)
                ProgressView(value: progress).tint(Theme.linen)
                Button("Stop") { session.stopEarly() }
                    .buttonStyle(TailoredButtonStyle(filled: false)).frame(width: 160).padding(.top)
                    .colorScheme(.dark)
            }
        case .saving:
            ProgressView("Saving…").tint(Theme.cream).frame(maxHeight: .infinity)
        case .done:
            Text("Saved").titleStyle().frame(maxHeight: .infinity)
        case .failed(let message):
            VStack(spacing: 16) {
                Spacer()
                Text(message).font(Theme.body(17))
                Button("Close") { onClose(nil) }.buttonStyle(TailoredButtonStyle())
            }
        }
    }

    private var intro: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Monogram(size: 40)
                Spacer()
                if canCancel {
                    Button { onClose(nil) } label: { Image(systemName: "xmark").font(.title3) }
                }
            }
            Text("Scan your body").titleStyle(28)
            Text("made to measure").subtitleStyle()
            Spacer()
            HStack(alignment: .center, spacing: 18) {
                APoseFigure().frame(height: 150)
                VStack(alignment: .leading, spacing: 6) {
                    Text("Arms straight, a little out to the sides, like an upside-down V.")
                    Text("Hands empty, palms towards your legs.").opacity(0.8)
                }
                .font(Theme.body(15))
            }
            VStack(alignment: .leading, spacing: 8) {
                Label("Wear tight clothing; tie long hair up.", systemImage: "tshirt")
                Label("Phone upright at waist height, in open space.", systemImage: "iphone")
                Label("Stand about 2 m away, whole body in view.", systemImage: "figure.stand")
                Label("Turn slowly to your left for 20 seconds.", systemImage: "arrow.counterclockwise")
            }
            .font(Theme.body(14))
            Button("Start") { session.begin() }
                .buttonStyle(TailoredButtonStyle())
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

    var body: some View {
        VStack(spacing: 10) {
            Spacer()
            Text("\(value)")
                .font(.system(size: 220, weight: .semibold).width(.expanded))
                .monospacedDigit()
                .contentTransition(.numericText(countsDown: true))
                .animation(.default, value: value)
                .shadow(radius: 12)
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
