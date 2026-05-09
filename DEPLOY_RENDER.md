# Deploy yinuo-agent to Render

## What changed

This app is ready for Render public web deployment:

- Service name is `yinuo-agent`
- Gemini and DeepSeek calls use native `fetch()`
- Hosted deployments require server-side login credentials
- Hosted deployments can save provider, model, and API key from the authenticated web UI unless environment variables lock them
- Login is protected by an HTTP-only session cookie

## Required environment variables

Set these in Render:

- `YINUO_WEB_USERNAME`
- `YINUO_WEB_PASSWORD`

For stronger secret handling, you can set `YINUO_WEB_PASSWORD_SHA256` instead of `YINUO_WEB_PASSWORD`.

Recommended:

- `LLM_PROVIDER=gemini`
- `GEMINI_MODEL=gemini-3.1-pro-preview`
- `YINUO_RUNTIME_SOURCE_DIR=/var/data/yinuo-runtime`

Optional for OpenAI:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `LLM_PROVIDER=openai`

Optional for DeepSeek:

- `DEEPSEEK_API_KEY`
- `DEEPSEEK_MODEL=deepseek-v4-pro`
- `LLM_PROVIDER=deepseek`

## Deploy steps

1. Push this project to GitHub.
2. In Render, create a new Web Service from the repo.
3. Render can read `render.yaml`, or you can enter these manually:
   - Build Command: `npm install`
   - Start Command: `npm start`
4. Add the required environment variables.
5. Deploy.

## Persistent upload storage

If you want to upload new markdown corpus files from the web UI without redeploying:

1. Attach a Render Persistent Disk.
2. Mount it at `/var/data`.
3. Set `YINUO_RUNTIME_SOURCE_DIR=/var/data/yinuo-runtime`.
4. Redeploy.

## Notes

- If `LLM_PROVIDER`, `*_API_KEY`, or `*_MODEL` environment variables are set, the web settings panel becomes read-only.
- On the Render public URL, API keys entered in the web UI are sent over HTTPS and stored server-side.
- The `Metalslime` folder is deployed as part of the repo contents.
- To update the base corpus without a disk, add new markdown files to the repo and redeploy.
