// Pure-JS consumption forecasting: OLS trend + EWMA level + weekday seasonality
// with a residual-sigma confidence band. No external libraries.

const DAY_MS = 86400000
const iso = d => d.toISOString().slice(0, 10)

/**
 * Build a statistical forecast from a daily consumption series.
 *
 * @param {Array<{date: string, litres: number}>} dailySeries
 *        One entry per calendar day (zeros included for no-issuance days),
 *        sorted ascending by date ('YYYY-MM-DD').
 * @param {number} horizonDays  How many future days to forecast.
 * @returns {{
 *   dailyForecast: Array<{date: string, expected: number, low: number, high: number}>,
 *   avgDaily: number,       // simple mean of the series
 *   trendPerDay: number,    // OLS slope (litres/day per day)
 *   seasonality: number[],  // multiplier per weekday (0=Sun … 6=Sat)
 *   sigma: number,          // std dev of residuals (actual - fitted)
 *   r2: number,             // goodness of fit of the blended model
 * }}
 */
export function buildForecast(dailySeries, horizonDays = 60) {
  const n = dailySeries?.length || 0
  const flat = new Array(7).fill(1)
  const empty = { dailyForecast: [], avgDaily: 0, trendPerDay: 0, seasonality: flat, sigma: 0, r2: 0 }
  if (!n) return empty

  const ys = dailySeries.map(d => Math.max(0, Number(d.litres) || 0))
  const avgDaily = ys.reduce((s, v) => s + v, 0) / n
  const startDate = new Date(dailySeries[0].date + 'T00:00:00Z')
  const lastDate = new Date(dailySeries[n - 1].date + 'T00:00:00Z')

  // Tiny series: fall back to the simple average with no trend/seasonality.
  if (n < 5) {
    const dailyForecast = []
    for (let d = 1; d <= horizonDays; d++) {
      const date = iso(new Date(lastDate.getTime() + d * DAY_MS))
      dailyForecast.push({ date, expected: avgDaily, low: avgDaily, high: avgDaily })
    }
    return { ...empty, dailyForecast, avgDaily }
  }

  // 1. Trend: ordinary least-squares regression (x = day index, y = litres).
  const xMean = (n - 1) / 2
  let sxy = 0, sxx = 0
  for (let i = 0; i < n; i++) {
    sxy += (i - xMean) * (ys[i] - avgDaily)
    sxx += (i - xMean) * (i - xMean)
  }
  const slope = sxx ? sxy / sxx : 0
  const intercept = avgDaily - slope * xMean
  const regression = x => intercept + slope * x

  // 1b. EWMA level (alpha 0.25) — recent-weighted "current" consumption level.
  let ewma = ys[0]
  for (let i = 1; i < n; i++) ewma = 0.25 * ys[i] + 0.75 * ewma

  // 2. Weekday seasonality: mean litres per weekday vs overall mean.
  //    Guard: needs at least 3 full weeks of data, else all multipliers = 1.
  let seasonality = flat
  if (n >= 21 && avgDaily > 0) {
    const sums = new Array(7).fill(0), counts = new Array(7).fill(0)
    for (let i = 0; i < n; i++) {
      const wd = new Date(startDate.getTime() + i * DAY_MS).getUTCDay()
      sums[wd] += ys[i]
      counts[wd]++
    }
    seasonality = sums.map((s, wd) => (counts[wd] ? (s / counts[wd]) / avgDaily : 1))
  }

  // 3+4. Fitted values (same blend as the forecast) → residual sigma and R².
  const fit = i => {
    const wd = new Date(startDate.getTime() + i * DAY_MS).getUTCDay()
    return Math.max(0, (0.5 * regression(i) + 0.5 * ewma) * seasonality[wd])
  }
  let sse = 0, sst = 0
  for (let i = 0; i < n; i++) {
    const r = ys[i] - fit(i)
    sse += r * r
    sst += (ys[i] - avgDaily) * (ys[i] - avgDaily)
  }
  const sigma = Math.sqrt(sse / n)
  const r2 = sst > 0 ? Math.max(0, 1 - sse / sst) : 0

  // Forecast each future day: blend of regression and EWMA, scaled by weekday.
  const dailyForecast = []
  for (let d = 1; d <= horizonDays; d++) {
    const dt = new Date(lastDate.getTime() + d * DAY_MS)
    const wd = dt.getUTCDay()
    const base = (0.5 * regression(n - 1 + d) + 0.5 * ewma) * seasonality[wd]
    const expected = Math.max(0, base)
    dailyForecast.push({
      date: iso(dt),
      expected,
      low: Math.max(0, base - sigma),   // optimistic (less consumption)
      high: Math.max(0, base + sigma),  // pessimistic (more consumption)
    })
  }

  return { dailyForecast, avgDaily, trendPerDay: slope, seasonality, sigma, r2 }
}
