import { useMemo, useState } from 'react'
import type { QueueRow, Summary } from '../data'
import { linear, nf, niceTicks, pathFrom, pct, shortDate } from '../data'
import { Details, Panel, Step, useWidth } from '../ui'

function Concentration({ rows, summary }: { rows: QueueRow[]; summary: Summary }) {
  const [ref, W] = useWidth<HTMLDivElement>()
  const total = summary.queue.total_excess_ton_h
  // The pipeline's total counts positive excess only; a few sized plants net out below baseline after onset.
  const sorted = rows.filter((r) => (r.excess_ton_h ?? 0) > 0).sort((a, b) => (b.excess_ton_h ?? 0) - (a.excess_ton_h ?? 0))
  let acc = 0
  const cum = sorted.map((r) => (acc += r.excess_ton_h ?? 0) / total)
  const H = W < 560 ? 190 : 220
  const m = { l: 44, r: 16, t: 14, b: 38 }
  const n = cum.length
  const sx = linear(0, n, m.l, W - m.r)
  const sy = linear(0, 1, H - m.b, m.t)
  const line = pathFrom([[sx(0), sy(0)], ...cum.map((v, i) => [sx(i + 1), sy(v)] as [number, number])])
  const area = `${line}L${sx(n)},${sy(0)}L${sx(0)},${sy(0)}Z`
  const marks = [
    { k: summary.queue.plants_for_50pct, label: '50%' },
    { k: summary.queue.plants_for_80pct, label: '80%' },
  ]
  return (
    <div className="chart" ref={ref}>
      <svg width={W} height={H} role="img" aria-label={`Cumulative share of sized excess by plant: ${marks[0].k} plants carry half, ${marks[1].k} carry 80 percent.`}>
        <g className="grid">
          {[0, 0.5, 1].map((t) => (
            <g key={t}>
              <line x1={m.l} x2={W - m.r} y1={sy(t)} y2={sy(t)} />
              <text x={m.l - 8} y={sy(t) + 4} textAnchor="end">{t * 100}%</text>
            </g>
          ))}
          {niceTicks(0, n, W < 560 ? 4 : 8).map((t) => (
            <text key={t} x={sx(t)} y={H - m.b + 18} textAnchor="middle">{t}</text>
          ))}
        </g>
        <text className="axis-title" x={m.l} y={H - 4}>{W < 560 ? 'plants, largest excess first' : 'plants with positive sized excess, largest first'}</text>
        <path d={area} className="area-cum" />
        <path d={line} className="ln-cum" />
        {marks.map((mk) => {
          const v = cum[mk.k - 1]
          return (
            <g key={mk.k} className="cum-mark">
              <line x1={sx(mk.k)} x2={sx(mk.k)} y1={sy(v)} y2={sy(0)} />
              <circle cx={sx(mk.k)} cy={sy(v)} r={4.5} />
              <text x={sx(mk.k) + 8} y={sy(v) + 16}>{mk.k} plants · {pct(v, 0)}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

type SortKey = 'ton' | 'date' | 'pct'
const KIND: Record<string, string> = { slope: 'weather slope', baseload: 'baseload', schedule: 'schedule' }

export function StepQueue({ summary, queue }: { summary: Summary; queue: QueueRow[] }) {
  const [sort, setSort] = useState<SortKey>('ton')
  const [all, setAll] = useState(false)
  const [kw, setKw] = useState(summary.units.default_kw_per_ton)
  const sized = useMemo(() => queue.filter((r) => r.sizable && r.excess_ton_h != null), [queue])
  const rows = useMemo(() => {
    const s = [...sized]
    if (sort === 'ton') s.sort((a, b) => b.excess_ton_h! - a.excess_ton_h!)
    if (sort === 'date') s.sort((a, b) => a.date.localeCompare(b.date))
    if (sort === 'pct') s.sort((a, b) => b.excess_pct - a.excess_pct)
    return all ? s : s.slice(0, 10)
  }, [sized, sort, all])
  const q = summary.queue
  const kwOk = Number.isFinite(kw) && kw > 0 && kw < 3

  return (
    <Step
      id="queue"
      n={5}
      title={`${q.plants_for_50pct} plants carry half the excess.`}
      lede={`${q.n_sized} of the ${q.n_up} upward drifts have a baseline good enough to size: ${nf(q.total_excess_ton_h / 1e6, 1)} million ton-hours in all. Each one becomes a work order with what to check first.`}
    >
      <Panel tag="TREND" title={`cumulative share of ${nf(q.total_excess_ton_h / 1e6, 1)} M ton-h sized excess`}>
        <Concentration rows={sized} summary={summary} />
      </Panel>

      <div className="cmms" role="region" aria-label="Work-order queue">
        <div className="cmms-head">
          <div>
            <p className="cmms-title">WORK ORDER QUEUE · CHW DRIFT · 2017</p>
            <p className="cmms-sub">{q.n_sized} sized of {q.n_up} upward alarms · electric at <label className="kw">
              <input type="number" step={0.05} min={0.3} max={1.5} value={kw} onChange={(e) => setKw(parseFloat(e.target.value))} aria-label="Plant efficiency in kW per ton" /> kW/ton
            </label></p>
          </div>
          <div className="sortbar" role="group" aria-label="Sort work orders">
            <span>sort</span>
            {([['ton', 'ton-hours'], ['pct', '% over'], ['date', 'alarm date']] as const).map(([k, l]) => (
              <button key={k} type="button" aria-pressed={sort === k} onClick={() => setSort(k)}>{l}</button>
            ))}
          </div>
        </div>
        <div className="paper">
          <div className="tk tk-hdr" aria-hidden="true">
            <span>WO</span><span>plant</span><span>alarm / onset</span><span className="num">excess ton-h</span><span className="num">MWh(e)</span><span className="num">over</span><span>pattern</span><span>conf.</span>
          </div>
          <ol className="tk-list">
            {rows.map((r) => (
              <li key={r.id} className="tk">
                <span className="tk-wo">WO-{String(r.rank).padStart(3, '0')}</span>
                <span className="tk-plant"><b>{r.id}</b><small>{r.use}</small></span>
                <span className="tk-date">{shortDate(r.date)}<small>onset {shortDate(r.onset)}</small></span>
                <span className="tk-ton num"><b>{nf(r.excess_ton_h!)}</b><small className="tk-m">ton-h</small></span>
                <span className="tk-e num">{kwOk ? nf((r.excess_ton_h! * kw) / 1000) : 'n/a'}<small className="tk-m">MWh(e)</small></span>
                <span className="tk-pct num">+{nf(r.excess_pct, 1)}%</span>
                <span className="tk-kind">{KIND[r.kind]}</span>
                <span className={`tk-conf conf-${r.confidence}`}>{r.confidence}</span>
                <span className="tk-check">{r.check}</span>
              </li>
            ))}
          </ol>
          <div className="paper-foot">
            <button type="button" className="btn btn-quiet" onClick={() => setAll(!all)}>
              {all ? 'Show the top 10' : `Print all ${sized.length} work orders`}
            </button>
            <span>total {nf(q.total_excess_ton_h)} ton-h · {kwOk ? `${nf((q.total_excess_ton_h * kw) / 1e6, 1)} GWh(e)` : 'n/a'}</span>
          </div>
        </div>
      </div>

      <Details>
        <p>
          Excess is the sum of actual minus baseline from the estimated onset to 31 December 2017, in kWh thermal; ton-hours =
          kWh(th) / {summary.units.kwh_per_ton_hour}. It is sized only where the 2016 baseline met Guideline 14 and the meter's
          intensity is physically plausible (≤ {nf(summary.units_gate.max_kwh_per_m2_yr)} kWh/m²·yr). The other {q.n_unsized} upward
          alarms are real but listed without a figure, because a weak baseline cannot support a cost.{' '}
          {sized.filter((r) => r.excess_ton_h! <= 0).length} sized plants net out below baseline between onset and year end; they keep
          their place in the list with a negative figure and do not count toward the total.
        </p>
        <p>
          Pattern comes from regressing post-onset residuals on a constant, the model's own cooling term and the weekend flag. Of all{' '}
          {q.n_up} upward alarms: baseload {q.by_kind.baseload}, weather slope {q.by_kind.slope}, schedule {q.by_kind.schedule}.
          Confidence is high when 2016 CV(RMSE) ≤ 15% and at least 65% of post-alarm days sit above baseline; medium at ≤ 25% and 55%.
        </p>
      </Details>
    </Step>
  )
}
