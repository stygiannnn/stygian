# stygian

Bio-link / showcase profile platform for **stygian.wtf**.

## Structure
- `client/` — Svelte (Vite) frontend
- `server/` — Cloudflare Worker API (serves the client, handles `/api/*`)

## Deploy
Push to `main` → Cloudflare builds the client and deploys the Worker.
