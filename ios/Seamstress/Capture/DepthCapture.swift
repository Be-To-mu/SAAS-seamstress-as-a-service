import AVFoundation

enum CaptureError: LocalizedError {
    case noLiDAR, noDepthFormat, cannotAdd

    var errorDescription: String? {
        switch self {
        case .noLiDAR: "This iPhone has no LiDAR camera."
        case .noDepthFormat: "The LiDAR camera offers no usable depth format."
        case .cannotAdd: "Could not set up the camera."
        }
    }
}

/// Synchronised colour + LiDAR depth from the back camera, in the sensor's native
/// (landscape) orientation. Orientation and gravity are sorted out by bodyfit.
final class DepthCapture: NSObject, AVCaptureDataOutputSynchronizerDelegate {
    let session = AVCaptureSession()
    private let videoOutput = AVCaptureVideoDataOutput()
    private let depthOutput = AVCaptureDepthDataOutput()
    private var synchronizer: AVCaptureDataOutputSynchronizer?
    private let queue = DispatchQueue(label: "depth-capture")

    /// Called on the capture queue for every synchronised frame.
    var onFrame: ((CVPixelBuffer, AVDepthData, CMTime) -> Void)?

    func configure() throws {
        guard let device = AVCaptureDevice.default(.builtInLiDARDepthCamera, for: .video, position: .back) else {
            throw CaptureError.noLiDAR
        }
        session.beginConfiguration()
        defer { session.commitConfiguration() }
        session.sessionPreset = .inputPriority

        let input = try AVCaptureDeviceInput(device: device)
        guard session.canAddInput(input) else { throw CaptureError.cannotAdd }
        session.addInput(input)

        // 4:3 video around 1920 wide with Float32 depth; take the largest depth map.
        let withDepth = device.formats.filter { format in
            format.supportedDepthDataFormats.contains { $0.mediaSubType == kCVPixelFormatType_DepthFloat32 }
        }
        let format = withDepth.first { $0.dimensions == (1920, 1440) } ?? withDepth.last
        guard let format,
              let depthFormat = format.supportedDepthDataFormats
                  .filter({ $0.mediaSubType == kCVPixelFormatType_DepthFloat32 })
                  .max(by: { $0.dimensions.0 < $1.dimensions.0 })
        else { throw CaptureError.noDepthFormat }

        try device.lockForConfiguration()
        device.activeFormat = format
        device.activeDepthDataFormat = depthFormat
        device.unlockForConfiguration()

        videoOutput.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        videoOutput.alwaysDiscardsLateVideoFrames = true
        depthOutput.isFilteringEnabled = true  // Apple's temporal smoothing + hole filling
        depthOutput.alwaysDiscardsLateDepthData = true
        guard session.canAddOutput(videoOutput), session.canAddOutput(depthOutput) else { throw CaptureError.cannotAdd }
        session.addOutput(videoOutput)
        session.addOutput(depthOutput)

        synchronizer = AVCaptureDataOutputSynchronizer(dataOutputs: [videoOutput, depthOutput])
        synchronizer?.setDelegate(self, queue: queue)
    }

    func start() { queue.async { self.session.startRunning() } }
    func stop() { queue.async { self.session.stopRunning() } }

    func dataOutputSynchronizer(_ synchronizer: AVCaptureDataOutputSynchronizer,
                                didOutput collection: AVCaptureSynchronizedDataCollection) {
        guard let video = collection.synchronizedData(for: videoOutput) as? AVCaptureSynchronizedSampleBufferData,
              !video.sampleBufferWasDropped,
              let depth = collection.synchronizedData(for: depthOutput) as? AVCaptureSynchronizedDepthData,
              !depth.depthDataWasDropped,
              let pixels = CMSampleBufferGetImageBuffer(video.sampleBuffer)
        else { return }
        onFrame?(pixels, depth.depthData, video.timestamp)
    }
}

private extension AVCaptureDevice.Format {
    var mediaSubType: FourCharCode { CMFormatDescriptionGetMediaSubType(formatDescription) }
    var dimensions: (Int32, Int32) {
        let d = CMVideoFormatDescriptionGetDimensions(formatDescription)
        return (d.width, d.height)
    }
}
