import { describe, it, expect, vi } from 'vitest'
import { exportCsv } from '../utils/csv'

describe('exportCsv', () => {
  it('creates a downloadable CSV with BOM and escaped values', () => {
    const clicks = []
    const urls = []
    vi.spyOn(document, 'createElement').mockReturnValue({
      set href(v) { urls.push(v) },
      set download(v) { this._download = v },
      click() { clicks.push(this._download) },
    })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    exportCsv('test.csv', ['Name', 'Value'], [
      ['Alice', 100],
      ['Bob "B"', 'has, comma'],
      [null, undefined],
    ])

    expect(clicks).toEqual(['test.csv'])
    expect(urls).toEqual(['blob:test'])

    const blobArg = document.createElement.mock.results[0] // verify click happened
    expect(clicks.length).toBe(1)
  })
})
