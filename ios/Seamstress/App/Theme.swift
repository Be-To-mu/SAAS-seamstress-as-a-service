import SwiftUI

/// Aesop-like restraint: a warm cream canvas, soft graphite type, taupe tiles,
/// hairlines instead of shadows, square corners, a serif only for headings.
/// (Names are kept from the first theme so every screen follows the palette.)
enum Theme {
    /// Page background.
    static let cream = Color(red: 0.965, green: 0.957, blue: 0.925)  // #F6F4EC
    /// Tiles behind photos and products.
    static let linen = Color(red: 0.922, green: 0.902, blue: 0.851)  // #EBE6D9
    /// Secondary text and hairlines.
    static let sand = Color(red: 0.55, green: 0.52, blue: 0.47)  // #8C8577
    /// Primary text and filled buttons: warm graphite, never pure black.
    static let brown = Color(red: 0.20, green: 0.20, blue: 0.20)  // #333333
    static let ink = Color(red: 0.145, green: 0.145, blue: 0.145)  // #252525
    /// The one warm accent, used sparingly.
    static let accent = Color(red: 0.58, green: 0.36, blue: 0.15)  // #945C26
    static let hairline = Color(red: 0.84, green: 0.82, blue: 0.77)  // #D6D2C4

    /// Headings: a quiet serif, lighter as it gets larger.
    static func display(_ size: CGFloat) -> Font {
        .system(size: size, weight: size >= 26 ? .light : .regular, design: .serif)
    }
    /// Everything else: plain grotesque sans.
    static func body(_ size: CGFloat = 15) -> Font { .system(size: size, weight: .regular) }
}

extension View {
    /// Small secondary line under a heading.
    func subtitleStyle(_ size: CGFloat = 13) -> some View {
        font(.system(size: size, weight: .regular)).foregroundStyle(Theme.sand)
    }

    /// Serif heading, sentence case, set a touch tight like a label.
    func titleStyle(_ size: CGFloat = 26) -> some View {
        font(Theme.display(size)).tracking(size >= 26 ? -0.4 : 0)
    }

    /// The small spaced capitals above a heading ("MADE TO MEASURE").
    func eyebrowStyle(onDark: Bool = false) -> some View {
        font(.system(size: 11, weight: .medium)).tracking(1.8).textCase(.uppercase)
            .foregroundStyle(onDark ? Theme.cream.opacity(0.8) : Theme.sand)
    }

    /// A full-width hairline.
    func hairline(_ edge: VerticalEdge = .bottom, onDark: Bool = false) -> some View {
        overlay(alignment: edge == .top ? .top : .bottom) {
            (onDark ? Theme.cream.opacity(0.35) : Theme.hairline).frame(height: 0.5)
        }
    }

    /// Pictures arrive with a soft fade rather than popping in.
    func arrives() -> some View { transition(.opacity.animation(.easeInOut(duration: 0.45))) }
}

/// Square graphite button with cream text (cream with graphite text over the camera);
/// outlined variant with a hairline. A light tap is felt when pressed.
struct TailoredButtonStyle: ButtonStyle {
    var filled = true
    var onDark = false

    func makeBody(configuration: Configuration) -> some View {
        let ink = onDark ? Theme.cream : Theme.brown
        let paper = onDark ? Theme.ink : Theme.cream
        return configuration.label
            .font(.system(size: 15, weight: .medium)).tracking(0.4)
            .padding(.horizontal, 20)
            .frame(maxWidth: .infinity, minHeight: 54)
            .foregroundStyle(filled ? paper : ink)
            .background(filled ? ink : Color.clear)
            .overlay(Rectangle().stroke(ink, lineWidth: filled ? 0 : 0.75))
            .opacity(configuration.isPressed ? 0.72 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
            .sensoryFeedback(.impact(weight: .light, intensity: 0.6), trigger: configuration.isPressed) { _, pressed in pressed }
    }
}

/// A thin circle with a serif S: the app's mark (also the app icon).
struct Monogram: View {
    var size: CGFloat = 64
    var color: Color = Theme.cream

    var body: some View {
        ZStack {
            Circle().stroke(color, lineWidth: max(0.75, size / 90))
            Text("S")
                .font(.system(size: size * 0.5, weight: .light, design: .serif))
                .foregroundStyle(color)
        }
        .frame(width: size, height: size)
    }
}

/// Waiting, made quiet: the monogram with a fine line drawing round it.
struct AtelierProgress: View {
    var size: CGFloat = 64
    var color: Color = Theme.brown
    var caption: String?

    @State private var turn = false

    var body: some View {
        VStack(spacing: 16) {
            ZStack {
                Monogram(size: size, color: color.opacity(0.35))
                Circle()
                    .trim(from: 0, to: 0.22)
                    .stroke(color, style: StrokeStyle(lineWidth: max(1, size / 60), lineCap: .round))
                    .frame(width: size, height: size)
                    .rotationEffect(.degrees(turn ? 360 : 0))
                    .animation(.linear(duration: 1.6).repeatForever(autoreverses: false), value: turn)
            }
            if let caption {
                Text(caption).font(Theme.body(14)).foregroundStyle(color).multilineTextAlignment(.center)
            }
        }
        .onAppear { turn = true }
    }
}

/// Where a picture will be: taupe ground with the monogram.
struct MonogramPlaceholder: View {
    var body: some View {
        Theme.linen.overlay(Monogram(size: 44, color: Theme.sand.opacity(0.7)))
    }
}

/// How to stand: a simple figure with the arms out like an upside-down V.
struct APoseFigure: View {
    var color: Color = Theme.cream

    var body: some View {
        Canvas { ctx, size in
            let w = size.width, h = size.height
            let line = StrokeStyle(lineWidth: max(1.5, w / 50), lineCap: .round, lineJoin: .round)
            let head = CGRect(x: w * 0.42, y: h * 0.02, width: w * 0.16, height: w * 0.16)
            ctx.stroke(Path(ellipseIn: head), with: .color(color), style: line)
            let neck = CGPoint(x: w * 0.5, y: head.maxY + h * 0.02)
            let hip = CGPoint(x: w * 0.5, y: h * 0.55)
            var body = Path()
            body.move(to: neck); body.addLine(to: hip)
            // Arms: straight, ~40° out from the body.
            let shoulder = CGPoint(x: w * 0.5, y: neck.y + h * 0.05)
            body.move(to: CGPoint(x: w * 0.16, y: h * 0.52)); body.addLine(to: shoulder)
            body.addLine(to: CGPoint(x: w * 0.84, y: h * 0.52))
            // Legs, slightly apart.
            body.move(to: CGPoint(x: w * 0.36, y: h * 0.98)); body.addLine(to: hip)
            body.addLine(to: CGPoint(x: w * 0.64, y: h * 0.98))
            ctx.stroke(body, with: .color(color), style: line)
            // Dashed hint of the angle between arm and body.
            var arc = Path()
            arc.addArc(center: shoulder, radius: h * 0.2, startAngle: .degrees(90), endAngle: .degrees(130), clockwise: false)
            ctx.stroke(arc, with: .color(color.opacity(0.6)), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
        }
        .aspectRatio(0.62, contentMode: .fit)
    }
}

extension View {
    /// Plain list rows sit on the cream page, separated by hairlines.
    func listRowBackgroundCream() -> some View {
        environment(\.defaultMinListRowHeight, 52)
            .tint(Theme.brown)
            .background(Theme.cream)
    }
}

extension String {
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }

    /// Descriptions name the cloth colour as a hex code ("in colour #f49ac2"); people don't need that.
    var withoutColourCodes: String {
        replacingOccurrences(of: #"\s*(in )?colou?r\s*#[0-9a-fA-F]{6}"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\s*#[0-9a-fA-F]{6}"#, with: "", options: .regularExpression)
    }
}
