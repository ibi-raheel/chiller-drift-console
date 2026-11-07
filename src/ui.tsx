import { useEffect, useRef, useState, type ReactNode } from 'react'

export function useWidth<T extends HTMLElement>(fallback = 720) {
  const ref = useRef<T>(null)
  const [w, setW] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.observe(el)
    setW(Math.round(el.getBoundingClientRect().width))
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

export function useReducedMotion() {
  const q = '(prefers-reduced-motion: reduce)'
  const [r, setR] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const on = () => setR(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return r
}

export function useInViewOnce<T extends HTMLElement>(margin = '0px 0px -30% 0px') {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || seen) return
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { rootMargin: margin })
    io.observe(el)
    return () => io.disconnect()
  }, [seen, margin])
  return [ref, seen] as const
}

export function Step(props: { id: string; n: number; title: ReactNode; lede: ReactNode; children: ReactNode }) {
  return (
    <section className="step" id={props.id} data-step={props.n} aria-labelledby={`${props.id}-h`}>
      <header className="step-head">
        <span className="step-n" aria-hidden="true">
          {props.n}
        </span>
        <h2 id={`${props.id}-h`}>{props.title}</h2>
        <p className="lede">{props.lede}</p>
      </header>
      {props.children}
    </section>
  )
}

/** A BMS-style graphic window: thin title strip, then the drawing. */
export function Panel(props: { tag: string; title: ReactNode; tools?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <figure className={`panel ${props.className ?? ''}`}>
      <figcaption className="panel-bar">
        <span className="panel-tag">{props.tag}</span>
        <span className="panel-title">{props.title}</span>
        {props.tools && <span className="panel-tools">{props.tools}</span>}
      </figcaption>
      <div className="panel-body">{props.children}</div>
    </figure>
  )
}

export function Details(props: { label?: string; children: ReactNode }) {
  return (
    <details className="details">
      <summary>
        <Chevron />
        <span>{props.label ?? 'Show details'}</span>
      </summary>
      <div className="details-body">{props.children}</div>
    </details>
  )
}

export const Chevron = () => (
  <svg className="chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <path d="M4 2.5 7.5 6 4 9.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export const Check = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="ico-check">
    <rect x="1.5" y="1.5" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.2" />
    <path d="M4.2 8.3 6.8 10.8 11.8 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export const Warn = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="ico-warn">
    <path d="M8 1.8 15 14H1z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <path d="M8 6v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <circle cx="8" cy="12" r=".9" fill="currentColor" />
  </svg>
)

export const Play = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <path d="M3 2v8l7-4z" fill="currentColor" />
  </svg>
)

/** Floating readout that follows the pointer inside a chart box. */
export function Tip(props: { x: number; y: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(props.x + 12, 4), props.width - 180)
  return (
    <div className="tip" style={{ transform: `translate(${left}px, ${Math.max(props.y - 12, 0)}px)` }} role="status">
      {props.children}
    </div>
  )
}
