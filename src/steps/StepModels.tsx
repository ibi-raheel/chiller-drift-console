import type { ModelStats, Summary } from '../data'
import { nf, pct } from '../data'
import { Details, Panel, Step, useWidth } from '../ui'

function Waffle({ n, filled, tone }: { n: number; filled: number; tone: string }) {
  const [ref, W] = useWidth<HTMLDivElement>(260)
  const cols = W < 400 ? 40 : 30
  const rows = Math.ceil(n / cols)
  const gap = 2
  const cell = Math.max(4, Math.floor((Math.min(W, 330) - gap * (cols - 1)) / cols))
  const width = cols * cell + (cols - 1) * gap
  return (
    <div ref={ref} className="waffle">
      <svg width={width} height={rows * cell + (rows - 1) * gap} role="img" aria-label={`${filled} of ${n} meters meet Guideline 14`}>
        {Array.from({ length: n }, (_, i) => (
          <rect key={i} x={(i % cols) * (cell + gap)} y={Math.floor(i / cols) * (cell + gap)} width={cell} height={cell} className={i < filled ? `wf-on ${tone}` : 'wf-off'} />
        ))}
      </svg>
    </div>
  )
}

type Col = { key: string; name: string; kind: string; inputs: string; stats: ModelStats; tone: string }

export function StepModels({ summary }: { summary: Summary }) {
  const M = summary.models
  const cols: Col[] = [
    { key: 'cp', name: 'Change-point regression', kind: 'physics · up to 8 parameters', inputs: 'one weather driver + weekend flag', stats: M.changepoint_2017, tone: 'tone-chw' },
    { key: 'gbr', name: 'Gradient-boosted trees', kind: 'trained ML model · 150 trees', inputs: 'dry-bulb, wet-bulb, dew point, weekday, holiday, day of year', stats: M.gbr_2017, tone: 'tone-cw' },
    { key: 'naive', name: 'Same weekday last year', kind: 'naive · no model', inputs: '2016 value, 364 days earlier', stats: M.naive_lastyear_2017, tone: 'tone-ink' },
  ]
  const n = M.changepoint_2017.n
  const ratio = M.changepoint_2017.share_g14 / M.naive_lastyear_2017.share_g14
  return (
    <Step
      id="baseline"
      n={2}
      title="Physics, machine learning, or last year: which baseline holds up?"
      lede={`All three were scored on 2017, a year none of them saw. The trained trees tie the change-point model; both beat "same day last year" ${nf(ratio, 1)}-fold.`}
    >
      <Panel tag="TEST" title={`held-out 2017 · ${n} meters · ASHRAE Guideline 14 (CV(RMSE) ≤ 25%, |NMBE| ≤ 10%)`}>
        <div className="models">
          {cols.map((c) => (
            <div key={c.key} className={`model model-${c.key}`}>
              <h3>{c.name}</h3>
              <p className="model-kind">{c.kind}</p>
              <p className="model-inputs"><span>inputs</span> {c.inputs}</p>
              <Waffle n={n} filled={Math.round(c.stats.share_g14 * c.stats.n)} tone={c.tone} />
              <p className="model-score">
                <b>{pct(c.stats.share_g14)}</b> meet Guideline 14
              </p>
              <p className="model-sub">median CV(RMSE) {nf(c.stats.median_cv, 1)}% · median |NMBE| {nf(c.stats.median_abs_nmbe, 1)}%</p>
            </div>
          ))}
        </div>
        <p className="panel-note">
          Each square is one meter. The ML model earns its place as a check, not a replacement: it does no better on unseen data,
          so the console keeps the change-point model, whose slope and balance point say what changed.
        </p>
      </Panel>
      <Details>
        <table className="tbl">
          <thead>
            <tr><th>Model</th><th>Scored on</th><th className="num">Meets G14</th><th className="num">Median CV(RMSE)</th><th className="num">Median |NMBE|</th></tr>
          </thead>
          <tbody>
            <tr><td>Change-point (best of 8, BIC)</td><td>2016, in-sample</td><td className="num">{pct(M.changepoint_2016_insample.share_g14)}</td><td className="num">{nf(M.changepoint_2016_insample.median_cv, 1)}%</td><td className="num">{nf(M.changepoint_2016_insample.median_abs_nmbe, 1)}%</td></tr>
            {cols.map((c) => (
              <tr key={c.key}><td>{c.name}</td><td>2017, held out</td><td className="num">{pct(c.stats.share_g14)}</td><td className="num">{nf(c.stats.median_cv, 1)}%</td><td className="num">{nf(c.stats.median_abs_nmbe, 1)}%</td></tr>
            ))}
          </tbody>
        </table>
        <p>
          The 2017 scores mix model error with genuine year-to-year change, which is exactly what the detector looks for, so they
          understate model quality. The comparison between rows is fair because all three see the same 2017. Trees:
          scikit-learn HistGradientBoostingRegressor, 150 iterations, learning rate 0.08, 15 leaves, trained on 2016.
        </p>
      </Details>
    </Step>
  )
}
