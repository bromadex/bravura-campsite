import { describe, it, expect } from 'vitest'
import { figuresIn, unverifiedFigures } from '../../../supabase/functions/ask-bravura/audit.js'

// Ask Bravura guardrail: answers may only quote figures that came from tools, the screen, files or the question.
describe('Ask Bravura figure check', () => {
  const tools = JSON.stringify({ litres_issued: 9660, top_users: [{ vehicle: 'FL-2026-00032 AGL0806', litres: 1555 }], total: 1234.567, pct: 37.5 })

  it('accepts figures that come from the tools, including rounded and formatted ones', () => {
    expect(unverifiedFigures('We used 9,660 L. The top user drew 1,555 L; total $1,234.57 (37.5%).', tools)).toEqual([])
  })
  it('flags a figure the tools never returned', () => {
    expect(unverifiedFigures('We used 9,660 L, about 12,400 L less than last year.', tools)).toEqual(['12,400'])
  })
  it('ignores record numbers, dates, times, years and small counts', () => {
    expect(unverifiedFigures('PO KAM-PO-2026-0012 (JV-0001, BRA163) on 2026-09-25 at 14:52 in 2026: 3 lines.', tools)).toEqual([])
  })
  it('accepts results of the calculate tool when they are part of the sources', () => {
    const withCalc = tools + JSON.stringify({ expression: '9660 / 30', result: 322 })
    expect(unverifiedFigures('That is 322 L a day on average.', withCalc)).toEqual([])
  })
  it('reads money and percentages as figures', () => {
    expect(figuresIn('Spent $1,200.50 which is 12.5% of budget')).toEqual(['$1,200.50', '12.5%'])
  })
})
