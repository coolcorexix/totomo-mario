# totomo-mario

A tiny canvas jump-and-collect-coins game. Move, jump, grab coins, dodge obstacles — everyone who opens the page lands in the same shared world.

## Stack

- Vite + vanilla TypeScript, rendered on a single `<canvas>`
- Supabase Realtime (one hardcoded broadcast/presence channel) for multiplayer — no database, no accounts

## Develop

```bash
npm install
cp .env.example .env.local   # fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm run dev
```

## Controls

Arrow keys / WASD to move, Space (or Up/W) to jump.

## Deploy

Static Vite build, deploys on Vercel with zero config. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as project environment variables.
