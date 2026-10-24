import AVFoundation
import SwiftUI

struct ScanView: View {
    @StateObject private var session: ScanSession
    let onClose: (URL?) -> Void

    init(ageYears: Double, onClose: @escaping (URL?) -> Void) {
        _session = StateObject(wrappedValue: ScanSession(ageYears: ageYears))
        self.onClose = onClose
    }

    var body: some View {
        ZStack {
            CameraPreview(session: session.capture.session).ignoresSafeArea()
            VStack {
                Spacer()
                panel
                    .padding()
                    .frame(maxWidth: .infinity)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 20))
                    .padding()
            }
        }
        .onAppear { session.prepare() }
        .onDisappear { session.shutdown() }
        .onChange(of: session.phase) { _, phase in
            if case .done(let folder) = phase { onClose(folder) }
        }
    }

    @ViewBuilder private var panel: some View {
        switch session.phase {
        case .idle:
            VStack(spacing: 12) {
                Text("Stand the phone upright at waist height. You'll have 10 seconds to walk about 2 m away. "
                    + "Start facing the phone with your arms slightly out, then turn slowly to your left, all the way round.")
                    .font(.callout)
                HStack {
                    Button("Cancel") { onClose(nil) }
                    Spacer()
                    Button("Start") { session.begin() }.buttonStyle(.borderedProminent)
                }
            }
        case .countdown(let s):
            Text("\(s)").font(.system(size: 80, weight: .bold)).monospacedDigit()
        case .recording(let progress):
            VStack(spacing: 8) {
                ProgressView(value: progress)
                Text("Turn slowly to your left · \(session.frames) frames")
                Button("Stop", role: .destructive) { session.stopEarly() }
            }
        case .saving:
            ProgressView("Saving…")
        case .done:
            Text("Saved")
        case .failed(let message):
            VStack(spacing: 12) {
                Text(message).foregroundStyle(.red)
                Button("Close") { onClose(nil) }
            }
        }
    }
}

/// Live camera picture so the person can frame themselves before walking away.
struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspect
        return view
    }

    func updateUIView(_ view: PreviewView, context: Context) {
        if let connection = view.previewLayer.connection, connection.isVideoRotationAngleSupported(90) {
            connection.videoRotationAngle = 90
        }
    }

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
