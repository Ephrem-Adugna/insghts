# OpenWork computer use, used by Lately

Lately plans a goal with local Ollama and drives the Mac through OpenWork's app-scoped computer-use runtime.

Source: https://github.com/different-ai/openwork
Package: `packages/computer-use` (`@openwork/computer-use`)
Commit: `03719385b4be754cd76e4a224972227d13fa4f4e`
License: MIT (`LICENSE`, copyright Different AI)

Included:

- `computer-use/src/session.mjs` — `openComputerSession`, observe / act / close
- `computer-use/native` — accessibility, input, approval panel, stop, and the MCP tool server

Not included: OpenWork cloud accounts, the marketing site, enterprise apps, or the older hands-free OpenAI computer-use loop.

`loop.mjs` is Lately's planner. It calls that session API and stops on Control-Option-C, Pause, a denied approval, or an Ollama failure. It does not reimplement click or type.
