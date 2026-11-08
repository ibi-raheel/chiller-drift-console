import type { QueueRow, Summary } from '../data'
import { nf } from '../data'
import { Panel, Step } from '../ui'

export function StepSolution({ summary, queue }: { summary: Summary; queue: QueueRow[] }) {
  const n = summary.funnel.meters_modelled
  const c = summary.cusum
  const q = summary.queue
  const arl = (h: number) => c.bootstrap_arl0[h.toFixed(1)]
  const top = queue.filter((r) => r.excess_ton_h != null).sort((a, b) => a.rank - b.rank).slice(0, 3)
  const lines = [
    { text: 'Baseline each plant on its own weather (8 change-point models, picked by BIC).', fig: `${nf(n)} baselines` },
    { text: 'Put a cost only on plants whose baseline meets Guideline 14.', fig: `${nf(q.n_sized)} of ${nf(q.n_up)} alarms sized` },
    {
      text: `Set the alarm limit on the plant's own residuals (h = ${nf(c.h_used)} here, about one false alarm a year).`,
      fig: `ARL₀ ${nf(arl(c.h_used))} d, not ${nf(arl(c.h_prd))} d`,
    },
    { text: 'On an alarm: onset, ton-hours, pattern, first checks.', fig: 'baseload · slope · schedule' },
    { text: 'Label each one (real, investigate / re-baseline / check meter) and rank by ton-hours.', fig: `${nf(q.plants_for_50pct)} plants = 50%` },
  ]
  return (
    <Step
      id="solution"
      n={7}
      title="The playbook, and a one-command check."
      lede="Feed it a year of meter and weather data. It returns each plant's baseline, an alarm calibrated on that plant's own noise, and a ranked work-order list."
    >
      <div className="solution">
        <Panel tag="PLAYBOOK" title="cooling-plant drift · baseline, alarm, work order">
          <ol className="playbook">
            {lines.map((l, i) => (
              <li key={i}>
                <span className="pb-n" aria-hidden="true">{i + 1}</span>
                <span className="pb-t">{l.text}</span>
                <span className="pb-f">{l.fig}</span>
              </li>
            ))}
          </ol>
        </Panel>
        <Panel tag="CLI" title="tools/drift_check.py · same pipeline, your meters">
          <pre className="cli">
            <code>
              <span className="cli-p">$ </span>python -I tools/drift_check.py --meters … --weather … --out queue.csv{'\n'}
              <span className="cli-o">
                {nf(n)} plants, h = {nf(c.h_used)}, {nf(q.n_up)} drift up, {nf(q.plants_for_50pct)} plants = 50 % of{' '}
                {nf(q.total_excess_ton_h)} ton-h
              </span>
            </code>
          </pre>
          <table className="tbl cli-tbl">
            <thead>
              <tr><th className="num">#</th><th>Plant</th><th>Onset</th><th className="num">Excess ton-h</th><th>Pattern</th><th>Label</th></tr>
            </thead>
            <tbody>
              {top.map((r) => (
                <tr key={r.id}>
                  <td className="num">{r.rank}</td>
                  <td>{r.id}</td>
                  <td>{r.onset}</td>
                  <td className="num">{nf(r.excess_ton_h ?? 0)}</td>
                  <td>{r.kind}</td>
                  <td className="hl">real, investigate</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="panel-note">
            Built on public building meters (BDG2, CC BY-SA 4.0). On a real plant, week one is one campus's history. More at{' '}
            <a href="https://ibiraheel.com">ibiraheel.com</a>.
          </p>
        </Panel>
      </div>
    </Step>
  )
}
