# Insight desktop

Insight is a desktop chat client so Screenpipe can observe the researcher’s
machine with consent — not a browser tab.

```
npm run desktop
```

This starts three processes together:

1. Insight (Next.js)
2. Screenpipe (`localhost:3030`) if it is not already recording
3. The native chat window

The sidebar badge reads **Observing** only when Screenpipe is actually
healthy. Every 30 seconds the desktop client pulls new activity into
research sessions.

`scripts/ensure-screenpipe.cjs` is the companion launcher. The Electron
window also tries to start Screenpipe if you open it with `npm run desktop:open`.
