import type { ComponentChildren } from 'preact'

// ── Types ──────────────────────────────────────────────────────────────────

export interface AgentAction {
  type: 'scroll' | 'highlight' | 'navigate' | 'scan' | 'tooltip'
  label: string
}

export interface ChatBubbleProps {
  role: 'user' | 'assistant'
  content: string
  actions?: AgentAction[]
  loading?: boolean
}

// ── Action icon map ────────────────────────────────────────────────────────

const ACTION_ICONS: Record<AgentAction['type'], string> = {
  scroll:    '📍',
  highlight: '🔍',
  navigate:  '🔗',
  scan:      '🧭',
  tooltip:   '💬',
}

// ── Markdown-lite renderer ─────────────────────────────────────────────────
// Handles: **bold**, *italic*, [text](url), plain text segments.
// Processes left-to-right in a single pass — no library needed for MVP.

const MD_RE = /(\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\(([^)]+)\))/g

function renderMarkdownLite(raw: string): ComponentChildren[] {
  const nodes: ComponentChildren[] = []
  let cursor = 0
  let match: RegExpExecArray | null

  MD_RE.lastIndex = 0

  while ((match = MD_RE.exec(raw)) !== null) {
    // Push any plain text before this match
    if (match.index > cursor) {
      nodes.push(raw.slice(cursor, match.index))
    }

    if (match[2]) {
      // **bold**
      nodes.push(<strong style={{ fontWeight: 600 }}>{match[2]}</strong>)
    } else if (match[3]) {
      // *italic*
      nodes.push(<em>{match[3]}</em>)
    } else if (match[4] && match[5]) {
      // [text](url)
      nodes.push(
        <a
          href={match[5]}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: 'inherit',
            textDecoration: 'underline',
            textUnderlineOffset: '2px',
            opacity: 0.85,
          }}
        >
          {match[4]}
        </a>,
      )
    }

    cursor = match.index + match[0].length
  }

  // Remaining plain text after last match
  if (cursor < raw.length) nodes.push(raw.slice(cursor))

  return nodes
}

// ── Sub-components ────────────────────────────────────────────────────────

const BRAND_PURPLE = '#5B2D8E'

function TypingDots() {
  return (
    <span style={{ display: 'inline-flex', gap: '3px', alignItems: 'center', height: '16px' }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: '#9ca3af',
            display: 'inline-block',
            animation: `wf-bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
      <style>{`
        @keyframes wf-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40%            { transform: translateY(-5px); opacity: 1; }
        }
      `}</style>
    </span>
  )
}

function ActionBadge({ action }: { action: AgentAction }) {
  return (
    <span
      style={{
        display:        'inline-flex',
        alignItems:     'center',
        gap:            '4px',
        padding:        '3px 8px',
        borderRadius:   '12px',
        fontSize:       '11px',
        fontWeight:     500,
        background:     'rgba(91,45,142,0.08)',
        color:          BRAND_PURPLE,
        border:         '1px solid rgba(91,45,142,0.15)',
        whiteSpace:     'nowrap',
      }}
    >
      <span aria-hidden="true">{ACTION_ICONS[action.type]}</span>
      {action.label}
    </span>
  )
}

// ── ChatBubble ────────────────────────────────────────────────────────────

export function ChatBubble({ role, content, actions, loading }: ChatBubbleProps) {
  const isUser = role === 'user'

  return (
    <div
      style={{
        display:        'flex',
        flexDirection:  'column',
        alignItems:     isUser ? 'flex-end' : 'flex-start',
        gap:            '5px',
      }}
    >
      {/* Bubble */}
      <div
        style={{
          maxWidth:     '82%',
          padding:      '9px 13px',
          borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
          background:   isUser ? BRAND_PURPLE : '#f4f4f5',
          color:        isUser ? '#fff' : '#111827',
          fontSize:     '13px',
          lineHeight:   '1.55',
          boxShadow:    '0 1px 2px rgba(0,0,0,0.06)',
          wordBreak:    'break-word',
          fontFamily:   'Inter, system-ui, sans-serif',
        }}
      >
        {loading ? <TypingDots /> : renderMarkdownLite(content)}
      </div>

      {/* Action badges — only on assistant messages */}
      {!isUser && actions && actions.length > 0 && (
        <div
          style={{
            display:   'flex',
            flexWrap:  'wrap',
            gap:       '4px',
            maxWidth:  '82%',
          }}
        >
          {actions.map((a, i) => (
            <ActionBadge key={i} action={a} />
          ))}
        </div>
      )}
    </div>
  )
}
