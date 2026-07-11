# Citely

> tracks whether ChatGPT/Perplexity mention your brand for key prompts and recommends fixes.

**Alternative to the product-shape pioneered by AthenaHQ (YC ~W24)** — rank #4 of 500 in the [YC-500 Fable 5 Venture Blueprint](https://github.com/) (score 7.35/10).

## Why this exists
Early leader in fast-growing GEO category as buyers shift from Google to LLMs. The buildable wedge: query llms for brand mentions, score visibility, and suggest content fixes via claude.

## MVP scope
- [ ] Prompt set tracking
- [ ] multi-LLM query
- [ ] share-of-voice score
- [ ] competitor gap
- [ ] fix suggestions

## Architecture
`Workers+Supabase+Claude` — Cloudflare Workers + Hono API, Supabase (Postgres + RLS + Auth + pgvector), Claude API via Agent SDK (claude-fable-5 for agent reasoning, claude-haiku-4-5 for volume), wrangler deploys.

**Integrations:** OpenAI; Perplexity; Claude API; SerpAPI
**Data:** Tracked prompts, LLM responses over time, competitor mentions
**Agent core:** Agent runs weekly prompt panels and drafts GEO content to win citations.

## Business
| | |
|---|---|
| Monetization | $99-499/mo per brand |
| First customer | Marketing lead worried about AI search |
| GTM wedge | Free 'is your brand in ChatGPT' audit tool as viral lead magnet |
| Competition risk | High: Athena, Profound, Peec |
| Regulatory/trust risk | Med: LLM API ToS and cost |
| India angle | Affordable GEO tracking for Indian brands and agencies globally. |
| Difficulty / build time | Medium / 2-3 weeks |

## 30-day plan
- **W1:** core loop — Prompt set tracking + multi-LLM query
- **W2:** share-of-voice score + competitor gap + fix suggestions + auth + billing
- **W3:** polish, instrument events, seed first users via: Free 'is your brand in ChatGPT' audit tool as viral lead magnet
- **W4:** launch + first revenue; kill/scale decision

---
*Built with Fable 5 (Claude Code). Blueprint row: inspired by AthenaHQ — "Generative Engine Optimization: get brands cited by ChatGPT and AI search."*