'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type LogTag = 'MENTIONS' | 'THREAD' | 'CHANNEL' | 'SKIP' | 'DONE' | 'ERROR' | 'INFO'

interface LogEntry {
  id: string
  tag: LogTag
  message: string
  request?: unknown
  response?: unknown
}

interface ChannelGroup {
  id: string
  name: string
  messages: unknown[]
}

interface SlackMessage {
  ts: string
  text: string
  user?: string
  channel?: { id: string; name: string }
  username?: string
  thread_ts?: string
}

interface SlackData {
  userId?: string
  userName?: string
  teamName?: string
  mentions?: SlackMessage[]
  threads?: Record<string, SlackMessage[]>
  channelActivity?: ChannelGroup[]
}

interface Config {
  slackToken: string
  claudeKey: string
  githubToken: string
  githubRepo: string
}

// ─── Tag colours ──────────────────────────────────────────────────────────────

const TAG_BG: Record<LogTag, string> = {
  MENTIONS: 'bg-blue-600',
  THREAD: 'bg-emerald-600',
  CHANNEL: 'bg-amber-500 text-black',
  SKIP: 'bg-orange-500',
  DONE: 'bg-green-600',
  ERROR: 'bg-red-600',
  INFO: 'bg-slate-500',
}

// ─── Minimal markdown renderer ────────────────────────────────────────────────

function Markdown({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <div>
      {lines.map((line, i) => {
        if (line.startsWith('# '))
          return (
            <h1 key={i} className="text-xl font-bold text-white mt-6 mb-2">
              {line.slice(2)}
            </h1>
          )
        if (line.startsWith('## '))
          return (
            <h2 key={i} className="text-base font-bold text-blue-400 mt-5 mb-1">
              {line.slice(3)}
            </h2>
          )
        if (line.startsWith('### '))
          return (
            <h3 key={i} className="font-semibold text-gray-200 mt-3 mb-1">
              {line.slice(4)}
            </h3>
          )
        if (line.startsWith('> '))
          return (
            <p key={i} className="text-gray-400 border-l-2 border-gray-600 pl-3 italic text-sm my-1">
              {line.slice(2)}
            </p>
          )
        if (line.startsWith('- ') || line.startsWith('* '))
          return (
            <p key={i} className="text-gray-300 text-sm ml-3 my-0.5">
              • {line.slice(2)}
            </p>
          )
        if (line === '---')
          return <hr key={i} className="border-gray-700 my-4" />
        if (line.trim() === '')
          return <div key={i} className="h-2" />
        return (
          <p key={i} className="text-gray-300 text-sm leading-relaxed">
            {line}
          </p>
        )
      })}
    </div>
  )
}

// ─── Single log row with expandable request/response ─────────────────────────

function LogRow({ entry }: { entry: LogEntry }) {
  const [open, setOpen] = useState(false)
  const hasDetails = entry.request != null || entry.response != null

  return (
    <div className="text-xs font-mono leading-relaxed">
      <div className="flex items-start gap-2">
        <span
          className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-bold text-white ${TAG_BG[entry.tag]}`}
        >
          {entry.tag}
        </span>
        <span className="text-gray-300 flex-1 break-all">{entry.message}</span>
        {hasDetails && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="shrink-0 text-gray-600 hover:text-gray-400 transition-colors"
          >
            {open ? '▲' : '▼'}
          </button>
        )}
      </div>

      {open && hasDetails && (
        <div className="ml-[4.5rem] mt-1 space-y-1">
          {entry.request != null && (
            <details open>
              <summary className="text-gray-600 cursor-pointer hover:text-gray-400">
                Request
              </summary>
              <pre className="text-gray-500 bg-gray-950 rounded p-2 mt-1 overflow-x-auto text-[11px]">
                {JSON.stringify(entry.request, null, 2)}
              </pre>
            </details>
          )}
          {entry.response != null && (
            <details>
              <summary className="text-gray-600 cursor-pointer hover:text-gray-400">
                Response
              </summary>
              <pre className="text-gray-500 bg-gray-950 rounded p-2 mt-1 overflow-x-auto text-[11px]">
                {JSON.stringify(entry.response, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Home() {
  const [config, setConfig] = useState<Config>({
    slackToken: '',
    claudeKey: '',
    githubToken: '',
    githubRepo: '',
  })
  const [phase, setPhase] = useState<'setup' | 'running' | 'done'>('setup')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [slackData, setSlackData] = useState<SlackData>({})
  const [summary, setSummary] = useState('')
  const [publishStatus, setPublishStatus] = useState<string | null>(null)
  const [publishUrl, setPublishUrl] = useState('')
  const [verificationOpen, setVerificationOpen] = useState(false)
  const [activeStep, setActiveStep] = useState<string | null>(null)
  const [countdown, setCountdown] = useState(30)

  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs, activeStep])

  const addLog = useCallback((entry: Omit<LogEntry, 'id'>) => {
    setLogs((prev) => [...prev, { ...entry, id: crypto.randomUUID() }])
  }, [])

  const updateLastLog = useCallback((fn: (e: LogEntry) => LogEntry) => {
    setLogs((prev) => prev.map((e, i) => (i === prev.length - 1 ? fn(e) : e)))
  }, [])

  /**
   * Runs an async step with a 30-second countdown.
   * Shows a skip button; aborting the controller skips the step gracefully.
   */
  const runStep = useCallback(
    async <T,>(
      stepName: string,
      tag: LogTag,
      fn: (signal: AbortSignal) => Promise<{ result: T; request?: unknown; response?: unknown }>
    ): Promise<T | null> => {
      setActiveStep(stepName)
      setCountdown(30)

      const controller = new AbortController()
      abortRef.current = controller

      let secs = 30
      timerRef.current = setInterval(() => {
        secs -= 1
        setCountdown(secs)
        if (secs <= 0) controller.abort()
      }, 1000)

      addLog({ tag, message: stepName + '…' })

      try {
        const { result, request, response } = await fn(controller.signal)
        clearInterval(timerRef.current!)
        setActiveStep(null)
        updateLastLog((e) => ({ ...e, message: stepName + ' ✓', request, response }))
        return result
      } catch (err: unknown) {
        clearInterval(timerRef.current!)
        setActiveStep(null)
        const isAbort =
          err instanceof Error && (err.name === 'AbortError' || err.message === 'AbortError')
        if (isAbort) {
          updateLastLog((e) => ({ ...e, tag: 'SKIP', message: stepName + ' — skipped' }))
        } else {
          const msg = err instanceof Error ? err.message : String(err)
          updateLastLog((e) => ({ ...e, tag: 'ERROR', message: `${stepName} — ${msg}` }))
        }
        return null
      }
    },
    [addLog, updateLastLog]
  )

  const handleSkip = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  // ─── Main workflow ──────────────────────────────────────────────────────────

  const runSummary = useCallback(async () => {
    if (!config.slackToken || !config.claudeKey || phase === 'running') return

    setPhase('running')
    setLogs([])
    setSummary('')
    setPublishStatus(null)
    setPublishUrl('')

    const data: SlackData = {}
    const dateStr = new Date(Date.now() - 86_400_000).toISOString().split('T')[0]

    // 1. Authenticate
    const auth = await runStep('Authenticating with Slack', 'INFO', async (signal) => {
      const request = { endpoint: 'auth.test' }
      const res = await fetch('/api/slack/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slackToken: config.slackToken }),
        signal,
      })
      const response = await res.json()
      if (!res.ok || response.error) throw new Error(response.error ?? 'Auth failed')
      return { result: response as { userId: string; userName: string; teamName: string }, request, response: { user: response.userName, team: response.teamName } }
    })

    if (!auth) {
      addLog({ tag: 'ERROR', message: 'Authentication required — cannot continue' })
      setPhase('done')
      return
    }

    data.userId = auth.userId
    data.userName = auth.userName
    data.teamName = auth.teamName
    setSlackData({ ...data })
    addLog({ tag: 'INFO', message: `Signed in as @${auth.userName} · ${auth.teamName}` })

    // 2. Mentions
    const mentions = await runStep(`Searching @mentions — last 24h`, 'MENTIONS', async (signal) => {
      const request = { query: `<@${data.userId}> after:${dateStr}`, count: 100 }
      const res = await fetch('/api/slack/mentions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slackToken: config.slackToken, userId: data.userId }),
        signal,
      })
      const response = await res.json()
      if (!res.ok || response.error) throw new Error(response.error ?? 'Search failed')
      return {
        result: response.mentions as SlackMessage[],
        request,
        response: { count: response.mentions?.length, sample: response.mentions?.slice(0, 2) },
      }
    })

    data.mentions = mentions ?? []
    data.threads = {}
    setSlackData({ ...data })
    addLog({
      tag: 'MENTIONS',
      message:
        data.mentions.length === 0
          ? 'None found'
          : `${data.mentions.length} mention${data.mentions.length !== 1 ? 's' : ''} found`,
    })

    // 3. Full threads for each unique mention
    const seen = new Set<string>()
    for (const m of data.mentions) {
      const channelId = m.channel?.id
      const threadTs = m.thread_ts ?? m.ts
      if (!channelId || !threadTs) continue
      const key = `${channelId}:${threadTs}`
      if (seen.has(key)) continue
      seen.add(key)

      const channelName = m.channel?.name ?? channelId
      const msgs = await runStep(`Fetching thread in #${channelName}`, 'THREAD', async (signal) => {
        const request = { channel: channelId, ts: threadTs }
        const res = await fetch('/api/slack/thread', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slackToken: config.slackToken, channelId, threadTs }),
          signal,
        })
        const response = await res.json()
        if (!res.ok || response.error) throw new Error(response.error ?? 'Thread fetch failed')
        return { result: response.messages as SlackMessage[], request, response: { count: response.messages?.length } }
      })

      if (msgs) {
        data.threads![key] = msgs
        setSlackData({ ...data })
        addLog({ tag: 'THREAD', message: `${msgs.length} message${msgs.length !== 1 ? 's' : ''} loaded` })
      }
    }

    // 4. Channel activity
    const channels = await runStep(`Finding your channel activity`, 'CHANNEL', async (signal) => {
      const request = { query: `from:${data.userName} after:${dateStr}`, count: 100 }
      const res = await fetch('/api/slack/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slackToken: config.slackToken, userName: data.userName }),
        signal,
      })
      const response = await res.json()
      if (!res.ok || response.error) throw new Error(response.error ?? 'Channel search failed')
      return {
        result: response.channels as ChannelGroup[],
        request,
        response: { channelCount: response.channels?.length },
      }
    })

    data.channelActivity = channels ?? []
    setSlackData({ ...data })

    if (channels) {
      const totalMsgs = channels.reduce((sum, c) => sum + c.messages.length, 0)
      addLog({
        tag: 'CHANNEL',
        message:
          channels.length === 0
            ? 'None found'
            : `${totalMsgs} message${totalMsgs !== 1 ? 's' : ''} across ${channels.length} channel${channels.length !== 1 ? 's' : ''}`,
      })
    }

    // 5. Generate summary with Claude (streaming SSE)
    addLog({ tag: 'INFO', message: 'Generating AI summary with Claude…' })
    try {
      const res = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claudeKey: config.claudeKey, slackData: data }),
      })

      if (!res.ok) throw new Error('Summarize endpoint error')

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let full = ''
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop() ?? ''
        for (const part of parts) {
          if (!part.startsWith('data: ')) continue
          try {
            const d = JSON.parse(part.slice(6)) as { type: string; text?: string; message?: string }
            if (d.type === 'text' && d.text) {
              full += d.text
              setSummary(full)
            } else if (d.type === 'error') {
              throw new Error(d.message ?? 'Unknown summarize error')
            }
          } catch {
            // ignore parse errors on individual chunks
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      addLog({ tag: 'ERROR', message: `Summary generation failed: ${msg}` })
    }

    addLog({ tag: 'DONE', message: 'Summary complete ✓' })
    setPhase('done')
  }, [config, phase, runStep, addLog])

  // ─── GitHub publish ─────────────────────────────────────────────────────────

  const publishToGitHub = useCallback(async () => {
    if (!summary || !config.githubToken || !config.githubRepo) return
    setPublishStatus('publishing')
    try {
      const parts = config.githubRepo.split('/')
      if (parts.length !== 2) throw new Error('Repo must be in owner/repo format')
      const [owner, repo] = parts
      const date = new Date().toISOString().split('T')[0]
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ githubToken: config.githubToken, owner, repo, content: summary, date }),
      })
      const d = await res.json() as { error?: string; url?: string; action?: string }
      if (!res.ok || d.error) throw new Error(d.error ?? 'Publish failed')
      setPublishUrl(d.url ?? '')
      setPublishStatus('success')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setPublishStatus(`error: ${msg}`)
    }
  }, [config, summary])

  const today = new Date().toISOString().split('T')[0]

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 font-mono">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">

        {/* ── Header ── */}
        <header className="border-b border-gray-800 pb-5">
          <h1 className="text-2xl font-bold tracking-tight text-white">
            <span className="text-blue-400">#</span> Slack Activity Summarizer
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Fetches your last 24h of Slack activity · summarizes with Claude · publishes to GitHub
          </p>
        </header>

        {/* ── Config form ── */}
        <section className="bg-gray-900 border border-gray-800 rounded-lg p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
            Configuration
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(
              [
                { key: 'slackToken', label: 'Slack User Token', placeholder: 'xoxp-…', required: true },
                { key: 'claudeKey', label: 'Claude API Key', placeholder: 'sk-ant-…', required: true },
                { key: 'githubToken', label: 'GitHub PAT (repo scope)', placeholder: 'ghp_…', required: false },
                { key: 'githubRepo', label: 'GitHub Repo', placeholder: 'owner/repo', required: false },
              ] as const
            ).map(({ key, label, placeholder, required }) => (
              <label key={key} className="flex flex-col gap-1">
                <span className="text-xs text-gray-500 uppercase tracking-wider">
                  {label}
                  {required && <span className="text-red-500 ml-0.5">*</span>}
                </span>
                <input
                  type={key.toLowerCase().includes('token') || key === 'claudeKey' ? 'password' : 'text'}
                  placeholder={placeholder}
                  value={config[key]}
                  onChange={(e) => setConfig((c) => ({ ...c, [key]: e.target.value }))}
                  disabled={phase === 'running'}
                  className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500 disabled:opacity-50 transition-colors"
                />
              </label>
            ))}
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={runSummary}
              disabled={phase === 'running' || !config.slackToken || !config.claudeKey}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded font-semibold text-sm transition-colors"
            >
              {phase === 'running' ? '⏳ Running…' : '▶ Run Summary'}
            </button>
            {phase === 'done' && (
              <button
                onClick={() => {
                  setPhase('setup')
                  setLogs([])
                  setSummary('')
                  setSlackData({})
                  setPublishStatus(null)
                  setPublishUrl('')
                  setVerificationOpen(false)
                }}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
              >
                ↺ Reset
              </button>
            )}
          </div>
        </section>

        {/* ── Progress log ── */}
        {logs.length > 0 && (
          <section className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
                Live Progress
              </h2>
              {activeStep && (
                <div className="flex items-center gap-3">
                  <span
                    className={`font-mono text-xs font-bold tabular-nums ${
                      countdown <= 5 ? 'text-red-400' : 'text-yellow-400'
                    }`}
                  >
                    {String(countdown).padStart(2, '0')}s
                  </span>
                  <button
                    onClick={handleSkip}
                    className="px-2.5 py-1 bg-orange-700 hover:bg-orange-600 rounded text-xs font-semibold transition-colors"
                  >
                    ⏭ Skip
                  </button>
                </div>
              )}
            </div>
            <div className="p-4 space-y-2.5 max-h-80 overflow-y-auto">
              {logs.map((entry) => (
                <LogRow key={entry.id} entry={entry} />
              ))}
              {activeStep && (
                <div className="flex items-center gap-2 text-gray-500 text-xs animate-pulse pl-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />
                  {activeStep}…
                </div>
              )}
              <div ref={logEndRef} />
            </div>
          </section>
        )}

        {/* ── AI Summary ── */}
        {summary && (
          <section className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
                AI Summary
              </h2>
              <button
                onClick={() => setVerificationOpen((v) => !v)}
                className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                {verificationOpen ? '▲ Hide raw data' : '▼ Show raw data'}
              </button>
            </div>

            <div className="p-5">
              <Markdown text={summary} />
            </div>

            {/* Verification panel */}
            {verificationOpen && (
              <div className="border-t border-gray-800 bg-gray-950 p-5">
                <p className="text-xs text-gray-600 uppercase tracking-wider mb-3 font-semibold">
                  Raw Slack Data — Verification Panel
                </p>
                <div className="space-y-3">
                  {(
                    [
                      {
                        label: `Mentions (${slackData.mentions?.length ?? 0})`,
                        data: slackData.mentions,
                      },
                      {
                        label: `Threads (${Object.keys(slackData.threads ?? {}).length})`,
                        data: slackData.threads,
                      },
                      {
                        label: `Channel Activity (${slackData.channelActivity?.length ?? 0} channels)`,
                        data: slackData.channelActivity,
                      },
                    ] as const
                  ).map(({ label, data }) => (
                    <details key={label}>
                      <summary className="text-xs text-gray-500 hover:text-gray-300 cursor-pointer transition-colors">
                        {label}
                      </summary>
                      <pre className="mt-2 text-[11px] text-gray-600 bg-black rounded p-3 overflow-x-auto max-h-64">
                        {data == null || (Array.isArray(data) && data.length === 0) || (typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 0)
                          ? 'None found'
                          : JSON.stringify(data, null, 2)}
                      </pre>
                    </details>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── GitHub publish ── */}
        {summary && config.githubToken && config.githubRepo && (
          <section className="bg-gray-900 border border-gray-800 rounded-lg p-5">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">
              Publish to GitHub
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={publishToGitHub}
                disabled={publishStatus === 'publishing' || publishStatus === 'success'}
                className="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm font-semibold transition-colors"
              >
                {publishStatus === 'publishing'
                  ? '⏳ Publishing…'
                  : publishStatus === 'success'
                  ? '✓ Published'
                  : `📤 Publish daily-slack-summary/${today}.md`}
              </button>

              {publishStatus === 'success' && publishUrl && (
                <a
                  href={publishUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-400 hover:text-blue-300 hover:underline transition-colors"
                >
                  View on GitHub →
                </a>
              )}

              {publishStatus?.startsWith('error') && (
                <span className="text-sm text-red-400">{publishStatus}</span>
              )}
            </div>
            <p className="text-xs text-gray-600 mt-2">
              Saves to{' '}
              <code className="text-gray-500">daily-slack-summary/{today}.md</code> in{' '}
              <code className="text-gray-500">{config.githubRepo}</code>.
              {' '}Updates safely if the file already exists.
            </p>
          </section>
        )}
      </div>
    </main>
  )
}
