import type { Summary } from '../data'
import { nf, pct } from '../data'
import { useWidth } from '../ui'

/** Central plant graphic: towers, condenser loop, three chillers, chilled-water loop, building load. */
function PlantGraphic({ compact }: { compact: boolean }) {
  const chillers = [400, 540, 680]
  // Paths are drawn in the direction water flows, so the moving dashes read as flow.
  const cws = 'M270,156 V372 H360 V150 H780'
  const cwsDrops = chillers.map((x) => `M${x + 30},150 V176`)
  const cwr = chillers.map((x) => `M${x + 80},176 V118`).concat(['M760,118 H300 V24 H95 V40', 'M235,24 V40'])
  const chws = chillers.map((x) => `M${x + 80},266 V300`).concat(['M480,300 H880 V262'])
  const chwr = ['M915,262 V340 H430', ...chillers.map((x) => `M${x + 30},340 V266`)]
  const vb = compact ? '350 96 610 290' : '20 8 940 420'

  return (
    <svg className={`plant${compact ? ' compact' : ''}`} viewBox={vb} role="img" aria-label="Central plant diagram: two cooling towers, three chillers, chilled-water pumps and a building load, with a BTU meter on the chilled-water supply.">
      {/* condenser water */}
      <g className="pipe cw">
        <path d={cws} />
        {cwsDrops.map((d) => <path key={d} d={d} />)}
      </g>
      <g className="pipe cwr">{cwr.map((d) => <path key={d} d={d} />)}</g>
      {/* chilled water: return first; the supply header is cased so it crosses on top */}
      <g className="pipe chwr">{chwr.map((d) => <path key={d} d={d} />)}</g>
      <path d="M480,300 H880" className="casing" />
      <g className="pipe chws">{chws.map((d) => <path key={d} d={d} />)}</g>
      {/* moving flow ticks */}
      <g className="flow" aria-hidden="true">
        {[cws, ...cwsDrops, ...cwr, ...chws, ...chwr].map((d, i) => <path key={i} d={d} />)}
      </g>

      {/* cooling towers */}
      {[50, 180].map((x, i) => (
        <g key={x} className="equip">
          <path d={`M${x + 22},40 h66 l-6,24 h-54 z`} />
          <circle cx={x + 55} cy={52} r={7} className="fan" />
          <rect x={x} y={64} width={110} height={76} />
          {[78, 92, 106, 120].map((y) => <path key={y} d={`M${x + 8},${y} h94`} className="louver" />)}
          <text x={x + 55} y={134} textAnchor="middle" className="dg-tag">CT-{i + 1}</text>
        </g>
      ))}
      <rect x={40} y={140} width={260} height={16} className="equip basin" />
      <text x={170} y={176} textAnchor="middle" className="dg-minor">tower basin</text>

      {/* condenser pump */}
      <g className="equip">
        <circle cx={330} cy={372} r={13} />
        <path d="M322,366 l14,6 -14,6z" className="pump-tri" />
        <text x={330} y={400} textAnchor="middle" className="dg-tag">CWP-1</text>
      </g>

      {/* chillers */}
      {chillers.map((x, i) => (
        <g key={x} className="equip chiller">
          <rect x={x} y={176} width={110} height={30} rx={15} />
          <rect x={x} y={236} width={110} height={30} rx={15} />
          <rect x={x + 14} y={206} width={30} height={30} className="comp" />
          <text x={x + 76} y={226} textAnchor="middle" className="dg-tag">CH-{i + 1}</text>
          <text x={x + 55} y={195} textAnchor="middle" className="dg-minor">cond</text>
          <text x={x + 55} y={255} textAnchor="middle" className="dg-minor">evap</text>
        </g>
      ))}

      {/* chilled-water pump on the return */}
      <g className="equip">
        <circle cx={820} cy={340} r={13} />
        <path d="M828,334 l-14,6 14,6z" className="pump-tri" />
        <text x={820} y={compact ? 377 : 368} textAnchor="middle" className="dg-tag">CHWP-1</text>
      </g>

      {/* building load */}
      <g className="equip load">
        <rect x={858} y={150} width={78} height={112} />
        <path d="M870,170 h54 v12 h-54 v12 h54 v12 h-54 v12 h54 v12 h-54" className="coil" />
        <text x={897} y={140} textAnchor="middle" className="dg-tag">AHU coils</text>
      </g>

      {/* the meter this study reads */}
      <g className="meter">
        <circle cx={700} cy={300} r={compact ? 19 : 15} />
        <text x={700} y={compact ? 305 : 304} textAnchor="middle">BTU</text>
        {!compact && <path d="M700,315 V396 H660" className="leader" />}
      </g>
      {!compact && (
        <>
          <text x={652} y={392} textAnchor="end" className="dg-call">BTU meter on the supply</text>
          <text x={652} y={410} textAnchor="end" className="dg-call-sub">the one signal read at each of the 474 plants</text>
        </>
      )}

      {/* line legends */}
      <text x={560} y={112} className="dg-line cw-t">CWR</text>
      <text x={790} y={146} className="dg-line cw-t">CWS</text>
      <text x={560} y={290} className="dg-line chw-t" textAnchor="end">CHWS</text>
      <text x={470} y={356} className="dg-line chw-t">CHWR</text>
    </svg>
  )
}

export function Hero({ summary }: { summary: Summary }) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const f = summary.funnel
  const q = summary.queue
  const h5 = summary.cusum.alarms.h5
  const textbookShare = (h5.up + h5.down) / f.meters_modelled
  return (
    <header className="hero" id="top">
      <div className="appbar">
        <span className="appbar-name">Chiller Drift Console</span>
        <span className="appbar-info">CHW plant fleet · {nf(f.meters_modelled)} real meters · 2016–2017</span>
      </div>
      <div className="hero-copy">
        <h1>Which cooling plant stopped behaving like itself?</h1>
        <div className="hero-sub">
          <p className="hero-answer">
            Judged against its own weather baseline, <b>{nf(summary.cusum.alarms.hcal.up)} of {nf(f.meters_modelled)}</b> plants
            drifted up in a year, and <b>{nf(q.plants_for_50pct)}</b> of them carry half the sized excess
            ({nf(q.total_excess_ton_h / 1e6, 1)} million ton-hours).
          </p>
          <p>
            Here's the playbook: a baseline per plant, an alarm limit set on that plant's own noise (about one false alarm a year,
            instead of {pct(textbookShare, 0)} of plants with the textbook limit), and a ranked work order with what to check first.
          </p>
        </div>
      </div>
      <div className="hero-graphic" ref={ref}>
        <PlantGraphic compact={w < 620} />
        <p className="plant-key">
          <i aria-hidden="true" />
          <span>
            <b>BTU meter on the supply</b>, the one signal read at each of the {nf(f.meters_modelled)} plants
          </span>
        </p>
      </div>
      <p className="hero-cue">
        <a href="#solution">See the playbook ↓</a>
        <span>Or read the six steps top to bottom.</span>
      </p>
    </header>
  )
}
