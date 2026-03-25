# Slack Activity Summarizer

An AI-powered web app that fetches your last 24 hours of Slack activity, summarizes it with Claude, and publishes a daily `.md` file to GitHub.

## Features

- **@mention tracking** — finds every message where you were mentioned across all channels (public + private)
- **Full thread context** — loads all replies in each thread, not just the triggering message
- **Channel activity** — surfaces channels where you sent messages
- **No DMs** — direct messages are excluded
- **Verified data only** — summary is generated from real Slack API results; nothing is inferred
- **Collapsible verification panel** — shows raw Slack API responses so you can cross-check the summary
- **Live progress log** — color-coded tags (`MENTIONS`, `THREAD`, `CHANNEL`, `SKIP`, `DONE`) stream in real time
- **30-second per-step timeout** — each fetch step shows a countdown and a **Skip** button; timeouts are handled gracefully
- **GitHub publishing** — saves `daily-slack-summary/YYYY-MM-DD.md` to your chosen repo; safely updates the file if it already exists

## Summary sections

1. **Mentions** — who mentioned you, in which channel, about what
2. **Full Thread Summaries** — condensed view of each thread conversation
3. **Channel Activity** — channels where you were active with message counts
4. **Key Takeaways** — action items, decisions, and important topics

## Requirements

| Credential | Where to get it |
|---|---|
| **Slack user token** (`xoxp-…`) | Slack app → OAuth & Permissions → User Token Scopes: `search:read`, `channels:history`, `groups:history` |
| **Claude API key** (`sk-ant-…`) | [console.anthropic.com](https://console.anthropic.com) |
| **GitHub PAT** (`ghp_…`) | GitHub → Settings → Developer settings → Personal access tokens → `repo` scope |
| **GitHub repo** | Any repo you own, formatted as `owner/repo` |

## Setup & development

```bash
npm install
npm run dev
# Open http://localhost:3000
```

## Tech stack

- [Next.js 14](https://nextjs.org) (App Router, TypeScript)
- [Anthropic SDK](https://github.com/anthropics/anthropic-sdk) — streaming Claude summary via SSE
- [Tailwind CSS](https://tailwindcss.com)
- Slack Web API (`search.messages`, `conversations.replies`, `auth.test`)
- GitHub Contents API
