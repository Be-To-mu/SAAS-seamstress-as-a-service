import SwiftUI

/// Turns a garment through its views: drag sideways to rotate (wrapping round),
/// and it turns slowly by itself until touched. Missing angles show the nearest view drawn.
struct Turntable: View {
    let views: [Int: UIImage]
    var autoTurn = true

    @State private var index = 0
    @State private var dragStart: Int?
    @State private var touched = false

    private var angles: [Int] { DesignDraft.angles }

    var body: some View {
        ZStack {
            Theme.linen
            if let image = image(at: index) {
                Image(uiImage: image).resizable().scaledToFit().padding(12)
                    .transition(.opacity)
                    .id(index)
            }
        }
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 4)
                .onChanged { g in
                    touched = true
                    let start = dragStart ?? index
                    dragStart = start
                    // One view per 40 points of drag; dragging left turns the garment to show its left side.
                    let steps = Int((-g.translation.width / 40).rounded())
                    index = ((start + steps) % angles.count + angles.count) % angles.count
                }
                .onEnded { _ in dragStart = nil }
        )
        .overlay(alignment: .bottom) { dots.padding(.bottom, 12) }
        .task(id: autoTurn) {
            guard autoTurn else { return }
            while !Task.isCancelled && !touched {
                try? await Task.sleep(for: .seconds(1.6))
                if !touched, views.count > 1 {
                    withAnimation(.easeInOut(duration: 0.35)) { index = (index + 1) % angles.count }
                }
            }
        }
        .accessibilityLabel("Garment, drag sideways to turn it around")
    }

    private var dots: some View {
        HStack(spacing: 6) {
            ForEach(angles.indices, id: \.self) { i in
                Circle()
                    .fill(i == index ? Theme.brown : (views[angles[i]] == nil ? Theme.hairline : Theme.sand))
                    .frame(width: 5, height: 5)
            }
        }
    }

    /// The view at `i`, or the nearest angle that has been drawn.
    private func image(at i: Int) -> UIImage? {
        if let img = views[angles[i]] { return img }
        for d in 1..<angles.count {
            for j in [i - d, i + d] {
                let k = (j % angles.count + angles.count) % angles.count
                if let img = views[angles[k]] { return img }
            }
        }
        return nil
    }
}
