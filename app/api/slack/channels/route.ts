import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { slackToken, userName } = await req.json()

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const dateStr = since.toISOString().split('T')[0]

  const params = new URLSearchParams({
    query: `from:${userName} after:${dateStr}`,
    count: '100',
    sort: 'timestamp',
    sort_dir: 'desc',
  })

  const res = await fetch(`https://slack.com/api/search.messages?${params}`, {
    headers: { Authorization: `Bearer ${slackToken}` },
  })

  const data = await res.json()

  if (!data.ok) {
    return NextResponse.json({ error: data.error || 'Channel search failed' }, { status: 400 })
  }

  // Filter to last 24 hours and group by channel
  const cutoff = Date.now() / 1000 - 24 * 60 * 60
  const messages = (data.messages?.matches ?? []).filter(
    (m: { ts: string }) => parseFloat(m.ts) >= cutoff
  )

  const channelMap = new Map<string, { id: string; name: string; messages: unknown[] }>()
  for (const msg of messages) {
    const id = msg.channel?.id ?? 'unknown'
    const name = msg.channel?.name ?? id
    if (!channelMap.has(id)) {
      channelMap.set(id, { id, name, messages: [] })
    }
    channelMap.get(id)!.messages.push(msg)
  }

  return NextResponse.json({ channels: Array.from(channelMap.values()) })
}
