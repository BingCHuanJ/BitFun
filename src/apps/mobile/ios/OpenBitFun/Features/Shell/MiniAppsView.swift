import SwiftUI
import WebKit

struct MiniAppsButton: View {
    @ObservedObject var model: MobileAppModel
    @State private var open = false
    var body: some View {
        Button(model.localized("小应用")) { open = true }
            .frame(minHeight: 44)
            .sheet(isPresented: $open) { MiniAppsView(model: model) }
    }
}

private struct BuiltinMiniApp: Identifiable, Decodable {
    struct Copy: Decodable { let name: String; let description: String }
    let id: String
    let locales: [String: Copy]
}

private struct MiniAppsView: View {
    @ObservedObject var model: MobileAppModel
    @Environment(\.dismiss) private var dismiss
    @State private var apps: [BuiltinMiniApp] = []
    @State private var selected: BuiltinMiniApp?
    @State private var failure: String?
    private var locale: String { model.appLanguage == .english ? "en-US" : "zh-CN" }

    var body: some View {
        NavigationStack {
            Group {
                if let selected {
                    MiniAppWebView(appID: selected.id, locale: locale).id("\(selected.id)|\(locale)")
                } else if let failure {
                    Text(failure).padding()
                } else {
                    ScrollView {
                        LazyVStack(spacing: 12) {
                            ForEach(apps) { app in
                                let copy = app.locales[locale] ?? app.locales["en-US"]
                                Button { selected = app } label: {
                                    VStack(alignment: .leading, spacing: 8) {
                                        Text(copy?.name ?? app.id).font(MobileDesignTypography.titleSmall.font)
                                        Text(copy?.description ?? "").font(MobileDesignTypography.bodyMedium.font)
                                    }.frame(maxWidth: .infinity, alignment: .leading).padding(20)
                                        .background(OpenBitFunTheme.soft).clipShape(RoundedRectangle(cornerRadius: 16))
                                }.buttonStyle(.plain)
                            }
                        }.padding(16)
                    }
                }
            }
            .background(OpenBitFunTheme.page)
            .navigationTitle(model.localized("小应用"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if selected != nil { Button(model.localized("返回")) { selected = nil } }
                }
                ToolbarItem(placement: .topBarTrailing) { Button(model.localized("关闭")) { dismiss() } }
            }
            .task {
                do {
                    guard let url = Bundle.main.url(forResource: "catalog", withExtension: "json", subdirectory: "MiniApps") else {
                        throw CocoaError(.fileNoSuchFile)
                    }
                    apps = try JSONDecoder().decode([BuiltinMiniApp].self, from: Data(contentsOf: url))
                } catch { failure = model.localized("无法加载小应用，请重试") }
            }
        }
    }
}

private struct MiniAppWebView: UIViewRepresentable {
    let appID: String
    let locale: String
    func makeCoordinator() -> Coordinator { Coordinator(appID: appID) }
    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.userContentController.add(context.coordinator, name: "miniappNative")
        let web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = context.coordinator
        context.coordinator.web = web
        if let url = Bundle.main.url(forResource: "\(appID).\(locale)", withExtension: "html", subdirectory: "MiniApps"),
           let html = try? String(contentsOf: url, encoding: .utf8) {
            web.loadHTMLString(html, baseURL: URL(string: "https://miniapp.local/"))
        }
        return web
    }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        uiView.stopLoading()
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "miniappNative")
        uiView.navigationDelegate = nil
    }

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        let appID: String
        weak var web: WKWebView?
        private static let storageQueue = DispatchQueue(label: "com.openbitfun.miniapps.storage")
        init(appID: String) { self.appID = appID }
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            let url = navigationAction.request.url
            // Only our initial document and its isolated blob frame may navigate.
            decisionHandler(url?.scheme == "blob" || url?.absoluteString == "about:blank" ||
                (url?.absoluteString == "https://miniapp.local/" && navigationAction.navigationType == .other) ? .allow : .cancel)
        }
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.frameInfo.isMainFrame,
                  let raw = message.body as? String, let data = raw.data(using: .utf8),
                  let request = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let id = request["id"] as? String,
                  let method = request["method"] as? String,
                  let params = request["params"] as? [String: Any] else { return }
            if method == "clipboard.writeText", let text = params["text"] as? String {
                UIPasteboard.general.string = text
                respond(id: id, result: NSNull(), error: nil)
                return
            }
            Self.storageQueue.async { [self] in
                do {
                    let key = params["key"] as? String
                    let allowed = ["builtin-gomoku": "stats", "builtin-regex-playground": "regex-state", "builtin-daily-divination": "lastReading"]
                    guard let key, key == allowed[self.appID], ["storage.get", "storage.set"].contains(method) else {
                        throw CocoaError(.featureUnsupported)
                    }
                    let directory = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("miniapps", isDirectory: true)
                    let file = directory.appendingPathComponent("\(self.appID)-\(key).json")
                    var result: Any = NSNull()
                    if method == "storage.get" {
                        if FileManager.default.fileExists(atPath: file.path) {
                            result = try JSONSerialization.jsonObject(with: Data(contentsOf: file), options: [.fragmentsAllowed])
                        }
                    } else {
                        let bytes = try JSONSerialization.data(withJSONObject: params["value"] ?? NSNull(), options: [.fragmentsAllowed])
                        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                        try bytes.write(to: file, options: .atomic)
                    }
                    DispatchQueue.main.async { self.respond(id: id, result: result, error: nil) }
                } catch {
                    DispatchQueue.main.async { self.respond(id: id, result: NSNull(), error: error.localizedDescription) }
                }
            }
        }
        private func respond(id: String, result: Any, error: String?) {
            var response: [String: Any] = ["id": id, "result": result]
            if let error { response["error"] = ["message": error] }
            guard let data = try? JSONSerialization.data(withJSONObject: response, options: [.fragmentsAllowed]),
                  let json = String(data: data, encoding: .utf8) else { return }
            web?.evaluateJavaScript("window.__miniappReply(\(json))", completionHandler: nil)
        }
    }
}
