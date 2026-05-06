# yinuo-agent

A lightweight web app that turns the local investment corpus into a searchable investment-analysis agent.

The agent is designed around structured decision logic, not imitation of any writer's tone. It emphasizes:

- industry beta before stock alpha
- money-making effect before valuation expansion
- trackable variables such as demand, pricing, orders, pass-through, margins, and positioning
- caution against linear extrapolation from a single strong quarter

## Features

- Local corpus indexing from the `Metalslime/` folder
- Web chat interface
- Gemini or OpenAI provider support
- Username/password login for public web access
- Render-ready deployment config

## Project structure

- [`server.js`](./server.js): Node server, auth, and retrieval logic
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

If no local login is configured, the server generates a local password and prints it once in the startup log. The default username is `admin`.

## Environment variables

Required for hosted deployment:

- `YINUO_WEB_USERNAME`
- `YINUO_WEB_PASSWORD` or `YINUO_WEB_PASSWORD_SHA256`
- `GEMINI_API_KEY`

Recommended:

- `LLM_PROVIDER=gemini`
- `GEMINI_MODEL=gemini-3.1-pro-preview`
- `YINUO_RUNTIME_SOURCE_DIR=/var/data/yinuo-runtime`

Optional for OpenAI:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `LLM_PROVIDER=openai`

Legacy variable names such as `METALSLIME_LOGIN_KEY` and `METALSLIME_RUNTIME_SOURCE_DIR` are still accepted for local compatibility, but new deployments should use the `YINUO_*` names.

## Render deployment

See [`DEPLOY_RENDER.md`](./DEPLOY_RENDER.md) for the deployment steps.

## Notes

- Runtime data and secrets are intentionally excluded from Git.
- The app rebuilds its retrieval index from the local markdown corpus on startup.
- Hosted deployments lock web-side provider and API-key editing; secrets should live in environment variables.
- For web-based corpus uploads on Render, attach a Persistent Disk and point `YINUO_RUNTIME_SOURCE_DIR` at the mounted path.
