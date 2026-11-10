import SwiftUI
import WebKit

@main
struct BetterSpectrumApp: App {
    var body: some Scene { WindowGroup { PlannerView().ignoresSafeArea(.container, edges: .bottom) } }
}

struct PlannerView: UIViewRepresentable {
    static let planner = URL(string: "https://um-student-manager.campus-planner-a19743.workers.dev")!
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        let web = WKWebView(frame: .zero, configuration: configuration)
        context.coordinator.web = web
        web.navigationDelegate = context.coordinator
        web.load(URLRequest(url: Self.planner))
        return web
    }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
    final class Coordinator: NSObject, WKNavigationDelegate {
        weak var web: WKWebView?

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
            if url.scheme == "https", url.host == PlannerView.planner.host, url.port == nil, url.user == nil, url.password == nil {
                decisionHandler(.allow)
            } else {
                decisionHandler(.cancel)
                if url.scheme == "https", navigationAction.navigationType == .linkActivated { UIApplication.shared.open(url) }
            }
        }
    }
}
