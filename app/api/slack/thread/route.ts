import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { slackToken, channelId, threadTs } = await req.json()

  const params = new URLSearchParams({
    channel: channelId,
    ts: threadTs,
    limit: '200',
  })

  const res = await fetch(`https://slack.com/api/conversations.replies?${params}`, {
    headers: { Authorization: `Bearer ${slackToken}` },
  })

  const data = await res.json()

  if (!data.ok) {
    return NextResponse.json({ error: data.error || 'Thread fetch failed' }, { status: 400 })
  }

  return NextResponse.json({ messages: data.messages ?? [] })
}
