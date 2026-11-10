// Types and loaders for the static JSON written by pipeline/run.py.
// Every number on the page is read from these files; nothing is typed in by hand.

export type ModelStats = { n: number; share_g14: number; median_cv: number; median_abs_nmbe: number }

export type Injection = {
  trials: number
  detection_rate: number
  median_delay_days: number
  p90_delay_days: number
  median_shift_sigma: number
  monthly_detection_rate: number
  monthly_median_delay_days: number
  monthly_false_before_onset: number
}

export type Summary = {
  funnel: {
    meters_in_dataset: number
    meters_80pct_hourly: number
    duplicates_dropped: number
    excluded_low_days: number
    excluded_tiny_load: number
    meters_modelled: number
  }
  clean_stats: { flat_run_hours: number; spike_hours: number }
  models: {
    changepoint_2016_insample: ModelStats
    changepoint_2017: ModelStats
    gbr_2017: ModelStats
    naive_lastyear_2017: ModelStats
  }
  forms: Record<string, number>
  wetbulb_selected: number
  drybulb_selected: number
  median_r2_gain_wetbulb_minus_drybulb: number
  cusum: {
    k: number
    h_prd: number
    h_used: number
    bootstrap_arl0: Record<string, number>
    iid_reference: { iid_arl0_h5: number; iid_arl1_1sigma_h5: number }
    alarms: { h5: { up: number; down: number; none: number }; hcal: { up: number; down: number; none: number } }
  }
  queue: {
    n_up: number
    n_sized: number
    n_unsized: number
    total_excess_ton_h: number
    total_excess_kwh_elec_at_default: number
    plants_for_50pct: number
    plants_for_80pct: number
    by_kind: Record<string, number>
    median_lead_days_vs_monthly: number
  }
  monthly_rule_in_control_2016: { mean_flags_per_meter_year: number; share_meters_with_any_flag: number }
  units_gate: { max_kwh_per_m2_yr: number; plants_units_ok: number; plants_units_suspect: number }
  injection: { note: string; h: number; results: Record<string, Injection> }
  units: { kwh_per_ton_hour: number; default_kw_per_ton: number }
}

export type QueueRow = {
  rank: number
  id: string
  site: string
  use: string
  date: string
  onset: string
  days_to_alarm: number
  excess_ton_h: number | null
  sizable: boolean
  units_ok: boolean
  excess_pct: number
  kind: 'slope' | 'baseload' | 'schedule'
  check: string
  month_flag: string | null
  lead_days_vs_monthly: number | null
  confidence: 'low' | 'medium' | 'high'
  cv16: number
}

export type Alarm = {
  side: 'up' | 'down'
  date: string
  onset: string
  days_to_alarm?: number
  excess_ton_h: number | null
  excess_pct: number
  kind: string
  confidence: string
}

export type Detail = {
  id: string
  model: { form: '2P' | '3PC' | '4P' | '5P'; driver: 'drybulb' | 'wetbulb'; cps: number[]; beta: number[]; r2: number; sigma: number }
  alt_driver: { driver: string; r2: number; form: string }
  cv16: number
  cv17: number
  nmbe17: number
  alarm: Alarm | null
  h: number
  k: number
  dates: string[]
  y: (number | null)[]
  pred: (number | null)[]
  x: (number | null)[]
  w: number[]
  cusum_up: (number | null)[]
  cusum_dn: (number | null)[]
}

const get = <T,>(path: string): Promise<T> =>
  fetch(`${import.meta.env.BASE_URL}${path}`).then((r) => {
    if (!r.ok) throw new Error(`${path}: ${r.status}`)
    return r.json() as Promise<T>
  })

export const loadSummary = () => get<Summary>('data/summary.json')
export const loadQueue = () => get<QueueRow[]>('data/queue.json')

const detailCache = new Map<string, Promise<Detail>>()
export const loadDetail = (id: string) => {
  if (!detailCache.has(id)) detailCache.set(id, get<Detail>(`data/detail/${id}.json`))
  return detailCache.get(id)!
}

// Plants that ship with a full daily trace (the top of the queue plus five in-control plants).
export const IN_CONTROL = ['Moose_education_Ricardo', 'Bull_education_Kristal', 'Bull_lodging_Melissa', 'Bull_education_Roland', 'Bull_office_Myron']
export const DETAIL_RANK_MAX = 30
export const DEFAULT_PLANT = 'Fox_education_Eldon'

// The fitted change-point model, evaluated from the shipped coefficients (matches `pred`).
export function changepoint(m: Detail['model'], x: number, w: number): number {
  const b = m.beta
  const c = m.cps
  const p = (u: number) => Math.max(u, 0)
  switch (m.form) {
    case '2P':
      return b[0] + b[1] * x + b[2] * w
    case '3PC':
      return b[0] + b[1] * p(x - c[0]) + b[2] * w
    case '4P':
      return b[0] + b[1] * p(c[0] - x) + b[2] * p(x - c[0]) + b[3] * w
    case '5P':
      return b[0] + b[1] * p(c[0] - x) + b[2] * p(x - c[1]) + b[3] * w
  }
}

// ---------- formatting ----------
export const nf = (v: number, d = 0) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
export const pct = (v: number, d = 1) => `${nf(v * 100, d)}%`
export const driverName = (d: string) => (d === 'wetbulb' ? 'wet-bulb' : 'dry-bulb')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const shortDate = (iso: string) => {
  const [, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]}`
}
export const monthLabel = (i: number) => MONTHS[i]
export const plantLabel = (id: string) => id.replace(/_/g, ' · ')

// ---------- scales ----------
export const linear = (d0: number, d1: number, r0: number, r1: number) => {
  const s = (v: number) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0)
  s.invert = (px: number) => d0 + ((px - r0) / (r1 - r0 || 1)) * (d1 - d0)
  return s
}

export function niceTicks(lo: number, hi: number, count = 5): number[] {
  const span = hi - lo
  const raw = span / Math.max(count, 1)
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? 10 * mag
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10))
  return out
}

export function pathFrom(points: ([number, number] | null)[]): string {
  let d = ''
  let pen = false
  for (const p of points) {
    if (!p) {
      pen = false
      continue
    }
    d += `${pen ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`
    pen = true
  }
  return d
}
