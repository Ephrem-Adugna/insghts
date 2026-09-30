# Lately

Lately is the local menu-bar tool for this Mac. It records what you are doing, asks Ollama for the concrete goal you appear to be finishing, and can drive the approved app window to complete that goal.

`npm run lately` compiles `context/ContextBar.swift` into `context/.build/Lately.app`, builds the OpenWork computer-use helper, and launches the menu-bar app.

The model is Ollama `llama3.1:8b` at `http://127.0.0.1:11434`. Override the model with `LATELY_MODEL` and the host with `OLLAMA_HOST`. The host must stay on this computer (`127.0.0.1`, `localhost`, or `::1`). Raw keystrokes are not uploaded.

## Shortcut

Control-Option-C starts goal completion after a macOS notification of the predicted goal. The same shortcut stops control. A second press does not start a new goal.

The notification is a Notification Center banner titled Lately. The menu bar title switches to `Lately · control` while a session is running. OpenWork's floating **OpenWork Computer Use** panel is the visible controller: it names the goal, and **Stop**, **Take over**, and **Hide panel** are on that panel. Stopping also posts OpenWork's `com.differentai.openwork.computer-use.stop` notification and kills the control process.

Before any click or keystroke, the helper asks you to pick the window and choose **Allow and start**. If you cancel, nothing is driven. Pause recording stops control as well. If Ollama is down, or the model is missing, Lately notifies you and does not act.

Copy goal in the menu runs `context/copy.mjs`, which pastes the saved goal. That is not the shortcut. Password fields are not recorded and are not pasted into.

## What is stored

Raw events stay in `~/Library/Application Support/Lately/events.jsonl`. Every 15 seconds, while recording is on and the transcript changed, `context/refresh.mjs` sends the newest events from that log, still in time order and capped at about 12,000 characters, to local Ollama and writes the newest concrete goal to `summary.json`. The on-disk log is not trimmed by that cap. Overlapping Ollama calls are skipped or waited out so they do not stack. The goal is a specific outcome, not a vague label, a guessed chat prompt, or a Plato-style state.

## Permissions

Lately needs three macOS permissions, and the menu says which are missing:

- Accessibility, for a listen-only event tap (clicks, keys, window titles). It does not swallow your input.
- Screen Recording, so window capture for the control helper can work.
- Automation, the first time a browser URL is read.

The OpenWork helper is a separate process. macOS will ask again for its own Accessibility and Screen Recording permissions. Grant those to the helper that `npm run lately` builds. Lately does not hide these prompts or mark itself ready without them.

## Where the control loop comes from

The click, type, and app-control runtime is OpenWork's `@openwork/computer-use` package (MIT), commit `03719385b4be754cd76e4a224972227d13fa4f4e`, from [different-ai/openwork](https://github.com/different-ai/openwork). Vendored under `context/openwork/computer-use/`:

- `src/session.mjs` — one approved session, one action per observation, abort closes the session
- native `SessionRuntime`, `SessionControls`, `MacAccessibility`, `MacInput`, and the MCP tools `computer_discover`, `computer_open_session`, `computer_observe`, `computer_act`, `computer_session_status`, `computer_close_session`

`context/openwork/loop.mjs` is the local planner. It keeps OpenWork's rules: you approve the app and window, your typing or clicking pauses input, Stop ends the grant, protected fields are refused, and a dispatched action is not treated as proof the goal is done. Terminal, System Settings, password managers, and similar apps stay blocked by that helper. The cloud product, accounts, and marketing site are not included.

## Limits

This needs macOS 14 or later. The default text model uses accessibility actions (press, set value, type, key) inside the approved window. Pixel clicks stay off unless you set `LATELY_INCLUDE_IMAGE=1` and use a vision-capable local model. A session lasts at most 15 minutes in the helper, and the planner stops after 16 actions (`LATELY_MAX_TURNS`) unless you stop it sooner. The cloud VM that developed this could not compile the Swift app or drive a Mac. `npm test` covers goal parsing, the start-versus-stop shortcut, and a simulated action loop. It does not click a real desktop.
