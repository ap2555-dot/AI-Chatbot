# Orbit

A polished, general-purpose AI chatbot powered by [Groq](https://groq.com). Plain HTML, CSS and JavaScript on the front end and one Vercel serverless function (`api/chat.js`) that holds the API key.

```
public/            static site (index.html, styles.css, app.js, assets/robot.png)
api/chat.js        POST /api/chat → Groq (key stays on the server)
dev-server.js      zero-dependency local server (static files + /api/chat)
test/              API tests that run against a mock Groq server
```

## Run locally

Requires Node 18+. No `npm install` needed (there are no dependencies).

```bash
cp .env.example .env      # then put your real key in .env (never commit it)
node dev-server.js        # http://localhost:3000
node --test test/api.test.js
```

## Environment variables

| Name | Required | Notes |
|------|----------|-------|
| `GROQ_API_KEY` | yes | Your Groq API key. Server-side only. |
| `GROQ_MODEL`   | no  | Defaults to `llama-3.3-70b-versatile`. Any chat model available to your Groq account works. |

## Limits (see the constants at the top of `api/chat.js`)

- 2,000 characters per user message
- last 12 messages sent as context
- 1,024 output tokens per reply
- 20 s timeout on the Groq call (30 s in the browser)

## Deploy to Vercel

1. Push this folder to a GitHub repo.
2. In Vercel: **Add New → Project → Import** the repo. Leave the framework preset as **Other**; no build command is needed.
3. Under **Settings → Environment Variables**, add `GROQ_API_KEY` (and optionally `GROQ_MODEL`) for Production, Preview and Development.
4. Deploy. If you add the variables after the first deploy, redeploy so they take effect.

There is no authentication, database or rate limiting, so anyone with the URL can spend your Groq quota. Set usage limits in the Groq console, or add rate limiting before sharing the URL widely.
