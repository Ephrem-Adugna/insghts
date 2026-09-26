# Insight

Insight is a lab workspace for messages and activity. People talk in channels. On each computer, [Screenpipe](https://screenpi.pe) records what is on screen, and a small local model writes a one- or two-sentence observation. Screen text stays on the machine. Accounts, channels, messages, and those observations are stored in Firebase Realtime Database.

A new person registers, then creates an organization or joins one with an invite code. Members see only their own observations and can remove any they do not want kept. The person who created the organization sees a dashboard for the whole lab, and can open the raw activity log.

## Run it locally

You need Node.js, [Ollama](https://ollama.com), and a Screenpipe API token.

```bash
git clone https://github.com/Ephrem-Adugna/insghts.git
cd insghts
cp .env.example .env
```

In `.env`, set `AUTH_SECRET` to a long random string. Set `SCREENPIPE_LOCAL_API_KEY` to the token from Screenpipe (`screenpipe auth token`).

```bash
ollama pull qwen2.5:0.5b
npm install
npm run desktop
```

`npm run desktop` starts the app, Screenpipe, and the desktop window. Register, create an organization, and share the invite code in the header.

`npm run dev` serves the site at http://localhost:3000. Activity still needs Ollama and Screenpipe running on that computer.
