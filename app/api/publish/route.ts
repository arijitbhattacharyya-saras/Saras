import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { githubToken, owner, repo, content, date } = await req.json()

  if (!owner || !repo) {
    return NextResponse.json({ error: 'Invalid repo format — use owner/repo' }, { status: 400 })
  }

  const path = `daily-slack-summary/${date}.md`
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`
  const headers = {
    Authorization: `Bearer ${githubToken}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'User-Agent': 'slack-activity-summarizer',
  }

  // Check if file already exists to get its SHA (required for updates)
  let existingSha: string | undefined
  const checkRes = await fetch(apiUrl, { headers })
  if (checkRes.ok) {
    const existing = await checkRes.json()
    existingSha = existing.sha
  }

  const body = {
    message: existingSha
      ? `Update daily Slack summary for ${date}`
      : `Add daily Slack summary for ${date}`,
    content: Buffer.from(content).toString('base64'),
    ...(existingSha && { sha: existingSha }),
  }

  const putRes = await fetch(apiUrl, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  })

  if (!putRes.ok) {
    const err = await putRes.json().catch(() => ({}))
    return NextResponse.json(
      { error: (err as { message?: string }).message ?? 'Publish failed' },
      { status: putRes.status }
    )
  }

  const result = await putRes.json()
  return NextResponse.json({
    url: result.content?.html_url ?? '',
    action: existingSha ? 'updated' : 'created',
  })
}
