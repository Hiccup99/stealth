import { useState, useEffect } from 'preact/hooks'
import { resolveChips, detectPageType, type QuickChip } from '../quick-actions-config'

const BRAND_PURPLE = '#5B2D8E'

interface Props {
  onSelect: (prompt: string) => void
  /** Phase 4: pass LLM-generated chips to override the static mapping */
  chips?: QuickChip[]
}

export function QuickActions({ onSelect, chips: overrideChips }: Props) {
  const [chips, setChips] = useState<QuickChip[]>(() => resolveChips())

  // Re-resolve chips whenever the URL changes (SPA navigations)
  useEffect(() => {
    function onUrlChange() {
      if (!overrideChips) setChips(resolveChips())
    }

    window.addEventListener('wf:urlchange', onUrlChange)
    return () => window.removeEventListener('wf:urlchange', onUrlChange)
  }, [overrideChips])

  // Phase 4: if parent passes LLM chips, use those instead
  useEffect(() => {
    if (overrideChips) setChips(overrideChips)
  }, [overrideChips])

  const active = overrideChips ?? chips
  if (!active.length) return null

  return (
    <div
      style={{
        padding:    '8px 12px',
        borderTop:  '1px solid #f0f0f0',
        display:    'flex',
        flexWrap:   'wrap',
        gap:        '6px',
      }}
    >
      {/* Page-type label — helpful for debugging, hidden visually via small muted text */}
      <span
        style={{
          width:      '100%',
          fontSize:   '10px',
          color:      '#d1d5db',
          marginBottom: '2px',
          letterSpacing: '0.03em',
          userSelect: 'none',
        }}
      >
        {overrideChips ? '✨ suggested' : detectPageType()}
      </span>

      {active.map((chip) => (
        <Chip key={chip.label} chip={chip} onSelect={onSelect} />
      ))}
    </div>
  )
}

// ── Chip ───────────────────────────────────────────────────────────────────

function Chip({ chip, onSelect }: { chip: QuickChip; onSelect: (p: string) => void }) {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      onClick={() => onSelect(chip.prompt)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={chip.prompt}
      style={{
        padding:      '5px 11px',
        borderRadius: '20px',
        border:       `1.5px solid ${hovered ? BRAND_PURPLE : '#e5e7eb'}`,
        background:   hovered ? 'rgba(91,45,142,0.06)' : '#fafafa',
        color:        hovered ? BRAND_PURPLE : '#374151',
        fontSize:     '12px',
        fontWeight:   500,
        cursor:       'pointer',
        fontFamily:   'Inter, system-ui, sans-serif',
        transition:   'border-color 150ms, background 150ms, color 150ms',
        whiteSpace:   'nowrap',
        lineHeight:   1.4,
      }}
    >
      {chip.label}
    </button>
  )
}
