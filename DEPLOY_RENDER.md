# Deploy to Render

## What changed

This app is now compatible with Render:

- Gemini calls use native `fetch()`
- Hosted deployments require environment variables for secrets
- Web UI settings are read-only on hosted deployments
- Login is protected by a server-side session cookie

## Required environment variables

Set these in Render:

- `METALSLIME_LOGIN_KEY`
- `GEMINI_API_KEY`

Recommended:

- `LLM_PROVIDER=gemini`
- `GEMINI_MODEL=gemini-3-flash-preview`

Optional for OpenAI:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `LLM_PROVIDER=openai`

## Deploy steps

1. Push this project to GitHub.
2. In Render, create a new Web Service from the repo.
3. Render can read `render.yaml`, or you can enter these manually:
   - Build Command: `npm install`
   - Start Command: `npm start`
4. Add the required environment variables.
5. Deploy.

## Notes

- On Render, secrets should not be stored in `data/settings.json`.
- The `Metalslime` folder is deployed as part of the repo contents.
- To update the agent corpus, add new files to `Metalslime`, commit, and redeploy.
