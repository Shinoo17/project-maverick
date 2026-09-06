import { Component, type ReactNode } from 'react'

export class SceneBoundary extends Component<{ children: ReactNode; fallback: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) { console.error('Aircraft studio:', error); this.props.onError() }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}
