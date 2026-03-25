import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface SlackData {
  userId?: string
  userName?: string
  teamName?: string
  mentions?: Array<{
    ts: string
    text: string
    channel?: { id: string; name: string }
    username?: string
    thread_ts?: string
  }>
  threads?: Record<string, Array<{ user?: string; text?: string; ts?: string }>>
  channelActivity?: Array<{
    id: string
    name: string
    messages: Array<{ text: string; ts: string }>
  }>
}

function buildPrompt(slackData: SlackData, today: string): string {
  const { userName, mentions = [], threads = {}, channelActivity = [] } = slackData

  const mentionLines =
    mentions.length === 0
      ? 'None found'
      : mentions
          .map((m) => {
            const ch = m.channel?.name ?? m.channel?.id ?? 'unknown'
            const time = new Date(parseFloat(m.ts) * 1000).toISOString()
            return `- #${ch} at ${time}: "${m.text}"`
          })
          .join('\n')

  const threadLines =
    Object.keys(threads).length === 0
      ? 'None found'
      : Object.entries(threads)
          .map(([key, msgs]) => {
            const [channelId] = key.split(':')
            const header = `Thread in ${channelId} (${msgs.length} messages):`
            const body = msgs
              .map((m) => `  [${m.user ?? 'unknown'}]: ${m.text ?? ''}`)
              .join('\n')
            return `${header}\n${body}`
          })
          .join('\n\n')

  const channelLines =
    channelActivity.length === 0
      ? 'None found'
      : channelActivity
          .map((c) => `- #${c.name}: ${c.messages.length} message(s)`)
          .join('\n')

  return `You are generating a verified daily Slack activity summary for @${userName ?? 'user'}.

STRICT RULES:
- Only describe what is explicitly present in the raw data below.
- If a section has no data, write exactly "None found." — do not invent activity.
- Do not add hypothetical context, assumptions, or inferred information.
- Be concise and factual.

Generate the summary using EXACTLY this markdown structure:

# Daily Slack Activity Summary — ${today}
> ✅ Verified, live Slack data · No DMs included · Last 24 hours

## 1. Mentions
[Describe each real @mention: who mentioned you, in which channel, what was the context]

## 2. Full Thread Summaries
[For each thread, summarize what was discussed. Include all participants and key points.]

## 3. Channel Activity
[List channels where you sent messages. Note the number of messages and main topics.]

## 4. Key Takeaways
[Bullet points: action items, decisions made, or important topics from the last 24h]

---

RAW DATA (use only this — nothing else):

### @MENTIONS (${mentions.length}):
${mentionLines}

### FULL THREADS (${Object.keys(threads).length} thread(s)):
${threadLines}

### CHANNEL ACTIVITY (${channelActivity.length} channel(s)):
${channelLines}
`
}

export async function POST(req: NextRequest) {
  const { claudeKey, slackData } = (await req.json()) as {
    claudeKey: string
    slackData: SlackData
  }

  const client = new Anthropic({ apiKey: claudeKey })
  const today = new Date().toISOString().split('T')[0]
  const prompt = buildPrompt(slackData, today)

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const stream = client.messages.stream({
          model: 'claude-opus-4-6',
          max_tokens: 2048,
          messages: [{ role: 'user', content: prompt }],
        })

        for await (const event of stream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            const payload = JSON.stringify({ type: 'text', text: event.delta.text })
            controller.enqueue(encoder.encode(`data: ${payload}\n\n`))
          }
        }

        controller.enqueue(encoder.encode('data: {"type":"done"}\n\n'))
        controller.close()
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        const payload = JSON.stringify({ type: 'error', message })
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`))
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
