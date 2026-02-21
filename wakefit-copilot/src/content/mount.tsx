import { render } from 'preact'
import { GhostCursor } from '@/components/GhostCursor'
import { createShadowHost } from './shadow-host'

export function mountAssociate() {
  const { container } = createShadowHost()
  render(<GhostCursor />, container)
}
