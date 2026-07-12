import { describe, it, expect } from 'vitest'
import { TXN_CODES } from '../utils/txnCodes'

describe('TXN_CODES', () => {
  it('has no duplicate codes', () => {
    const codes = TXN_CODES.map(t => t.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('has no duplicate paths', () => {
    const paths = TXN_CODES.map(t => t.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('every entry has code, path, label, and module', () => {
    for (const t of TXN_CODES) {
      expect(t.code).toBeTruthy()
      expect(t.path).toBeTruthy()
      expect(t.label).toBeTruthy()
      expect(t.module).toBeTruthy()
    }
  })
})
