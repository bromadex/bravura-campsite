import { describe, it, expect } from 'vitest'
import { friendlyError } from '../utils/friendlyError'

describe('friendlyError', () => {
  it('returns "Unknown error" for falsy input', () => {
    expect(friendlyError(null)).toBe('Unknown error')
    expect(friendlyError(undefined)).toBe('Unknown error')
  })

  it('extracts message from error object', () => {
    expect(friendlyError({ message: 'bad query' })).toBe('bad query')
  })

  it('appends details and hint when present', () => {
    const err = { message: 'fail', details: 'col missing', hint: 'add it' }
    expect(friendlyError(err)).toBe('fail — col missing — add it')
  })

  it('skips details when it duplicates message', () => {
    const err = { message: 'oops', details: 'oops' }
    expect(friendlyError(err)).toBe('oops')
  })

  it('stringifies non-object errors', () => {
    expect(friendlyError('string err')).toBe('string err')
  })
})
