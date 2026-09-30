import AppKit
import ApplicationServices
import Carbon
import Foundation

// Lately menu-bar recorder. The event tap is listen-only. Password fields are not stored.
// Control-Option-C asks the local model to finish the saved goal, or stops control if it is running.
// Stop also posts OpenWork's computer-use stop notification so the helper panel releases the session.

private let hotKeySignature: OSType = 0x4C415445

private func hotkeyCallback(nextHandler: EventHandlerCallRef?, event: EventRef?, userData: UnsafeMutableRawPointer?) -> OSStatus {
    DispatchQueue.main.async { AppDelegate.shared?.onHotkey() }
    return noErr
}

private func eventTapCallback(proxy: CGEventTapProxy, type: CGEventType, event: CGEvent, userInfo: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let tap = AppDelegate.shared?.tap {
            CGEvent.tapEnable(tap: tap, enable: true)
        }
        return Unmanaged.passUnretained(event)
    }
    AppDelegate.shared?.record(type: type, event: event)
    return Unmanaged.passUnretained(event)
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    static var shared: AppDelegate?
    let writeQueue = DispatchQueue(label: "lately.events")
    let stamp: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    var env: [String: String] = [:]
    var statusItem: NSStatusItem?
    var tap: CFMachPort?
    var hotKey: EventHotKeyRef?
    var hotHandler: EventHandlerRef?
    var recording = false
    var controlling = false
    var deciding = false
    var controlProcess: Process?
    var refreshProcess: Process?
    var adoptedPid: Int32 = 0
    var logHandle: FileHandle?
    var menuSignature = ""
    var ticks = 0
    var focusedSecure = false
    var secureBurst = false
    var typed = ""
    var lastTypeAt = Date.distantPast
    var lastPointerAt = Date.distantPast
    var lastBundle = ""
    var lastTitle = ""
    var lastDoc = ""
    var lastURL = ""
    var lastClipboard = NSPasteboard.general.changeCount
    var urlFetchInFlight = false
    var lastGoalError = ""

    override init() {
        super.init()
        AppDelegate.shared = self
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        loadEnv()
        let trusted = AXIsProcessTrusted()
        recording = trusted
        installTap()
        if tap == nil { recording = false }
        writeRecording()
        registerHotkey()
        adoptControl()
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.font = NSFont.menuBarFont(ofSize: 0)
        statusItem = item
        updateMenu(force: true)
        if !trusted || !CGPreflightScreenCaptureAccess() {
            notify("Lately needs Accessibility (listen-only event tap), Screen Recording, and Automation. Open the Lately menu to allow each one. Nothing is uploaded.")
        }
        Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            self?.tick()
        }
        if recording { refreshIfNeeded() }
    }

    func applicationWillTerminate(_ notification: Notification) {
        if controlling { hardStop(announce: false) }
    }

    func loadEnv() {
        let url = Bundle.main.bundleURL.deletingLastPathComponent().appendingPathComponent("lately.env")
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { return }
        for line in text.split(separator: "\n") {
            let parts = line.split(separator: "=", maxSplits: 1).map(String.init)
            if parts.count == 2 { env[parts[0]] = parts[1] }
        }
    }

    var root: String {
        env["LATELY_ROOT"] ?? ProcessInfo.processInfo.environment["LATELY_ROOT"] ?? FileManager.default.currentDirectoryPath
    }

    var node: String {
        env["LATELY_NODE"] ?? ProcessInfo.processInfo.environment["LATELY_NODE"] ?? "/usr/bin/env"
    }

    var support: URL {
        if let override = ProcessInfo.processInfo.environment["LATELY_SUPPORT_DIR"], !override.isEmpty {
            let url = URL(fileURLWithPath: override, isDirectory: true)
            try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
            return url
        }
        let url = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Lately", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    func tick() {
        ticks += 1
        pollClipboard()
        if ticks % 2 == 0 { pollContext() }
        if ticks % 15 == 0 { refreshIfNeeded() }
        flushTypedIfIdle()
        noteGoalError()
        updateMenu(force: false)
    }

    func registerHotkey() {
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), hotkeyCallback, 1, &spec, nil, &hotHandler)
        let id = EventHotKeyID(signature: hotKeySignature, id: 1)
        let modifiers = UInt32(controlKey | optionKey)
        let status = RegisterEventHotKey(UInt32(kVK_ANSI_C), modifiers, id, GetApplicationEventTarget(), 0, &hotKey)
        if status != noErr {
            notify("Lately could not register Control-Option-C (\(status)).")
        }
    }

    func installTap() {
        let types: [CGEventType] = [
            .leftMouseDown, .rightMouseDown, .otherMouseDown,
            .mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged,
            .scrollWheel, .keyDown,
        ]
        var bits: UInt64 = 0
        for type in types { bits |= 1 << UInt64(type.rawValue) }
        guard let created = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,
            eventsOfInterest: CGEventMask(bits),
            callback: eventTapCallback,
            userInfo: nil
        ) else {
            tap = nil
            return
        }
        tap = created
        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, created, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: created, enable: recording)
    }

    func onHotkey() {
        if controlling {
            hardStop(announce: false)
            notify("Control stopped.")
            return
        }
        if deciding { return }
        deciding = true
        _ = runNode(script: "context/shortcut.mjs", capture: true) { [weak self] code, data in
            guard let self else { return }
            self.deciding = false
            guard code == 0 || !data.isEmpty,
                  let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                self.notify("Lately could not read the goal, so it will not act.")
                return
            }
            let body = object["notification"] as? String ?? "Lately will not act."
            self.notify(body)
            if object["action"] as? String == "start" {
                self.startControl()
            }
            self.updateMenu(force: true)
        }
    }

    func startControl() {
        guard !controlling else { return }
        try? FileManager.default.removeItem(at: support.appendingPathComponent("stop.request"))
        guard let process = makeProcess(script: "context/control.mjs", capture: false, announceAbort: false) else {
            notify("Lately could not start control.")
            return
        }
        controlling = true
        adoptedPid = 0
        controlProcess = process
        process.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                self?.controlling = false
                self?.controlProcess = nil
                self?.updateMenu(force: true)
            }
        }
        do {
            try process.run()
        } catch {
            controlling = false
            controlProcess = nil
            notify("Lately could not start control.")
        }
        updateMenu(force: true)
    }

    func hardStop(announce: Bool) {
        controlling = false
        let stop = support.appendingPathComponent("stop.request")
        try? Data("stop\n".utf8).write(to: stop)
        DistributedNotificationCenter.default().postNotificationName(
            Notification.Name("com.differentai.openwork.computer-use.stop"),
            object: nil,
            userInfo: nil,
            deliverImmediately: true
        )
        let process = controlProcess
        let adopted = adoptedPid
        killHelper()
        if let process, process.isRunning {
            process.terminate()
            DispatchQueue.global().asyncAfter(deadline: .now() + 0.7) {
                if process.isRunning { kill(process.processIdentifier, SIGKILL) }
            }
        } else if adopted > 0 {
            kill(adopted, SIGTERM)
            DispatchQueue.global().asyncAfter(deadline: .now() + 0.7) {
                if kill(adopted, 0) == 0 { kill(adopted, SIGKILL) }
            }
        }
        adoptedPid = 0
        controlProcess = nil
        writeJSON(["controlling": false, "status": "Idle"], to: support.appendingPathComponent("control.json"))
        updateMenu(force: true)
        if announce { notify("Control stopped.") }
    }

    func setRecording(_ on: Bool) {
        if on && tap == nil {
            installTap()
            if tap == nil {
                notify("Accessibility is still off, so Lately cannot record. Use the menu to allow it. The event tap is listen-only.")
                updateMenu(force: true)
                return
            }
        }
        recording = on
        if let tap { CGEvent.tapEnable(tap: tap, enable: on) }
        writeRecording()
        if !on {
            flushTyped()
            if controlling {
                hardStop(announce: false)
                notify("Control stopped.")
            }
        } else {
            refreshIfNeeded()
        }
        updateMenu(force: true)
    }

    func adoptControl() {
        let url = support.appendingPathComponent("control.json")
        guard let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              json["controlling"] as? Bool == true else { return }
        let pid = (json["pid"] as? NSNumber)?.int32Value ?? 0
        guard pid > 0, kill(pid, 0) == 0 else { return }
        controlling = true
        adoptedPid = pid
    }

    func killHelper() {
        let url = support.appendingPathComponent("control.json")
        guard let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        let pid = (json["helperPid"] as? NSNumber)?.int32Value ?? 0
        guard pid > 0 else { return }
        kill(pid, SIGTERM)
    }

    func record(type: CGEventType, event: CGEvent) {
        guard recording else { return }
        switch type {
        case .mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged:
            let point = event.location
            DispatchQueue.main.async { [weak self] in self?.commitPointer(point, kind: "pointer", button: nil) }
        case .leftMouseDown:
            let point = event.location
            DispatchQueue.main.async { [weak self] in self?.commitPointer(point, kind: "click", button: "left") }
        case .rightMouseDown:
            let point = event.location
            DispatchQueue.main.async { [weak self] in self?.commitPointer(point, kind: "click", button: "right") }
        case .otherMouseDown:
            let point = event.location
            DispatchQueue.main.async { [weak self] in self?.commitPointer(point, kind: "click", button: "other") }
        case .scrollWheel:
            let point = event.location
            DispatchQueue.main.async { [weak self] in self?.commitPointer(point, kind: "scroll", button: nil) }
        case .keyDown:
            let code = UInt16(event.getIntegerValueField(.keyboardEventKeycode))
            let flags = event.flags
            let text = characters(of: event)
            DispatchQueue.main.async { [weak self] in self?.commitKey(code: code, flags: flags, text: text) }
        default:
            break
        }
    }

    func commitPointer(_ point: CGPoint, kind: String, button: String?) {
        guard recording else { return }
        if kind == "pointer" {
            let now = Date()
            if now.timeIntervalSince(lastPointerAt) < 0.25 { return }
            lastPointerAt = now
        }
        var payload: [String: Any] = ["type": kind, "x": Int(point.x), "y": Int(point.y)]
        if let button { payload["button"] = button }
        append(payload)
    }

    func commitKey(code: UInt16, flags: CGEventFlags, text: String) {
        guard recording else { return }
        refreshSecureFlag()
        if focusedSecure {
            if !secureBurst {
                secureBurst = true
                typed = ""
                append(["type": "text", "op": "typed", "hidden": true, "reason": "password"])
            }
            return
        }
        secureBurst = false
        let modified = flags.contains(.maskCommand) || flags.contains(.maskControl) || flags.contains(.maskAlternate)
        if code == 51 || code == 117 {
            if typed.isEmpty {
                append(["type": "text", "op": "deleted", "count": 1])
            } else {
                let removed = String(typed.removeLast())
                append(["type": "text", "op": "deleted", "text": removed])
            }
            return
        }
        if code == 36 || code == 76 {
            flushTyped()
            append(["type": "key", "key": "return"])
            return
        }
        if modified {
            var payload: [String: Any] = ["type": "key", "key": keyName(code)]
            if flags.contains(.maskCommand) { payload["command"] = true }
            if flags.contains(.maskAlternate) { payload["option"] = true }
            if flags.contains(.maskControl) { payload["control"] = true }
            append(payload)
            return
        }
        guard !text.isEmpty, text.unicodeScalars.allSatisfy({ $0.value >= 32 }) else { return }
        typed += text
        lastTypeAt = Date()
        if text == " " || typed.count >= 80 { flushTyped() }
    }

    func flushTypedIfIdle() {
        guard !typed.isEmpty, Date().timeIntervalSince(lastTypeAt) > 1 else { return }
        flushTyped()
    }

    func flushTyped() {
        let value = typed
        typed = ""
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { append(["type": "text", "op": "typed", "text": value]) }
    }

    func pollClipboard() {
        guard recording else { return }
        let board = NSPasteboard.general
        guard board.changeCount != lastClipboard else { return }
        lastClipboard = board.changeCount
        refreshSecureFlag()
        if focusedSecure {
            append(["type": "clipboard", "hidden": true, "reason": "password"])
            return
        }
        guard let text = board.string(forType: .string), !text.isEmpty else { return }
        append(["type": "clipboard", "text": String(text.prefix(2000))])
    }

    func pollContext() {
        guard recording, let app = NSWorkspace.shared.frontmostApplication else { return }
        let name = app.localizedName ?? "unknown"
        let bundle = app.bundleIdentifier ?? ""
        let pid = app.processIdentifier
        if bundle != lastBundle {
            lastBundle = bundle
            lastTitle = ""
            lastDoc = ""
            lastURL = ""
            append(["type": "frontmost", "app": name, "bundleId": bundle, "pid": Int(pid)])
        }
        let ax = AXUIElementCreateApplication(pid)
        focusedSecure = secureElement(ax)
        if !focusedSecure { secureBurst = false }
        var window: CFTypeRef?
        if AXUIElementCopyAttributeValue(ax, kAXFocusedWindowAttribute as CFString, &window) == .success,
           let window, let element = axElement(window) {
            if let title = copyString(element, kAXTitleAttribute), title != lastTitle {
                lastTitle = title
                append(["type": "window", "app": name, "title": title])
            }
            if let doc = copyString(element, kAXDocumentAttribute), doc != lastDoc {
                lastDoc = doc
                let path = doc.hasPrefix("file://") ? (URL(string: doc)?.path ?? doc) : doc
                append(["type": "file", "app": name, "path": path])
            }
        }
        if let browser = browserName(bundle) {
            fetchURL(appName: browser.name, kind: browser.kind)
        }
    }

    func fetchURL(appName: String, kind: String) {
        guard !urlFetchInFlight else { return }
        urlFetchInFlight = true
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let source = kind == "safari"
                ? "tell application \"\(appName)\" to get URL of front document"
                : "tell application \"\(appName)\" to get URL of active tab of front window"
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
            process.arguments = ["-e", source]
            let pipe = Pipe()
            process.standardOutput = pipe
            process.standardError = FileHandle.nullDevice
            try? process.run()
            process.waitUntilExit()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            let url = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            DispatchQueue.main.async {
                guard let self else { return }
                self.urlFetchInFlight = false
                guard self.recording, url.hasPrefix("http"), url != self.lastURL else { return }
                self.lastURL = url
                self.append(["type": "url", "app": appName, "url": url])
            }
        }
    }

    func refreshSecureFlag() {
        guard let app = NSWorkspace.shared.frontmostApplication else {
            focusedSecure = false
            return
        }
        focusedSecure = secureElement(AXUIElementCreateApplication(app.processIdentifier))
    }

    func secureElement(_ app: AXUIElement) -> Bool {
        var focused: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute as CFString, &focused) == .success,
              let focused, let element = axElement(focused) else { return false }
        let sub = copyString(element, kAXSubroleAttribute) ?? ""
        let role = copyString(element, kAXRoleAttribute) ?? ""
        let desc = (copyString(element, kAXDescriptionAttribute) ?? "").lowercased()
        if sub == "AXSecureTextField" || sub.lowercased().contains("secure") { return true }
        if role == "AXTextField" && desc.contains("password") { return true }
        return false
    }

    func axElement(_ value: CFTypeRef) -> AXUIElement? {
        guard CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
        return (value as! AXUIElement)
    }

    func copyString(_ element: AXUIElement, _ attribute: String) -> String? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else { return nil }
        return value as? String
    }

    func browserName(_ bundle: String) -> (name: String, kind: String)? {
        switch bundle {
        case "com.apple.Safari": return ("Safari", "safari")
        case "com.google.Chrome": return ("Google Chrome", "chromium")
        case "com.google.Chrome.canary": return ("Google Chrome Canary", "chromium")
        case "com.brave.Browser": return ("Brave Browser", "chromium")
        case "company.thebrowser.Browser": return ("Arc", "chromium")
        case "com.microsoft.edgemac": return ("Microsoft Edge", "chromium")
        default: return nil
        }
    }

    func append(_ payload: [String: Any]) {
        guard recording || payload["type"] as? String == "text" else { return }
        var object = payload
        object["ts"] = stamp.string(from: Date())
        guard let data = try? JSONSerialization.data(withJSONObject: object) else { return }
        let url = support.appendingPathComponent("events.jsonl")
        writeQueue.async {
            if !FileManager.default.fileExists(atPath: url.path) {
                FileManager.default.createFile(atPath: url.path, contents: nil)
            }
            guard let handle = FileHandle(forWritingAtPath: url.path) else { return }
            defer { try? handle.close() }
            handle.seekToEndOfFile()
            try? handle.write(contentsOf: data)
            try? handle.write(contentsOf: Data([0x0A]))
        }
    }

    func refreshIfNeeded() {
        guard recording, refreshProcess?.isRunning != true else { return }
        refreshProcess = makeProcess(script: "context/refresh.mjs", capture: false, announceAbort: true)
        try? refreshProcess?.run()
    }

    func noteGoalError() {
        let url = support.appendingPathComponent("goal-status.json")
        guard let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        let ok = json["ok"] as? Bool ?? true
        let message = json["message"] as? String ?? ""
        if !ok && !message.isEmpty && message != lastGoalError {
            lastGoalError = message
            notify(message)
        }
        if ok { lastGoalError = "" }
    }

    func makeProcess(script: String, capture: Bool, announceAbort: Bool) -> Process? {
        let executable = node == "/usr/bin/env" ? "/usr/bin/env" : node
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        let scriptPath = URL(fileURLWithPath: root).appendingPathComponent(script).path
        process.arguments = executable == "/usr/bin/env" ? ["node", scriptPath] : [scriptPath]
        process.currentDirectoryURL = URL(fileURLWithPath: root, isDirectory: true)
        var environment = ProcessInfo.processInfo.environment
        environment["LATELY_ROOT"] = root
        if executable != "/usr/bin/env" { environment["LATELY_NODE"] = executable }
        if !announceAbort { environment["LATELY_ANNOUNCE_ABORT"] = "0" }
        process.environment = environment
        if capture {
            process.standardOutput = Pipe()
            process.standardError = FileHandle.nullDevice
        } else {
            let logURL = support.appendingPathComponent("control.log")
            if !FileManager.default.fileExists(atPath: logURL.path) {
                FileManager.default.createFile(atPath: logURL.path, contents: nil)
            }
            if let handle = try? FileHandle(forWritingTo: logURL) {
                handle.seekToEndOfFile()
                logHandle = handle
                process.standardOutput = FileHandle.nullDevice
                process.standardError = handle
            }
        }
        return process
    }

    func runNode(script: String, capture: Bool, onExit: @escaping (Int32, Data) -> Void) -> Process? {
        guard let process = makeProcess(script: script, capture: capture, announceAbort: true) else { return nil }
        let pipe = process.standardOutput as? Pipe
        process.terminationHandler = { finished in
            let data = pipe?.fileHandleForReading.readDataToEndOfFile() ?? Data()
            DispatchQueue.main.async { onExit(finished.terminationStatus, data) }
        }
        do {
            try process.run()
        } catch {
            onExit(1, Data())
            return nil
        }
        return process
    }

    func writeRecording() {
        writeJSON(["recording": recording], to: support.appendingPathComponent("recording.json"))
    }

    func writeJSON(_ object: [String: Any], to url: URL) {
        guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted]) else { return }
        try? data.write(to: url)
    }

    func savedGoal() -> String {
        let url = support.appendingPathComponent("summary.json")
        guard let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let goal = json["goal"] as? String else { return "" }
        return goal
    }

    func controlStatus() -> String {
        let url = support.appendingPathComponent("control.json")
        guard let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let status = json["status"] as? String else { return controlling ? "Working" : "Idle" }
        return status
    }

    func updateMenu(force: Bool) {
        let ax = AXIsProcessTrusted()
        let screen = CGPreflightScreenCaptureAccess()
        let goal = savedGoal()
        let status = controlStatus()
        let signature = "\(recording)|\(controlling)|\(ax)|\(screen)|\(goal)|\(status)"
        let title = controlling ? "Lately · control" : recording ? "Lately · rec" : "Lately · paused"
        statusItem?.button?.title = title
        if !force && signature == menuSignature { return }
        menuSignature = signature
        let menu = NSMenu()
        menu.addItem(label(recording ? "Recording is on" : "Recording is paused"))
        let toggle = NSMenuItem(title: recording ? "Pause" : "Resume", action: #selector(toggleRecording(_:)), keyEquivalent: "")
        toggle.target = self
        menu.addItem(toggle)
        menu.addItem(.separator())
        menu.addItem(label("Permissions — required, not optional"))
        menu.addItem(permissionItem(
            "Accessibility: \(ax ? "Allowed" : "Needed for the listen-only event tap")",
            action: #selector(openAccessibility(_:))
        ))
        menu.addItem(permissionItem(
            "Screen Recording: \(screen ? "Allowed" : "Needed to see windows")",
            action: #selector(openScreenRecording(_:))
        ))
        menu.addItem(permissionItem(
            "Automation: Needed to read the front browser URL",
            action: #selector(openAutomation(_:))
        ))
        menu.addItem(.separator())
        let goalItem = label(goal.isEmpty ? "No concrete goal yet" : "Goal: \(goal)")
        goalItem.toolTip = goal
        menu.addItem(goalItem)
        let copy = NSMenuItem(title: "Copy goal", action: #selector(copyGoal(_:)), keyEquivalent: "")
        copy.target = self
        copy.isEnabled = !goal.isEmpty
        menu.addItem(copy)
        menu.addItem(.separator())
        menu.addItem(label(controlling ? "Control: \(status)" : "Control: idle"))
        if controlling {
            let stop = NSMenuItem(title: "Stop control", action: #selector(stopControl(_:)), keyEquivalent: "")
            stop.target = self
            menu.addItem(stop)
        }
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "Quit Lately", action: #selector(quitLately(_:)), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)
        statusItem?.menu = menu
    }

    func label(_ title: String) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.isEnabled = false
        return item
    }

    func permissionItem(_ title: String, action: Selector) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
        item.target = self
        return item
    }

    func notify(_ body: String) {
        let escaped = body
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: " ")
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", "display notification \"\(escaped)\" with title \"Lately\""]
        try? process.run()
    }

    func keyName(_ code: UInt16) -> String {
        let names: [UInt16: String] = [
            36: "return", 48: "tab", 49: "space", 51: "delete", 53: "escape",
            76: "return", 115: "home", 116: "pageup", 117: "forwarddelete",
            119: "end", 121: "pagedown", 123: "left", 124: "right", 125: "down", 126: "up",
        ]
        if let name = names[code] { return name }
        return "key-\(code)"
    }

    func characters(of event: CGEvent) -> String {
        var length = 0
        var buffer = [UniChar](repeating: 0, count: 8)
        buffer.withUnsafeMutableBufferPointer { pointer in
            event.keyboardGetUnicodeString(maxStringLength: 8, actualStringLength: &length, unicodeString: pointer.baseAddress)
        }
        guard length > 0 else { return "" }
        return String(utf16CodeUnits: buffer, count: length)
    }

    @objc func toggleRecording(_ sender: Any?) { setRecording(!recording) }
    @objc func stopControl(_ sender: Any?) {
        hardStop(announce: false)
        notify("Control stopped.")
    }
    @objc func quitLately(_ sender: Any?) {
        if controlling { hardStop(announce: false) }
        NSApp.terminate(nil)
    }
    @objc func copyGoal(_ sender: Any?) {
        _ = runNode(script: "context/copy.mjs", capture: true) { [weak self] _, data in
            guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
            if object["reason"] as? String == "secure-field" {
                self?.notify("The focused field is a password field, so Lately did not paste.")
            }
        }
    }
    @objc func openAccessibility(_ sender: Any?) {
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        AXIsProcessTrustedWithOptions([key: true] as CFDictionary)
        openSettings("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
    }
    @objc func openScreenRecording(_ sender: Any?) {
        CGRequestScreenCaptureAccess()
        openSettings("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
    }
    @objc func openAutomation(_ sender: Any?) {
        openSettings("x-apple.systempreferences:com.apple.preference.security?Privacy_Automation")
    }

    func openSettings(_ raw: String) {
        guard let url = URL(string: raw) else { return }
        NSWorkspace.shared.open(url)
    }
}

let delegate = AppDelegate()
let application = NSApplication.shared
application.delegate = delegate
application.setActivationPolicy(.accessory)
application.run()
