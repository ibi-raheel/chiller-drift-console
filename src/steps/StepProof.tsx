import type { Summary } from '../data'
import { linear, nf, pathFrom, pct } from '../data'
import { Check, Details, Panel, Step, Warn, useWidth } from '../ui'

function DetectChart({ summary }: { summary: Summary }) {
  const [ref, W] = useWidth<HTMLDivElement>()
  const R = summary.injection.results
  const sizes = Object.keys(R).map(Number).sort((a, b) => a - b)
  const narrow = W < 560
  const H = narrow ? 250 : 290
  const m = { l: 44, r: narrow ? 92 : 200, t: 18, b: 42 }
  const sx = linear(0, sizes.length - 1, m.l + 30, W - m.r)
  const sy = linear(0, 1, H - m.b, m.t)
  const cus = sizes.map((s, i) => [sx(i), sy(R[s].detection_rate)] as [number, number])
  const mon = sizes.map((s, i) => [sx(i), sy(R[s].monthly_detection_rate)] as [number, number])
  const fal = sizes.map((s, i) => [sx(i), sy(R[s].monthly_false_before_onset)] as [number, number])
  const last = sizes[sizes.length - 1]
  return (
    <div className="chart" ref={ref}>
      <svg width={W} height={H} role="img" aria-label="Detection rate on labelled synthetic step faults, CUSUM against a monthly 10 percent review, with the monthly rule's false flags before onset.">
        <g className="grid">
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <g key={t}>
              <line x1={m.l} x2={W - 8} y1={sy(t)} y2={sy(t)} />
              <text x={m.l - 8} y={sy(t) + 4} textAnchor="end">{t * 100}%</text>
            </g>
          ))}
          {sizes.map((s, i) => (
            <text key={s} x={sx(i)} y={H - m.b + 18} textAnchor="middle">+{s}% step</text>
          ))}
        </g>
        <text className="axis-title" x={m.l} y={H - 4}>{narrow ? `${R[last].trials} trials per step size` : `synthetic step added to real 2017 data, ${R[last].trials} trials per size`}</text>
        <path d={pathFrom(fal)} className="ln-false" />
        <path d={pathFrom(mon)} className="ln-mon" />
        <path d={pathFrom(cus)} className="ln-cus" />
        {fal.map(([x, y], i) => <rect key={`f${i}`} x={x - 4} y={y - 4} width={8} height={8} className="mk-false" />)}
        {mon.map(([x, y], i) => <circle key={`m${i}`} cx={x} cy={y} r={4.5} className="mk-mon" />)}
        {cus.map(([x, y], i) => <circle key={`c${i}`} cx={x} cy={y} r={4.5} className="mk-cus" />)}
        <text x={cus[2][0] + 10} y={cus[2][1] + 4} className="end-label">CUSUM {pct(R[last].detection_rate)}</text>
        <text x={mon[2][0] + 10} y={mon[2][1] + 4} className="end-label">monthly {pct(R[last].monthly_detection_rate)}</text>
        <text x={fal[2][0] + 10} y={fal[2][1] + 4} className="end-label end-label-muted">{narrow ? 'false' : 'monthly false flags'} {pct(R[last].monthly_false_before_onset)}</text>
      </svg>
      <ul className="legend" aria-label="Legend">
        <li><i className="sw sw-cus" />calibrated CUSUM, h = {summary.injection.h}</li>
        <li><i className="sw sw-mon" />monthly review, flag a month &gt; 10% over</li>
        <li><i className="sw sw-false" />monthly rule flags before the fault exists</li>
      </ul>
    </div>
  )
}

export function StepProof({ summary }: { summary: Summary }) {
  const R = summary.injection.results
  const s20 = R['20']
  const mr = summary.monthly_rule_in_control_2016
  const iid = summary.cusum.iid_reference
  return (
    <Step
      id="proof"
      n={6}
      title="How we know it works, and where it doesn't."
      lede={`On a +20% step the CUSUM is no faster than a monthly review (median ${nf(s20.median_delay_days, 1)} vs ${nf(s20.monthly_median_delay_days)} days), but it catches ${pct(s20.detection_rate)} against ${pct(s20.monthly_detection_rate)}. On a +5% step neither is reliable.`}
    >
      <Panel tag="TEST" title="labelled synthetic step faults · detection within 2017">
        <DetectChart summary={summary} />
      </Panel>
      <Details label="Show the detector table">
        <table className="tbl">
          <thead>
            <tr><th>Step</th><th className="num">CUSUM caught</th><th className="num">median delay (p90)</th><th className="num">Monthly caught</th><th className="num">median delay</th><th className="num">Monthly false flag</th></tr>
          </thead>
          <tbody>
            {Object.entries(R).map(([k, r]) => (
              <tr key={k}>
                <td>+{k}% (≈ {nf(r.median_shift_sigma, 2)}σ)</td>
                <td className="num">{pct(r.detection_rate)}</td>
                <td className="num">{nf(r.median_delay_days, 1)} d ({nf(r.p90_delay_days)})</td>
                <td className="num">{pct(r.monthly_detection_rate)}</td>
                <td className="num">{nf(r.monthly_median_delay_days, 1)} d</td>
                <td className="num">{pct(r.monthly_false_before_onset)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          These faults are synthetic and labelled: a step of 5, 10 or 20% of the mean predicted load added to the real 2017 data of
          clean plants from a random onset day. On in-control 2016 data the monthly rule raises {nf(mr.mean_flags_per_meter_year, 2)} flags
          per plant-year and fires at least once on {pct(mr.share_meters_with_any_flag, 0)} of plants. Small 5% steps are below what either
          method finds reliably in a season of noisy daily data.
        </p>
      </Details>
      <Details label="Show the validation checks">
        <ul className="checks">
          <li><Check />Change-point fit equals the closed-form OLS normal equations at the fitted change point, within 1e-6.</li>
          <li><Check />A synthetic 3PC load (c = 18 °C, slope 80) is recovered within 1 °C and 4.</li>
          <li><Check />Stull wet-bulb at 20 °C, 50% RH gives 13.70 °C (psychrometric chart: 13.7 °C).</li>
          <li><Check />CUSUM run lengths match Montgomery's table: ARL₀ {nf(iid.iid_arl0_h5, 1)}, ARL(1σ) {nf(iid.iid_arl1_1sigma_h5, 2)} (published 465 and 10.4).</li>
          <li><Check />The sieve bootstrap recovers the textbook ARL₀ on independent noise and shortens it sharply on autocorrelated noise.</li>
          <li><Check />Cleaning removes an injected spike and a 28-hour stuck run; {nf(summary.clean_stats.spike_hours)} spike hours and {nf(summary.clean_stats.flat_run_hours)} stuck hours removed from the real data.</li>
        </ul>
      </Details>
      <Details label="Show the limits">
        <ul className="checks checks-warn">
          <li><Warn />Campus and commercial buildings. Loads that track an internal process more than weather would need that process as a regressor.</li>
          <li><Warn />Daily resolution. Hourly models would detect sooner, at the cost of modelling the daily profile.</li>
          <li><Warn />The CUSUM cannot tell a fault from a legitimate change such as new occupants or a term break, which is why every alarm becomes a ranked check list rather than an automatic work order.</li>
          <li><Warn />The pattern label points a technician to the first checks; it does not diagnose a component.</li>
          <li><Warn />{summary.units_gate.plants_units_suspect} meters fail the intensity gate, most at one site whose units look wrong; their alarms are kept but not sized.</li>
        </ul>
      </Details>
    </Step>
  )
}
