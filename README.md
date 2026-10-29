# sheet

Character sheets with clocks, tables and rules, shared live by everyone in a room. A room
lives at `/r/<token>`, and its link is the only key: anyone holding it can play.

It is a Svelte app served by a Cloudflare Worker, with one Durable Object per room.

## Start it

You need Node 22.12 or later.

```bash
npm ci
cp .env.example .env
npm run dev
```

Open <http://localhost:7476/gm>, make a room, and open its link. Locally `/gm` lets you in as
a stub GM; in production it sits behind Cloudflare Access. `/` lists the rooms this browser
has opened.

The keys in `.env` are optional. Without `ANTHROPIC_API_KEY` the chat beside the sheet says
no key is set up; without `CF_REALTIME_ID` and `CF_REALTIME_KEY` you don't see others'
cursors. Everything else works.

## Before a pull request

```bash
npm run check   # types: wrangler, svelte-check, tsc over worker/
npm test        # vitest
npm run lint    # prettier; `npm run format` fixes it
```

Open the pull request here. The owner merges it from a larger repository and pushes it back,
and GitHub then shows it as merged.

## Run your own copy

1. In `wrangler.jsonc`, set `account_id` to your Cloudflare account.
2. Make a Cloudflare Access application for the path `/gm` only, then set `TEAM_DOMAIN`
   and `POLICY_AUD` in `wrangler.jsonc` to your team domain and that application's AUD.
   Don't put Access on the whole Worker: it refuses the rooms' WebSocket upgrades.
3. Set the optional keys as secrets: `npx wrangler secret put ANTHROPIC_API_KEY`, and the
   same for `CF_REALTIME_ID` and `CF_REALTIME_KEY`.
4. `npm run deploy`.

## License

MIT, in [LICENSE](LICENSE).
