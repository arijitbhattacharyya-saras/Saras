import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { slackToken, userId } = await req.json()

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const dateStr = since.toISOString().split('T')[0]

  const params = new URLSearchParams({
    query: `<@${userId}> after:${dateStr}`,
    count: '100',
    sort: 'timestamp',
    sort_dir: 'desc',
  })

  const res = await fetch(`https://slack.com/api/search.messages?${params}`, {
    headers: { Authorization: `Bearer ${slackToken}` },
  })

  const data = await res.json()

  if (!data.ok) {
    return NextResponse.json({ error: data.error || 'Mentions search failed' }, { status: 400 })
  }

  // Filter strictly to last 24 hours
  const cutoff = Date.now() / 1000 - 24 * 60 * 60
  const mentions = (data.messages?.matches ?? []).filter(
    (m: { ts: string }) => parseFloat(m.ts) >= cutoff
  )

  return NextResponse.json({ mentions })
}
