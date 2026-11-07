import SwiftUI
import WebKit
import AuthenticationServices

@main
struct BetterSpectrumApp: App {
    var body: some Scene { WindowGroup { PlannerView().ignoresSafeArea(.container, edges: .bottom) } }
}

struct PlannerView: UIViewRepresentable {
    static let planner = URL(string: "https://um-student-manager.campus-planner-a19743.workers.dev")!
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(context.coordinator, name: "spectrumLogin")
        let web = WKWebView(frame: .zero, configuration: configuration)
        context.coordinator.web = web
        web.navigationDelegate = context.coordinator
        web.load(URLRequest(url: Self.planner))
        return web
    }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        coordinator.authentication?.cancel()
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "spectrumLogin")
    }

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate, ASWebAuthenticationPresentationContextProviding {
        weak var web: WKWebView?
        var authentication: ASWebAuthenticationSession?

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.frameInfo.isMainFrame,
                  message.frameInfo.securityOrigin.protocol == "https",
                  message.frameInfo.securityOrigin.host == PlannerView.planner.host,
                  authentication == nil,
                  let body = message.body as? [String: String], let raw = body["url"],
                  let url = URL(string: raw), let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
                  url.scheme == "https", url.host == "spectrum.um.edu.my", url.port == nil,
                  url.user == nil, url.password == nil, url.fragment == nil,
                  url.path == "/admin/tool/mobile/launch.php",
                  components.queryItems?.first(where: { $0.name == "urlscheme" })?.value == "betterspectrumlogin",
                  components.queryItems?.first(where: { $0.name == "service" })?.value == "moodle_mobile_app",
                  web?.window != nil else { complete(nil); return }
            authentication = ASWebAuthenticationSession(url: url, callbackURLScheme: "betterspectrumlogin") { [weak self] callback, _ in
                DispatchQueue.main.async {
                    self?.authentication = nil
                    self?.complete(callback?.absoluteString)
                }
            }
            authentication?.presentationContextProvider = self
            // The university's own authentication page handles passwords and MFA.
            if authentication?.start() != true { authentication = nil; complete(nil) }
        }

        func complete(_ callback: String?) {
            guard let data = try? JSONSerialization.data(withJSONObject: [callback as Any? ?? NSNull()]),
                  let argument = String(data: data, encoding: .utf8) else { return }
            web?.evaluateJavaScript("window.completeSpectrumLogin(\(argument)[0])", completionHandler: nil)
        }

        func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
            web!.window!
        }

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
