import { useMemo, useState } from 'react'
import type { Summary } from '../data'
import { linear, nf, niceTicks, pathFrom, pct } from '../data'
import { Details, Panel, Step, useWidth } from '../ui'

function ArlChart({ summary, h }: { summary: Summary; h: number }) {
  const [ref, W] = useWidth<HTMLDivElement>()
  const c = summary.cusum
  const pts = Object.entries(c.bootstrap_arl0).map(([k, v]) => [+k, v] as const).sort((a, b) => a[0] - b[0])
  const H = W < 560 ? 240 : 300
  const m = { l: 46, r: 16, t: 22, b: 40 }
  const yMax = 540
  const sx = linear(4, 21, m.l, W - m.r)
  const sy = linear(0, yMax, H - m.b, m.t)
  const cur = pts.find((p) => p[0] === h)!
  const iid = c.iid_reference.iid_arl0_h5
  return (
    <div className="chart" ref={ref}>
      <svg width={W} height={H} role="img" aria-label="In-control average run length against the CUSUM threshold h, measured by sieve bootstrap on real residuals.">
        <g className="grid">
          {niceTicks(0, yMax, 5).map((t) => (
            <g key={t}>
              <line x1={m.l} x2={W - m.r} y1={sy(t)} y2={sy(t)} />
              <text x={m.l - 8} y={sy(t) + 4} textAnchor="end">{t}</text>
            </g>
          ))}
          {pts.map(([k]) => (W >= 560 || [5, 10, 16, 20].includes(k) ? <text key={k} x={sx(k)} y={H - m.b + 18} textAnchor="middle">{k}</text> : null))}
        </g>
        <text className="axis-title" x={m.l} y={H - 4}>threshold h</text>
        <text className="axis-title" x={m.l - 40} y={m.t - 10}>days between false alarms (ARL₀)</text>
        <g className="hline hline-ok">
          <line x1={m.l} x2={W - m.r} y1={sy(365)} y2={sy(365)} />
          <text x={m.l + 6} y={sy(365) - 7}>{W < 560 ? '1 false alarm / yr' : '365 days: one false alarm per plant-year'}</text>
        </g>
        <g className="iid">
          <circle cx={sx(5)} cy={sy(iid)} r={4.5} />
          <text x={sx(5) + 10} y={sy(iid) + 4}>{W < 560 ? 'textbook, iid' : 'textbook, independent days'}: {nf(iid)}</text>
        </g>
        <path d={pathFrom(pts.map(([k, v]) => [sx(k), sy(v)]))} className="ln-arl" />
        {pts.map(([k, v]) => (
          <circle key={k} cx={sx(k)} cy={sy(v)} r={k === h ? 6.5 : 4} className={k === h ? 'arl-dot arl-cur' : 'arl-dot'} />
        ))}
        <line x1={sx(h)} x2={sx(h)} y1={sy(cur[1]) + 8} y2={H - m.b} className="arl-drop" />
      </svg>
    </div>
  )
}

function FleetBar({ label, counts, n }: { label: string; counts: { up: number; down: number; none: number }; n: number }) {
  const segs = [
    { k: 'up', v: counts.up, cls: 'seg-up', name: 'drift up' },
    { k: 'down', v: counts.down, cls: 'seg-dn', name: 'drift down' },
    { k: 'none', v: counts.none, cls: 'seg-none', name: 'in control' },
  ]
  return (
    <div className="fleetbar">
      <p className="fleetbar-label">
        {label}: <b>{n - counts.none}</b> of {n} plants alarm ({pct((n - counts.none) / n, 0)})
      </p>
      <div className="fleetbar-track" role="img" aria-label={segs.map((s) => `${s.name} ${s.v}`).join(', ')}>
        {segs.map((s) => (
          <span key={s.k} className={s.cls} style={{ flexGrow: s.v }} title={`${s.name}: ${s.v}`} />
        ))}
      </div>
      <p className="fleetbar-keys">
        {segs.map((s) => (
          <span key={s.k}><i className={`sw ${s.cls}`} />{s.name} {s.v}</span>
        ))}
      </p>
    </div>
  )
}

export function StepThreshold({ summary }: { summary: Summary }) {
  const c = summary.cusum
  const hs = useMemo(() => Object.keys(c.bootstrap_arl0).map(Number).sort((a, b) => a - b), [c])
  const [hi, setHi] = useState(hs.indexOf(c.h_prd))
  const h = hs[hi]
  const arl = c.bootstrap_arl0[String(h.toFixed(1))] ?? c.bootstrap_arl0[String(h)]
  const n = summary.funnel.meters_modelled
  const perYear = 365 / arl
  const inj = summary.injection.results['20']
  const isCal = h === c.h_used
  return (
    <Step
      id="threshold"
      n={4}
      title="The textbook alarm would fire on 98% of plants."
      lede={`Daily residuals carry over from one day to the next, so the textbook h = ${c.h_prd} trips every ${nf(c.bootstrap_arl0['5.0'] ?? arl)} days. A bootstrap on each plant's real residuals sets h = ${c.h_used}: about one false alarm a year.`}
    >
      <Panel tag="TUNE" title={`CUSUM threshold · AR(1) sieve bootstrap on 2016 residuals of ${nf(summary.models.changepoint_2016_insample.share_g14 * n)} plants`}>
        <div className="tune">
          <div className="tune-ctl">
            <label htmlFor="h-slider">
              Threshold <b>h = {h}</b>
              {h === c.h_prd && <span className="tag-note">textbook</span>}
              {isCal && <span className="tag-note tag-cal">calibrated</span>}
            </label>
            <input id="h-slider" type="range" min={0} max={hs.length - 1} step={1} value={hi} onChange={(e) => setHi(+e.target.value)} aria-valuetext={`h = ${h}`} />
            <dl className="tune-dl">
              <div><dt>days between false alarms</dt><dd>{nf(arl)}</dd></div>
              <div><dt>false alarms per plant-year</dt><dd>≈ {nf(perYear, 1)}</dd></div>
              <div><dt>false work orders a year, {n} plants</dt><dd className={perYear > 1.05 ? 'bad' : 'good'}>≈ {nf(n * perYear)}</dd></div>
              <div>
                <dt>catches on +20% steps</dt>
                <dd>{isCal ? `${pct(inj.detection_rate)} · median ${nf(inj.median_delay_days, 1)} d` : <span className="muted">measured at h = {c.h_used}</span>}</dd>
              </div>
            </dl>
          </div>
          <ArlChart summary={summary} h={h} />
        </div>
        <div className="fleet">
          <FleetBar label={`Textbook h = ${c.h_prd}`} counts={c.alarms.h5} n={n} />
          <FleetBar label={`Calibrated h = ${c.h_used}`} counts={c.alarms.hcal} n={n} />
        </div>
        <p className="panel-note">
          Both bars are the real 2017 run. At h = {c.h_used} most remaining alarms point down (less cooling than the baseline
          expects); only the {c.alarms.hcal.up} upward drifts become work orders.
        </p>
      </Panel>
      <Details>
        <p>
          For each plant with a Guideline 14 baseline: fit zₜ = φ zₜ₋₁ + uₜ to the 2016 residuals, simulate 20 new 730-day series
          from φ with innovations resampled from the real uₜ, run the CUSUM and average the run length. h is the smallest grid value
          with ARL₀ ≥ 365 days.
        </p>
        <table className="tbl">
          <thead><tr><th>h</th>{hs.map((v) => <th key={v} className="num">{v}</th>)}</tr></thead>
          <tbody><tr><td>ARL₀ (days)</td>{hs.map((v) => <td key={v} className={`num ${v === c.h_used ? 'hl' : ''}`}>{nf(c.bootstrap_arl0[v.toFixed(1)])}</td>)}</tr></tbody>
        </table>
        <p>
          Check: on independent noise the same code gives ARL₀ = {nf(c.iid_reference.iid_arl0_h5, 1)} and ARL(1σ) = {nf(c.iid_reference.iid_arl1_1sigma_h5, 2)} at h = 5,
          matching Montgomery's published table (465 and 10.4). A moving-block bootstrap was tried first and rejected: it inflated the
          ARL₀ of pure noise from 465 to 855 days.
        </p>
      </Details>
    </Step>
  )
}
