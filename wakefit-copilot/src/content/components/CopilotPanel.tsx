import { useState, useEffect, useRef } from 'preact/hooks'
import { associateStore, type AssociatePhase } from '@/store/associateStore'
import { pageStore } from '@/store/page-store'
import type { ProductPageData } from '../modules/page-scanner'
import { ChatBubble, type AgentAction as DisplayAction } from './ChatBubble'
import { QuickActions } from './QuickActions'
import type { AgentAction as ExecutableAction } from '../modules/action-executor'
import { executeActions } from '../modules/action-executor'
import {
  query,
  detectCapability,
  onNavigate as routerOnNavigate,
  isLLMAvailable,
  type LLMMode,
} from '@/ai/llm-router'
import type { QuickChip } from '../quick-actions-config'
import { requirementsStore, type UserRequirements } from '@/store/user-requirements-store'

// ── Constants ─────────────────────────────────────────────────────────────────

const BRAND_PURPLE = '#5B2D8E'
const PANEL_W      = 400
const PANEL_H      = 520
const EDGE_GAP     = 24

const GHOST_PHASES: AssociatePhase[] = ['navigating', 'highlighting']

// ── Types ─────────────────────────────────────────────────────────────────────

type PanelMode = 'minimized' | 'expanded' | 'ghost_active'

interface Message {
  id:       string
  role:     'user' | 'assistant'
  content:  string
  actions?: DisplayAction[]
}

// ── Welcome message ───────────────────────────────────────────────────────────

function buildWelcomeMessage(pageData: ProductPageData, navigatedFrom: string | null): string {
  switch (pageData.pageType) {
    case 'home':
      return "Welcome to Wakefit! 👋 I'm your personal shopping concierge. What are you looking for today — a mattress, bed frame, pillow, or something else?"
    case 'category': {
      const cat = pageData.categoryData?.categoryName
      return cat
        ? `You're browsing **${cat}**. I can help you find the right one for your needs — tell me your budget or requirements!`
        : "You're browsing our collection. Tell me what you're looking for and I'll help you find the best match!"
    }
    case 'cart':
      return "You have items in your cart! Want me to confirm your choices or suggest any complementary products?"
    case 'product': {
      const name = pageData.product?.name
      if (navigatedFrom && navigatedFrom !== name) {
        return `I see you've moved on to **${name ?? 'this product'}**. Want me to walk you through it?`
      }
      if (name) {
        return `Hi! I can help you explore the **${name}**. What would you like to know?`
      }
      return "Hi! I'm your **Wakefit Co-Pilot**. How can I help you today?"
    }
    default:
      return "Hi! I'm your **Wakefit Co-Pilot**. Navigate to any product page and I'll help you make the right choice!"
  }
}

// ── Requirements summary pill ─────────────────────────────────────────────────

function formatRequirementsSummary(req: UserRequirements): string | null {
  const parts: string[] = []
  if (req.productCategory) parts.push(req.productCategory)
  if (req.size)             parts.push(req.size)
  if (req.budget) {
    const { min, max } = req.budget
    if (min && max) parts.push(`₹${min.toLocaleString('en-IN')}–₹${max.toLocaleString('en-IN')}`)
    else if (max)   parts.push(`under ₹${max.toLocaleString('en-IN')}`)
    else if (min)   parts.push(`from ₹${min.toLocaleString('en-IN')}`)
  }
  if (req.sleepPosition)     parts.push(`${req.sleepPosition} sleeper`)
  if (req.concerns?.length)  parts.push(req.concerns[0]!)
  return parts.length >= 2 ? parts.join(' · ') : null
}

// ── Action type bridge ────────────────────────────────────────────────────────
// Executable actions (from LLM router) → display badges (for ChatBubble).
// The two types are intentionally separate: display badges are cosmetic;
// executable actions drive the ghost cursor and highlight overlay.

function toDisplayActions(actions: ExecutableAction[]): DisplayAction[] {
  return actions.flatMap((a): DisplayAction[] => {
    switch (a.type) {
      case 'scroll_to':
        return [{ type: 'scroll',    label: a.label ?? a.target }]
      case 'highlight':
        return [{ type: 'highlight', label: a.label ?? a.target }]
      case 'walk_through':
        return [{ type: 'scan',      label: `Tour: ${a.targets.slice(0, 2).join(', ')}` }]
      case 'compare':
        return [{ type: 'highlight', label: 'Comparing items' }]
      case 'read_aloud':
        return [{ type: 'tooltip',   label: 'Reading aloud' }]
      case 'navigate_to':
        return [{ type: 'scroll',    label: `→ ${a.label ?? 'Navigate'}` }]
      case 'open_product':
        return [{ type: 'scroll',    label: `→ ${a.label ?? 'Open product'}` }]
      case 'set_requirement':
        return []  // Silent — no display badge
      case 'ask_question':
        return []  // Handled separately as choice chips
      case 'answer':
        return []
    }
  })
}

// ── Contextual follow-up chips ────────────────────────────────────────────────
// After the AI performs a visual action, suggest related follow-up questions
// based on which section was just shown.

function deriveFollowupChips(actions: ExecutableAction[], pageData: ProductPageData): QuickChip[] {
  const targets = new Set(
    actions.flatMap(a => {
      if (a.type === 'scroll_to' || a.type === 'highlight') return [a.target]
      if (a.type === 'walk_through') return a.targets
      if (a.type === 'compare')      return a.items.map(i => i.target)
      return []
    }),
  )

  const chips: QuickChip[] = []
  if (targets.has('specifications') || targets.has('specs') || targets.has('dimensions')) {
    chips.push({ label: '📐 Exact dimensions', prompt: 'What are the exact dimensions?' })
  }
  if (targets.has('price') || targets.has('sizes')) {
    chips.push({ label: '💳 EMI options', prompt: 'What are the EMI options?' })
  }
  if (targets.has('trial') || targets.has('warranty')) {
    chips.push({ label: '↩️ How to return', prompt: 'How does the return process work?' })
  }
  if (pageData.pageType === 'product') {
    chips.push({ label: '🆚 Compare alternatives', prompt: 'How does this compare to similar products?' })
  }
  return chips.slice(0, 3)
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CopilotPanel() {
  const [mode, setMode]         = useState<PanelMode>('minimized')
  const [rendered, setRendered] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [slowResponse, setSlowResponse] = useState(false)
  const [llmUnavailable, setLlmUnavailable] = useState(false)
  const [queryAbortController, setQueryAbortController] = useState<AbortController | null>(null)

  // Page data from the scanner (arrives slightly after mount — see index.ts)
  const [pageData, setPageData] = useState<ProductPageData | null>(null)
  // LLM backend in use — shown as a subtle badge in the header
  const [llmMode, setLlmMode]   = useState<LLMMode | null>(null)
  // Contextual follow-up chips derived from the last LLM response actions
  const [llmChips, setLlmChips] = useState<QuickChip[] | undefined>()

  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  // User requirements gathered across the session
  const [requirements, setRequirements] = useState<UserRequirements>({})
  // Choice chips from ask_question actions
  const [choiceChips, setChoiceChips]   = useState<{ question: string; options: string[] } | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef       = useRef<HTMLInputElement>(null)
  // Prevent showing the welcome message more than once per mount
  const hasGreetedRef  = useRef(false)

  // ── Subscribe to pageStore ────────────────────────────────────────────────
  // scan() runs synchronously AFTER render() in index.ts, so by the time
  // useEffect fires the data is already in the store — read it directly.
  useEffect(() => {
    const snapshot = pageStore.getState().data
    if (snapshot) setPageData(snapshot)
    return pageStore.subscribe((state) => setPageData(state.data))
  }, [])

  // ── Subscribe to requirementsStore and load from session storage ──────────
  useEffect(() => {
    requirementsStore.getState().load()
    setRequirements(requirementsStore.getState().requirements)
    return requirementsStore.subscribe((state) => setRequirements(state.requirements))
  }, [])

  // ── Show welcome message when page data arrives ───────────────────────────
  useEffect(() => {
    if (!pageData || hasGreetedRef.current) return
    hasGreetedRef.current = true
    const navigatedFrom = pageStore.getState().navigatedFrom
    setMessages([{
      id:      'welcome',
      role:    'assistant',
      content: buildWelcomeMessage(pageData, navigatedFrom),
    }])
  }, [pageData])

  // ── Detect LLM capability (badge only — routing is automatic) ────────────
  useEffect(() => {
    detectCapability().then(setLlmMode).catch(() => setLlmMode('gemini'))
    isLLMAvailable().then(setLlmUnavailable).catch(() => setLlmUnavailable(true))
  }, [])

  // ── SPA navigation — reset sessions and contextual state ─────────────────
  useEffect(() => {
    function onNavigation() {
      routerOnNavigate()        // reset Nano session + cloud history
      setLlmChips(undefined)    // clear contextual chips
      hasGreetedRef.current = false  // allow re-greeting on next data arrival
    }
    window.addEventListener('wf:urlchange', onNavigation)
    return () => window.removeEventListener('wf:urlchange', onNavigation)
  }, [])

  // ── Sync ghost phases → panel mode ───────────────────────────────────────
  useEffect(() => {
    return associateStore.subscribe((state) => {
      if (GHOST_PHASES.includes(state.phase) && mode === 'expanded') {
        setMode('ghost_active')
      } else if (!GHOST_PHASES.includes(state.phase) && mode === 'ghost_active') {
        setMode('expanded')
      }
    })
  // mode is needed as a dependency so we compare against the current value
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // ── Panel open/close animation ────────────────────────────────────────────
  useEffect(() => {
    if (mode === 'expanded' || mode === 'ghost_active') {
      const id = requestAnimationFrame(() => setRendered(true))
      return () => cancelAnimationFrame(id)
    } else {
      setRendered(false)
    }
  }, [mode])

  // ── Auto-scroll to latest message ─────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // ── Handlers ──────────────────────────────────────────────────────────────

  function expand() {
    setMode('expanded')
    setTimeout(() => inputRef.current?.focus(), 220)
  }

  function minimize() {
    setRendered(false)
    setTimeout(() => setMode('minimized'), 200)
  }

  /**
   * Core submit flow — shared by the text input and quick-action chips.
   * @param textOverride  When set, bypasses the `input` state (quick actions).
   */
  async function sendMessage(textOverride?: string) {
    const text = (textOverride ?? input).trim()
    if (!text || loading) return

    if (!pageData) {
      setMessages(m => [...m, {
        id:      `sys-${Date.now()}`,
        role:    'assistant',
        content: 'Still scanning the page, please try again in a moment…',
      }])
      return
    }

    // Clear any previous choice chips when user sends a new message
    setChoiceChips(null)

    // 1. Append user bubble
    setMessages(m => [...m, { id: `u-${Date.now()}`, role: 'user', content: text }])
    if (!textOverride) setInput('')
    setLoading(true)
    setSlowResponse(false)
    associateStore.getState().setPhase('thinking')

    // Abort controller for timeout
    const abortCtrl = new AbortController()
    setQueryAbortController(abortCtrl)

    // Slow response indicators
    const slowTimer = setTimeout(() => setSlowResponse(true), 5000)
    const verySlowTimer = setTimeout(() => {
      setMessages(m => [...m, {
        id:      `slow-${Date.now()}`,
        role:    'assistant',
        content: 'Still thinking...',
      }])
    }, 8000)

    try {
      // 2. Route to Nano or Cloud
      const response = await query(text, pageData)

      clearTimeout(slowTimer)
      clearTimeout(verySlowTimer)
      setSlowResponse(false)

      // LLM unavailable — show fallback
      if (response.unavailable) {
        setLlmUnavailable(true)
        setMessages(m => [...m, {
          id:      `unavail-${Date.now()}`,
          role:    'assistant',
          content: "I'm having trouble thinking right now. Here are some quick links:",
        }])
        setLlmChips(undefined) // Show static chips
        return
      }

      // 3. Append assistant bubble with display badges
      const displayActions = toDisplayActions(response.actions)
      setMessages(m => [...m, {
        id:      `a-${Date.now()}`,
        role:    'assistant',
        content: response.message,
        actions: displayActions.length ? displayActions : undefined,
      }])

      // 4. Execute visual actions (fire-and-forget; ghost cursor runs async)
      if (response.actions.length > 0) {
        const results = await executeActions(response.actions, { continueOnError: true })

        // Surface ask_question choice chips if present
        for (const result of results) {
          if (result.question) {
            setChoiceChips({
              question: result.question.text,
              options:  result.question.options ?? [],
            })
            break
          }
        }

        // Check for element not found errors
        const notFound = results.find(r => r.elementNotFound)
        if (notFound) {
          console.warn('[CopilotPanel] Element not found:', notFound.reason)
          setMessages(m => [...m, {
            id:      `notfound-${Date.now()}`,
            role:    'assistant',
            content: "I couldn't find that section on this page. Let me try to help with text instead.",
          }])
        } else {
          console.debug('[CopilotPanel] Actions executed:', results.map(r => ({ ok: r.ok })))
        }

        // 5. Update quick actions based on what the AI just highlighted
        const followups = deriveFollowupChips(response.actions, pageData)
        setLlmChips(followups.length ? followups : undefined)
      } else {
        setLlmChips(undefined)
      }
    } catch (err) {
      clearTimeout(slowTimer)
      clearTimeout(verySlowTimer)
      setSlowResponse(false)
      const msg = err instanceof Error ? err.message : 'Something went wrong. Please try again.'
      setMessages(m => [...m, { id: `e-${Date.now()}`, role: 'assistant', content: msg }])
    } finally {
      setLoading(false)
      setQueryAbortController(null)
      associateStore.getState().setPhase('listening')
    }
  }

  function cancelQuery() {
    if (queryAbortController) {
      queryAbortController.abort()
      setQueryAbortController(null)
      setLoading(false)
      setSlowResponse(false)
      setMessages(m => [...m, {
        id:      `cancel-${Date.now()}`,
        role:    'assistant',
        content: 'Query cancelled.',
      }])
      associateStore.getState().setPhase('listening')
    }
  }

  /** Quick-action chip click — directly submits, does not pre-fill the input. */
  function handleQuickAction(prompt: string) {
    sendMessage(prompt)
  }

  /** Choice chip click from ask_question action — sends as a user message. */
  function handleChoiceChip(option: string) {
    setChoiceChips(null)
    sendMessage(option)
  }

  // ── Drag ──────────────────────────────────────────────────────────────────

  function onDragStart(e: MouseEvent) {
    const startX   = e.clientX
    const startY   = e.clientY
    const originOx = dragOffset.x
    const originOy = dragOffset.y

    function onMove(ev: MouseEvent) {
      setDragOffset({ x: originOx + (ev.clientX - startX), y: originOy + (ev.clientY - startY) })
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    e.preventDefault()
  }

  // ── Render: FAB (minimized) ───────────────────────────────────────────────

  if (mode === 'minimized') {
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768
    return (
      <button
        onClick={expand}
        title="Open Wakefit Co-Pilot"
        style={{
          position:       'fixed',
          bottom:         isMobile ? `${EDGE_GAP}px` : `${EDGE_GAP}px`,
          right:          isMobile ? `${EDGE_GAP}px` : `${EDGE_GAP}px`,
          width:          '56px',
          height:         '56px',
          borderRadius:   '50%',
          background:     BRAND_PURPLE,
          border:         'none',
          cursor:         'pointer',
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          boxShadow:      '0 8px 32px rgba(0,0,0,0.22)',
          fontSize:       '24px',
          transition:     'transform 150ms ease, box-shadow 150ms ease',
          zIndex:         1,
        }}
        onMouseEnter={(e) => {
          ;(e.currentTarget as HTMLButtonElement).style.transform  = 'scale(1.08)'
          ;(e.currentTarget as HTMLButtonElement).style.boxShadow  = '0 12px 40px rgba(0,0,0,0.28)'
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLButtonElement).style.transform  = 'scale(1)'
          ;(e.currentTarget as HTMLButtonElement).style.boxShadow  = '0 8px 32px rgba(0,0,0,0.22)'
        }}
      >
        🤖
      </button>
    )
  }

  // ── Render: expanded / ghost_active ──────────────────────────────────────

  const isGhost = mode === 'ghost_active'
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768
  const bottom  = isMobile ? 0 : (EDGE_GAP - dragOffset.y)
  const right   = isMobile ? 0 : (EDGE_GAP - dragOffset.x)

  return (
    <div
      style={{
        position:        'fixed',
        bottom:           isMobile ? '0' : `${bottom}px`,
        right:            isMobile ? '0' : `${right}px`,
        left:             isMobile ? '0' : 'auto',
        width:            isMobile ? '100%' : `${PANEL_W}px`,
        maxHeight:        isMobile ? '80vh' : `${PANEL_H}px`,
        display:          'flex',
        flexDirection:    'column',
        borderRadius:     isMobile ? '16px 16px 0 0' : '16px',
        boxShadow:        isMobile ? '0 -4px 24px rgba(0,0,0,0.15)' : '0 8px 32px rgba(0,0,0,0.12)',
        background:       '#fff',
        overflow:         'hidden',
        fontFamily:       'Inter, system-ui, sans-serif',
        zIndex:           1,
        opacity:          rendered ? (isGhost ? 0.45 : 1) : 0,
        transform:        rendered ? (isMobile ? 'translateY(0)' : 'scale(1)') : (isMobile ? 'translateY(100%)' : 'scale(0.95)'),
        transformOrigin:  isMobile ? 'bottom center' : 'bottom right',
        transition:       'opacity 200ms ease-out, transform 200ms ease-out',
        pointerEvents:    isGhost ? 'none' : 'auto',
      }}
    >
      {/* ── Header ── */}
      <div
        onMouseDown={onDragStart}
        style={{
          background:     BRAND_PURPLE,
          padding:        '12px 16px',
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          cursor:         'grab',
          userSelect:     'none',
          flexShrink:     0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '9px', color: '#fff' }}>
          <span style={{ fontSize: '20px', lineHeight: 1 }}>🤖</span>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, lineHeight: 1.2 }}>Wakefit Co-Pilot</div>
            <div style={{ fontSize: '11px', opacity: 0.72, marginTop: '1px' }}>
              {llmMode ? `AI · ${llmMode}` : 'AI Showroom Associate'}
            </div>
          </div>
        </div>

        <button
          onClick={minimize}
          onMouseDown={(e) => e.stopPropagation()}
          title="Minimize"
          style={{
            background:     'rgba(255,255,255,0.15)',
            border:         'none',
            borderRadius:   '6px',
            color:          '#fff',
            width:          '28px',
            height:         '28px',
            cursor:         'pointer',
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            fontSize:       '15px',
            fontWeight:     700,
            lineHeight:     1,
            transition:     'background 150ms',
          }}
          onMouseEnter={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.28)'
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.15)'
          }}
        >
          —
        </button>
      </div>

      {/* ── Messages ── */}
      <div
        style={{
          flex:           1,
          overflowY:      'auto',
          padding:        '12px',
          display:        'flex',
          flexDirection:  'column',
          gap:            '8px',
          minHeight:      '200px',
          scrollbarWidth: 'thin',
          scrollbarColor: '#d1d5db transparent',
        }}
      >
        {messages.map((msg) => (
          <ChatBubble key={msg.id} role={msg.role} content={msg.content} actions={msg.actions} />
        ))}
        {loading && (
          <>
            <ChatBubble role="assistant" content="" loading />
            {slowResponse && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '8px' }}>
                <button
                  onClick={cancelQuery}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '16px',
                    border: '1.5px solid #e5e7eb',
                    background: '#fff',
                    color: '#6b7280',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Requirements summary pill ── */}
      {(() => {
        const summary = formatRequirementsSummary(requirements)
        if (!summary) return null
        return (
          <div
            style={{
              margin:       '0 12px 4px',
              padding:      '5px 10px',
              borderRadius: '20px',
              background:   '#f3f0f9',
              border:       '1px solid #e8e0f5',
              fontSize:     '11px',
              color:        '#5B2D8E',
              fontWeight:   500,
              display:      'flex',
              alignItems:   'center',
              gap:          '6px',
              flexShrink:   0,
              overflow:     'hidden',
              whiteSpace:   'nowrap',
              textOverflow: 'ellipsis',
            }}
          >
            <span>🎯</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>Looking for: {summary}</span>
            <button
              onClick={() => { requirementsStore.getState().clearRequirements(); setChoiceChips(null) }}
              title="Clear preferences"
              style={{
                marginLeft:   'auto',
                background:   'none',
                border:       'none',
                cursor:       'pointer',
                color:        '#9ca3af',
                fontSize:     '13px',
                padding:      '0 2px',
                lineHeight:   1,
                flexShrink:   0,
              }}
            >
              ×
            </button>
          </div>
        )
      })()}

      {/* ── Choice chips from ask_question ── */}
      {choiceChips && choiceChips.options.length > 0 && (
        <div
          style={{
            padding:      '4px 12px 6px',
            display:      'flex',
            flexWrap:     'wrap',
            gap:          '6px',
            flexShrink:   0,
          }}
        >
          {choiceChips.options.map((opt) => (
            <button
              key={opt}
              onClick={() => handleChoiceChip(opt)}
              style={{
                padding:      '5px 12px',
                borderRadius: '16px',
                border:       `1.5px solid ${BRAND_PURPLE}`,
                background:   '#fff',
                color:        BRAND_PURPLE,
                fontSize:     '12px',
                fontWeight:   500,
                cursor:       'pointer',
                fontFamily:   'inherit',
                transition:   'background 120ms, color 120ms',
              }}
              onMouseEnter={(e) => {
                const b = e.currentTarget as HTMLButtonElement
                b.style.background = BRAND_PURPLE
                b.style.color = '#fff'
              }}
              onMouseLeave={(e) => {
                const b = e.currentTarget as HTMLButtonElement
                b.style.background = '#fff'
                b.style.color = BRAND_PURPLE
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      {/* ── Quick actions — static chips or LLM-derived follow-ups ── */}
      <QuickActions onSelect={handleQuickAction} chips={llmUnavailable ? undefined : llmChips} />

      {/* ── Input bar ── */}
      <div
        style={{
          padding:    '10px 12px',
          borderTop:  '1px solid #f0f0f0',
          display:    'flex',
          gap:        '8px',
          flexShrink: 0,
        }}
      >
        <input
          ref={inputRef}
          value={input}
          onInput={(e) => setInput((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          placeholder={
            !pageData              ? 'Scanning page…' :
            pageData.pageType === 'home'     ? 'What are you looking for?' :
            pageData.pageType === 'category' ? 'Tell me your budget or needs…' :
            pageData.pageType === 'product'  ? 'Ask about this product…' :
            'Ask me anything…'
          }
          disabled={loading}
          style={{
            flex:         1,
            padding:      '8px 14px',
            borderRadius: '20px',
            border:       '1.5px solid #e5e7eb',
            fontSize:     '13px',
            outline:      'none',
            fontFamily:   'inherit',
            color:        '#111827',
            transition:   'border-color 150ms',
            background:   '#fff',
          }}
          onFocus={(e) => {
            ;(e.currentTarget as HTMLInputElement).style.borderColor = BRAND_PURPLE
          }}
          onBlur={(e) => {
            ;(e.currentTarget as HTMLInputElement).style.borderColor = '#e5e7eb'
          }}
        />
        <button
          onClick={() => sendMessage()}
          disabled={loading || !input.trim()}
          style={{
            background:   BRAND_PURPLE,
            border:       'none',
            borderRadius: '20px',
            color:        '#fff',
            padding:      '8px 16px',
            fontSize:     '13px',
            fontWeight:   500,
            cursor:       loading ? 'not-allowed' : 'pointer',
            opacity:      loading || !input.trim() ? 0.55 : 1,
            transition:   'opacity 150ms',
            whiteSpace:   'nowrap',
            fontFamily:   'inherit',
          }}
        >
          Send
        </button>
      </div>
    </div>
  )
}
