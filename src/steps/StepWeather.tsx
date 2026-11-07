import { useMemo, useState, type ReactNode } from 'react'
import type { Detail, Summary } from '../data'
import { changepoint, driverName, linear, nf, niceTicks, pathFrom, pct, shortDate } from '../data'
import { Details, Panel, Step, Tip, useWidth } from '../ui'

type Pt = { i: number; x: number; y: number; w: number; px: number; py: number }

function Scatter({ d }: { d: Detail }) {
  const [ref, W] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<Pt | null>(null)
  const H = Math.round(Math.min(440, Math.max(300, W * 0.56)))
  const m = { l: 50, r: 14, t: 18, b: 42 }

  const { pts, sx, sy, xTicks, yTicks, lines, cps } = useMemo(() => {
    const rows: { i: number; x: number; y: number; w: number }[] = []
    d.dates.forEach((date, i) => {
      const x = d.x[i]
      const y = d.y[i]
      if (date.startsWith('2016') && x != null && y != null) rows.push({ i, x, y: y / 1000, w: d.w[i] })
    })
    const xs = rows.map((r) => r.x)
    const x0 = Math.floor(Math.min(...xs) - 1)
    const x1 = Math.ceil(Math.max(...xs) + 1)
    const yMax = Math.max(...rows.map((r) => r.y)) * 1.06
    const sx = linear(x0, x1, m.l, W - m.r)
    const sy = linear(0, yMax, H - m.b, m.t)
    const pts: Pt[] = rows.map((r) => ({ ...r, px: sx(r.x), py: sy(r.y) }))
    const grid = Array.from({ length: 121 }, (_, k) => x0 + ((x1 - x0) * k) / 120)
    const line = (w: number) => pathFrom(grid.map((x) => [sx(x), sy(changepoint(d.model, x, w) / 1000)]))
    return { pts, sx, sy, xTicks: niceTicks(x0, x1, W < 480 ? 5 : 8), yTicks: niceTicks(0, yMax, 5), lines: { wd: line(0), we: line(1) }, cps: d.model.cps }
  }, [d, W, H])

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - r.left
    const my = e.clientY - r.top
    let best: Pt | null = null
    let bd = 26 * 26
    for (const p of pts) {
      const dd = (p.px - mx) ** 2 + (p.py - my) ** 2
      if (dd < bd) {
        bd = dd
        best = p
      }
    }
    setHover(best)
  }


  return (
    <div className="chart" ref={ref}>
      <svg width={W} height={H} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={`Daily chilled-water load against outdoor ${driverName(d.model.driver)}, 2016, with the fitted change-point baseline.`}>
        <g className="grid">
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={m.l} x2={W - m.r} y1={sy(t)} y2={sy(t)} />
              <text x={m.l - 8} y={sy(t) + 4} textAnchor="end">{nf(t)}</text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={t} x={sx(t)} y={H - m.b + 18} textAnchor="middle">{nf(t)}</text>
          ))}
        </g>
        <text className="axis-title" x={m.l} y={H - 6}>Daily mean outdoor {driverName(d.model.driver)}, °C</text>
        <text className="axis-title" x={m.l - 44} y={m.t - 6}>MWh(th)/day</text>
        {cps.map((c) => (
          <g key={c} className="cp">
            <line x1={sx(c)} x2={sx(c)} y1={m.t} y2={H - m.b} />
            <text x={sx(c) + 6} y={m.t + 12}>balance point {nf(c, 1)} °C</text>
          </g>
        ))}
        <g>
          {pts.map((p) => (p.w ? <circle key={p.i} cx={p.px} cy={p.py} r={3.2} className="dot-we" /> : <circle key={p.i} cx={p.px} cy={p.py} r={3.2} className="dot-wd" />))}
        </g>
        <path d={lines.we} className="fit fit-we" />
        <path d={lines.wd} className="fit fit-wd" />
        {hover && <circle cx={hover.px} cy={hover.py} r={6} className="dot-hover" />}
      </svg>
      {hover && (
        <Tip x={hover.px} y={hover.py} width={W}>
          <b>{shortDate(d.dates[hover.i])} 2016</b> · {hover.w ? 'weekend/holiday' : 'weekday'}
          <br />
          {driverName(d.model.driver)} {nf(hover.x, 1)} °C
          <br />
          load {nf(hover.y, 1)} MWh(th) · baseline {nf((d.pred[hover.i] ?? 0) / 1000, 1)}
        </Tip>
      )}
      <ul className="legend" aria-label="Legend">
        <li><i className="sw sw-dot" />weekday</li>
        <li><i className="sw sw-ring" />weekend or holiday</li>
        <li><i className="sw sw-line" />change-point baseline (weekday)</li>
        <li><i className="sw sw-line-light" />baseline, weekend offset</li>
      </ul>
    </div>
  )
}

export function StepWeather({ summary, detail, picker }: { summary: Summary; detail: Detail | null; picker: ReactNode }) {
  const forms = summary.forms
  const n = summary.funnel.meters_modelled
  const d = detail
  return (
    <Step
      id="weather"
      n={1}
      title="A cooling plant's load follows the weather."
      lede="Each dot is one day of 2016 at one plant. Below its balance point the load sits near a floor; above it, every degree costs a fixed slope."
    >
      <Panel tag="TREND" title={d ? `${d.model.form} change-point fit · ${driverName(d.model.driver)} · 2016` : 'loading'} tools={picker}>
        {d ? <Scatter d={d} /> : <div className="chart-loading" />}
        {d && (
          <p className="readout">
            <span>model <b>{d.model.form}</b> on <b>{driverName(d.model.driver)}</b></span>
            <span>R² <b>{nf(d.model.r2, 2)}</b></span>
            <span>CV(RMSE) 2016 <b>{nf(d.cv16, 1)}%</b></span>
            <span>{driverName(d.alt_driver.driver)} alternative R² {nf(d.alt_driver.r2, 2)}</span>
          </p>
        )}
      </Panel>
      <Details>
        <p>
          For every meter the pipeline fits four ASHRAE Guideline 14 change-point forms (2P, 3PC, 4P, 5P) on daily mean
          dry-bulb and on wet-bulb (Stull 2011, from dew point), each with a weekend/holiday offset, and keeps the one of
          eight with the lowest BIC. Change points are grid-searched; the rest is ordinary least squares. Fit on 2016 only.
        </p>
        <p className="eq">3PC: E = β₀ + β₁ (x − c)⁺ + β_w w &nbsp;&nbsp; 4P: E = β₀ + β₁ (c − x)⁺ + β₂ (x − c)⁺ + β_w w</p>
        <table className="tbl">
          <thead>
            <tr><th>Form chosen</th>{Object.keys(forms).map((k) => <th key={k} className="num">{k}</th>)}</tr>
          </thead>
          <tbody>
            <tr><td>Meters</td>{Object.values(forms).map((v, i) => <td key={i} className="num">{v}</td>)}</tr>
          </tbody>
        </table>
        <p>
          Wet-bulb was picked for {summary.wetbulb_selected} of {n} meters ({pct(summary.wetbulb_selected / n, 0)}), dry-bulb
          for {summary.drybulb_selected}. The median R² gain from wet-bulb is only {nf(summary.median_r2_gain_wetbulb_minus_drybulb, 3)}:
          for these buildings the model form matters far more than the driver.
        </p>
      </Details>
    </Step>
  )
}
