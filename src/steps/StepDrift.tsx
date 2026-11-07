import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Detail, Summary } from '../data'
import { linear, monthLabel, nf, niceTicks, pathFrom, shortDate } from '../data'
import { Details, Panel, Play, Step, Warn, useInViewOnce, useReducedMotion, useWidth } from '../ui'

function Trace({ d }: { d: Detail }) {
  const [wrapRef, W] = useWidth<HTMLDivElement>()
  const [inRef, seen] = useInViewOnce<HTMLDivElement>()
  const reduced = useReducedMotion()
  const i0 = d.dates.indexOf('2017-01-01')
  const N = d.dates.length - i0
  const [t, setT] = useState(N - 1)
  const [playing, setPlaying] = useState(false)
  const played = useRef<string | null>(null)

  // Play the year once when the step first comes into view (and again on plant change), unless motion is reduced.
  useEffect(() => {
    if (!seen || reduced || played.current === d.id) return
    played.current = d.id
    setT(0)
    setPlaying(true)
  }, [seen, reduced, d.id])

  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      setT((v) => {
        const nv = Math.min(N - 1, v + dt * 80)
        if (nv >= N - 1) setPlaying(false)
        return nv
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, N])

  const narrow = W < 560
  const m = { l: 46, r: 14 }
  const H1 = narrow ? 170 : 210
  const H2 = narrow ? 130 : 160
  const gap = 34

  const g = useMemo(() => {
    const ys: number[] = []
    for (let i = i0; i < d.dates.length; i++) {
      const a = d.y[i]
      const b = d.pred[i]
      if (a != null) ys.push(a / 1000)
      if (b != null) ys.push(b / 1000)
    }
    const yMax = Math.max(...ys) * 1.05
    const cMaxRaw = Math.max(d.h * 1.6, ...d.cusum_up.slice(i0).map((v) => v ?? 0), ...d.cusum_dn.slice(i0).map((v) => v ?? 0))
    const cMax = Math.min(cMaxRaw * 1.05, d.h * 3)
    const sx = linear(0, N - 1, m.l, W - m.r)
    const sy = linear(0, yMax, H1 - 8, 12)
    const sc = linear(0, cMax, H1 + gap + H2 - 22, H1 + gap + 8)
    const series = (arr: (number | null)[], s: (v: number) => number, k = 1) =>
      pathFrom(arr.slice(i0).map((v, j) => (v == null ? null : [sx(j), s(v / k)])))
    const monthStarts: number[] = []
    for (let j = 0; j < N; j++) if (d.dates[i0 + j].endsWith('-01')) monthStarts.push(j)
    const idx = (iso?: string) => (iso ? d.dates.indexOf(iso) - i0 : -1)
    return {
      sx, sy, sc, yMax, cMax, cPeak: cMaxRaw,
      actual: series(d.y, sy, 1000),
      base: series(d.pred, sy, 1000),
      up: series(d.cusum_up, sc),
      dn: series(d.cusum_dn, sc),
      yTicks: niceTicks(0, yMax, 4),
      cTicks: niceTicks(0, cMax, 3),
      monthStarts,
      onset: idx(d.alarm?.onset),
      alarm: idx(d.alarm?.date),
    }
  }, [d, W, i0, N, H1, H2])

  const day = Math.round(t)
  const xi = g.sx(day)
  const at = i0 + day
  const z = d.y[at] != null && d.pred[at] != null ? (d.y[at]! - d.pred[at]!) / d.model.sigma : null
  const alarmed = g.alarm >= 0 && day >= g.alarm
  const Htot = H1 + gap + H2
  const clipId = `clip-${d.id}`

  const scrubTo = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    setPlaying(false)
    setT(Math.max(0, Math.min(N - 1, Math.round(g.sx.invert(e.clientX - r.left)))))
  }

  return (
    <div className="trace" ref={inRef}>
      <div className="chart" ref={wrapRef}>
        <svg
          width={W}
          height={Htot}
          className="trace-svg"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            scrubTo(e)
          }}
          onPointerMove={(e) => e.buttons && scrubTo(e)}
          role="img"
          aria-label={`2017 daily load against baseline, and the CUSUM statistic against its threshold h = ${d.h}.`}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={0} y={0} width={xi + 0.5} height={Htot} />
            </clipPath>
            <clipPath id={`${clipId}-c`}>
              <rect x={0} y={H1 + gap + 2} width={xi + 0.5} height={H2} />
            </clipPath>
          </defs>
          {/* panel A: load vs baseline */}
          <g className="grid">
            {g.yTicks.map((v) => (
              <g key={v}>
                <line x1={m.l} x2={W - m.r} y1={g.sy(v)} y2={g.sy(v)} />
                <text x={m.l - 8} y={g.sy(v) + 4} textAnchor="end">{nf(v)}</text>
              </g>
            ))}
            {g.cTicks.map((v) => (
              <g key={`c${v}`}>
                <line x1={m.l} x2={W - m.r} y1={g.sc(v)} y2={g.sc(v)} />
                <text x={m.l - 8} y={g.sc(v) + 4} textAnchor="end">{nf(v)}</text>
              </g>
            ))}
            {g.monthStarts.map((j, k) =>
              narrow && k % 2 ? null : (
                <text key={j} x={g.sx(j) + 2} y={Htot - 4}>{monthLabel(k)}</text>
              ),
            )}
          </g>
          <text className="axis-title" x={m.l} y={10}>MWh(th)/day · actual vs baseline</text>
          <text className="axis-title" x={m.l} y={H1 + gap - 2}>CUSUM C⁺ (σ units)</text>
          <g className="hline">
            <line x1={m.l} x2={W - m.r} y1={g.sc(d.h)} y2={g.sc(d.h)} />
            <text x={W - m.r} y={g.sc(d.h) - 5} textAnchor="end">threshold h = {d.h}</text>
          </g>
          <g clipPath={`url(#${clipId})`}>
            <path d={g.base} className="ln-base" />
            <path d={g.actual} className="ln-actual" />
          </g>
          <g clipPath={`url(#${clipId}-c)`}>
            <path d={g.dn} className="ln-cdn" />
            <path d={g.up} className="ln-cup" />
          </g>
          {g.cPeak > g.cMax && !narrow && (
            <text className="offscale" x={W - m.r} y={H1 + gap + 6} textAnchor="end">
              {narrow ? `C⁺ peaks at ${nf(g.cPeak)}, axis cut` : `axis cut at ${nf(g.cMax)}; this plant's C⁺ reaches ${nf(g.cPeak)}`}
            </text>
          )}
          {g.onset >= 0 && day >= g.onset && (
            <g className="mk-onset">
              <line x1={g.sx(g.onset)} x2={g.sx(g.onset)} y1={12} y2={Htot - 18} />
              <text x={g.sx(g.onset) - 4} y={28} textAnchor="end">onset</text>
            </g>
          )}
          {alarmed && (
            <g className="mk-alarm">
              <line x1={g.sx(g.alarm)} x2={g.sx(g.alarm)} y1={12} y2={Htot - 18} />
              <text x={g.sx(g.alarm) + 4} y={28}>alarm</text>
            </g>
          )}
          <line className="scrub" x1={xi} x2={xi} y1={6} y2={Htot - 16} />
        </svg>
      </div>
      <div className="scrubber">
        <button
          type="button"
          className="btn"
          onClick={() => {
            if (!playing && day >= N - 1) setT(0)
            setPlaying(!playing)
          }}
          aria-label={playing ? 'Pause' : 'Play 2017'}
        >
          {playing ? <span className="pause" aria-hidden="true" /> : <Play />}
          <span>{playing ? 'Pause' : day >= N - 1 ? 'Replay 2017' : 'Play'}</span>
        </button>
        <input
          type="range"
          min={0}
          max={N - 1}
          step={1}
          value={day}
          aria-label="Day of 2017"
          aria-valuetext={shortDate(d.dates[at])}
          onChange={(e) => {
            setPlaying(false)
            setT(+e.target.value)
          }}
        />
      </div>
      <dl className="readout readout-dl" aria-live="off">
        <div><dt>date</dt><dd>{shortDate(d.dates[at])} 2017</dd></div>
        <div><dt>actual</dt><dd>{d.y[at] != null ? nf(d.y[at]! / 1000, 1) : 'n/a'}</dd></div>
        <div><dt>baseline</dt><dd>{d.pred[at] != null ? nf(d.pred[at]! / 1000, 1) : 'n/a'}</dd></div>
        <div><dt>residual z</dt><dd>{z != null ? `${z >= 0 ? '+' : '−'}${nf(Math.abs(z), 2)}` : 'n/a'}</dd></div>
        <div><dt>C⁺</dt><dd>{d.cusum_up[at] != null ? nf(d.cusum_up[at]!, 1) : 'n/a'}</dd></div>
        <div className={alarmed ? 'st-alarm' : 'st-ok'}>
          <dt>status</dt>
          <dd>{alarmed ? <><Warn /> drift since {shortDate(d.alarm!.onset)}</> : 'in control'}</dd>
        </div>
      </dl>
    </div>
  )
}

export function StepDrift({ summary, detail, picker }: { summary: Summary; detail: Detail | null; picker: ReactNode }) {
  const d = detail
  return (
    <Step
      id="drift"
      n={3}
      title="Drift shows up as the gap between a plant and its own baseline."
      lede="Scrub through 2017. Each day adds its standardised residual to the CUSUM; when the sum crosses h the alarm fires, and the onset is the last day it sat at zero."
    >
      <Panel tag="TREND" title={d ? `2017 vs 2016 baseline · ${d.alarm ? `alarm ${shortDate(d.alarm.date)}, ${d.alarm.days_to_alarm ?? '?'} days after onset` : 'no alarm in 2017'}` : 'loading'} tools={picker}>
        {d ? <Trace key={d.id} d={d} /> : <div className="chart-loading" />}
        <ul className="legend" aria-label="Legend">
          <li><i className="sw sw-actual" />actual load</li>
          <li><i className="sw sw-line" />baseline from 2016 weather model</li>
          <li><i className="sw sw-cup" />CUSUM, upward drift</li>
          <li><i className="sw sw-cdn" />CUSUM, downward</li>
        </ul>
      </Panel>
      <Details>
        <p>
          Standardised residual z = (E − Ê) / σ̂, with σ̂ the plant's 2016 residual spread. Two-sided tabular CUSUM with
          k = {summary.cusum.k}:
        </p>
        <p className="eq">C⁺ₜ = max(0, zₜ − k + C⁺ₜ₋₁) &nbsp;&nbsp; C⁻ₜ = max(0, −zₜ − k + C⁻ₜ₋₁) &nbsp;&nbsp; alarm when C⁺ or C⁻ &gt; h</p>
        <p>
          The picker holds the 30 largest sized drifts in the queue and five plants that stayed in control through 2017.
          Gaps in a line are days the meter was missing or removed by cleaning (stuck runs and Hampel spikes).
        </p>
      </Details>
    </Step>
  )
}
