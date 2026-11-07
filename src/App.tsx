import { useEffect, useState } from 'react'
import type { Detail, QueueRow, Summary } from './data'
import { DEFAULT_PLANT, DETAIL_RANK_MAX, IN_CONTROL, loadDetail, loadQueue, loadSummary } from './data'
import { Hero } from './steps/Hero'
import { StepWeather } from './steps/StepWeather'
import { StepModels } from './steps/StepModels'
import { StepDrift } from './steps/StepDrift'
import { StepThreshold } from './steps/StepThreshold'
import { StepQueue } from './steps/StepQueue'
import { StepProof } from './steps/StepProof'

const STEPS = [
  { id: 'weather', label: 'Load follows weather' },
  { id: 'baseline', label: 'Pick a baseline' },
  { id: 'drift', label: 'Drift as residual' },
  { id: 'threshold', label: 'Calibrate the alarm' },
  { id: 'queue', label: 'Fix these first' },
  { id: 'proof', label: 'How we know' },
]

function useScrollStep() {
  const [state, setState] = useState({ active: -1, progress: 0 })
  useEffect(() => {
    let raf = 0
    const measure = () => {
      raf = 0
      const line = window.innerHeight * 0.4
      let active = -1
      STEPS.forEach((s, i) => {
        const el = document.getElementById(s.id)
        if (el && el.getBoundingClientRect().top <= line) active = i
      })
      const first = document.getElementById(STEPS[0].id)
      const doc = document.documentElement
      const start = first ? first.getBoundingClientRect().top + window.scrollY - line : 0
      const end = doc.scrollHeight - window.innerHeight
      const progress = Math.min(1, Math.max(0, (window.scrollY - start) / Math.max(1, end - start)))
      setState((p) => (p.active === active && Math.abs(p.progress - progress) < 0.002 ? p : { active, progress }))
    }
    const on = () => {
      if (!raf) raf = requestAnimationFrame(measure)
    }
    measure()
    window.addEventListener('scroll', on, { passive: true })
    window.addEventListener('resize', on)
    return () => {
      window.removeEventListener('scroll', on)
      window.removeEventListener('resize', on)
      cancelAnimationFrame(raf)
    }
  }, [])
  return state
}

function Rail({ active, progress }: { active: number; progress: number }) {
  return (
    <>
      <nav className="rail" aria-label="Steps">
        <p className="rail-title">Walk-through</p>
        <ol>
          {STEPS.map((s, i) => (
            <li key={s.id} className={i === active ? 'on' : i < active ? 'done' : ''}>
              <a href={`#${s.id}`} aria-current={i === active ? 'step' : undefined}>
                <span className="rail-n">{i + 1}</span>
                <span className="rail-l">{s.label}</span>
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <div className={`mbar ${active >= 0 ? 'show' : ''}`} aria-hidden="true">
        <div className="mbar-row">
          <span className="mbar-n">{active >= 0 ? `${active + 1} / ${STEPS.length}` : ''}</span>
          <span className="mbar-l">{active >= 0 ? STEPS[active].label : ''}</span>
        </div>
        <div className="mbar-track">
          <span style={{ transform: `scaleX(${progress})` }} />
        </div>
      </div>
    </>
  )
}

export function App() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [queue, setQueue] = useState<QueueRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [plant, setPlant] = useState(DEFAULT_PLANT)
  const [detail, setDetail] = useState<Detail | null>(null)
  const { active, progress } = useScrollStep()

  useEffect(() => {
    Promise.all([loadSummary(), loadQueue()])
      .then(([s, q]) => {
        setSummary(s)
        setQueue(q)
      })
      .catch((e) => setError(String(e)))
  }, [])

  useEffect(() => {
    let live = true
    loadDetail(plant)
      .then((d) => live && setDetail(d))
      .catch((e) => setError(String(e)))
    return () => {
      live = false
    }
  }, [plant])

  if (error) return <p className="fail">Could not load the precomputed results ({error}). Reload to try again.</p>
  if (!summary) return <p className="boot">Loading precomputed results…</p>

  const ranked = queue.filter((r) => r.rank <= DETAIL_RANK_MAX).sort((a, b) => a.rank - b.rank)
  const picker = (
    <label className="picker">
      <span className="sr">Plant</span>
      <select value={plant} onChange={(e) => setPlant(e.target.value)}>
        <optgroup label="Drifting, by queue rank">
          {ranked.map((r) => (
            <option key={r.id} value={r.id}>
              #{r.rank} {r.id}
            </option>
          ))}
        </optgroup>
        <optgroup label="In control through 2017">
          {IN_CONTROL.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </optgroup>
      </select>
    </label>
  )

  return (
    <>
      <Rail active={active} progress={progress} />
      <main className="page">
        <Hero summary={summary} />
        <StepWeather summary={summary} detail={detail} picker={picker} />
        <StepModels summary={summary} />
        <StepDrift summary={summary} detail={detail} picker={picker} />
        <StepThreshold summary={summary} />
        <StepQueue summary={summary} queue={queue} />
        <StepProof summary={summary} />
        <footer className="foot">
          <p>
            Data: Building Data Genome Project 2. Miller, C. et al. (2020), <i>Scientific Data</i> 7, 368,{' '}
            <a href="https://doi.org/10.1038/s41597-020-00712-x">doi:10.1038/s41597-020-00712-x</a>. Licensed{' '}
            <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>; the derived results on this page are shared under
            the same licence. Real chilled-water meters from campus and commercial buildings, 2016–2017. The only synthetic data are the
            labelled step faults in step 6.
          </p>
          <p>All results are precomputed by the Python pipeline in this repository and shipped as static files.</p>
          <p className="foot-sign">
            More work at <a href="https://ibiraheel.com">ibiraheel.com</a>
          </p>
        </footer>
      </main>
    </>
  )
}
