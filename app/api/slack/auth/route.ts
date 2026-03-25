import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { slackToken } = await req.json()

  const res = await fetch('https://slack.com/api/auth.test', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${slackToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  })

  const data = await res.json()

  if (!data.ok) {
    return NextResponse.json({ error: data.error || 'Authentication failed' }, { status: 400 })
  }

  return NextResponse.json({
    userId: data.user_id,
    userName: data.user,
    teamName: data.team,
  })
}
