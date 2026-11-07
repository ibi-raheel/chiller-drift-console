// Placeholder page: loads the precomputed pipeline output. The full console UI comes later.
type QueueRow = { rank: number; id: string; site: string; date: string; excess_ton_h: number; kind: string; confidence: string }

async function main() {
  const app = document.getElementById('app')!
  const [summary, queue] = await Promise.all([
    fetch('/data/summary.json').then((r) => r.json()),
    fetch('/data/queue.json').then((r) => r.json() as Promise<QueueRow[]>),
  ])
  const rows = queue.slice(0, 15).map((q) =>
    `<tr><td>${q.rank}</td><td>${q.id}</td><td>${q.date}</td><td>${Math.round(q.excess_ton_h).toLocaleString()}</td><td>${q.kind}</td><td>${q.confidence}</td></tr>`).join('')
  app.innerHTML = `<h1>Chiller Drift Console</h1>
    <p>${summary.funnel.meters_modelled} real chilled-water meters, weather-normalized baselines, CUSUM drift alarms in 2017.</p>
    <table><thead><tr><th>#</th><th>Meter</th><th>Alarm</th><th>Excess ton-h</th><th>Pattern</th><th>Confidence</th></tr></thead><tbody>${rows}</tbody></table>
    <p>Data: Building Data Genome Project 2 (Miller et al. 2020), CC BY-SA 4.0.</p>`
}
main()
