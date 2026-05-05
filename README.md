# Metalslime Agent

A lightweight web app that turns recent `Metalslime` posts and replies into a searchable investment-analysis agent.

The agent is designed around **Metalslime's decision logic**, not his tone or writing style. It emphasizes:

- industry beta before stock alpha
- money-making effect before valuation expansion
- trackable variables such as demand, pricing, orders, pass-through, margins, and positioning
- caution against linear extrapolation from a single strong quarter

## Features

- Local corpus indexing from the `Metalslime/` folder
- Web chat interface
- Gemini or OpenAI provider support
- Login-key protection for web access
- Render-ready deployment config

## Project structure

- [`server.js`](./server.js): Node server and retrieval logic
- [`web/`](./web): frontend UI
- [`Metalslime/`](./Metalslime): source markdown corpus
- [`metalslime_views.md`](./metalslime_views.md): distilled viewpoint summary
- [`metalslime_investment_agent.md`](./metalslime_investment_agent.md): system prompt / agent rules
- [`render.yaml`](./render.yaml): Render deployment config

## Local run

```powershell
npm install
npm start
```

Then open:

- [http://localhost:3000](http://localhost:3000)

## Environment variables

Recommended for hosted deployment:

- `METALSLIME_LOGIN_KEY`
- `GEMINI_API_KEY`
- `LLM_PROVIDER=gemini`
- `GEMINI_MODEL=gemini-3-flash-preview`

Optional for OpenAI:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `LLM_PROVIDER=openai`

## Render deployment

See [`DEPLOY_RENDER.md`](./DEPLOY_RENDER.md) for the deployment steps.

## Notes

- Runtime data and secrets are intentionally excluded from Git.
- The app rebuilds its retrieval index from the `Metalslime/` folder on startup.
- Hosted deployments lock web-side provider and API-key editing; secrets should live in environment variables.
