import { describe, it, test, expect } from '@jest/globals'
import { Err, Ok, isErr, isErrCode, isOk } from '../src/core.js'
import { wrap, unwrap, resultAll } from '../src/utils.js'

async function maybeError (isErr: boolean) {
  return isErr
    ? Err({ code: 'MaybeError' as const })
    : Ok(true)
}

async function maybeManyErrors (err: number) {
  if (err === 0) {
    return Ok(true)
  } else if (err === 1) {
    return Err({ code: '1' })
  } else if (err === 2) {
    return Err({ code: '2' })
  } else {
    return Err({ code: '>=3' })
  }
}

async function resultRecord <T extends Record<string, string>> (isErr: boolean, value: T) {
  return isErr
    ? Err({ code: 'RecordError', value })
    : Ok(value)
}

describe('extra functionality (only promises supported)', () => {
  describe('wrap/unwrap', () => {
    it('can wrap/unwrap errors', async () => {
      const wrappedFunction = wrap<typeof maybeManyErrors | typeof maybeError>()(async (n: number) => {
        const value1 = unwrap(await maybeManyErrors(n))
        expect(value1).toBe(n === 0) // we have direct access to the valid value, because we unwrapped it.
        const value2 = unwrap(await maybeManyErrors(n + 1))
        const value3 = unwrap(await maybeError(true))
        expect(value3).not.toBeDefined()
        if (value1 === false) {
          return Err({ code: 'value1===false' })
        }
        if (value2 === false) {
          return Err({ code: 'value2===false' })
        }
        expect(value2).not.toBeDefined() // this should never execute, because unwrap will stop execution because of the error
        return Ok(true)
      })

      const value = await wrappedFunction(0)
      expect(isErr(value)).toBe(true)
      expect(isOk(value)).toBe(false)

      if (isErrCode(value, ['1'])) {
        expect(value.error).toStrictEqual({ code: '1' })
      }
    })

    test('wrapped functions can have their own errors', async () => {
      const wrappedFunction = wrap<typeof maybeError>()(async () => {
        const value1 = unwrap(await maybeError(false))
        expect(value1).toBe(true)
        if (value1 === true) {
          return Err({ code: 'Error' })
        } else {
          return Ok(true)
        }
      })

      const result = await wrappedFunction()
      expect(isErr(result)).toBe(true)
      expect(isOk(result)).toBe(false)

      if (isErr(result)) {
        expect(result.error).toStrictEqual({ code: 'Error' })
      }
    })

    test('wrapped functions can have their own ok values', async () => {
      const wrappedFunction = wrap<typeof maybeError>()(async () => {
        const value1 = unwrap(await maybeError(false))
        expect(value1).toBe(true)
        if (value1 === false) {
          return Err({ code: 'Error' })
        } else {
          return Ok(true)
        }
      })

      const result = await wrappedFunction()
      expect(isOk(result)).toBe(true)
      expect(isErr(result)).toBe(false)

      if (isOk(result)) {
        expect(result.value).toBe(true)
      }
    })
  })

  describe('resultAll (Promise.all equivalent using Result interface)', () => {
    test('when every result is ok, value is populated with an array with all the values, in the same order', async () => {
      const result = await resultAll([
        resultRecord(false, { a: 'a' }),
        resultRecord(false, { b: 'b' }),
        resultRecord(false, { c: 'c' }),
        resultRecord(false, { d: 'd' }),
      ] as const)
      expect(isErr(result)).toBe(false)
      expect(isOk(result)).toBe(true)
      if (isOk(result)) {
        expect(result.value[0].a).toBe('a')
        expect(result.value[1].b).toBe('b')
        expect(result.value[2].c).toBe('c')
        expect(result.value[3].d).toBe('d')
      }
    })

    test('when some result is erroneous, execution continues with result populated as an error', async () => {
      const result = await resultAll([
        resultRecord(false, { a: 'a' }),
        resultRecord(false, { b: 'b' }),
        resultRecord(true, { c: 'c' }),
        resultRecord(false, { d: 'd' }),
      ] as const)
      expect(isErr(result)).toBe(true)
      expect(isOk(result)).toBe(false)
      if (isErr(result)) {
        expect(result.error.code === 'RecordError').toBe(true)
        expect(result.error.value).toStrictEqual({ c: 'c' })
      }
    })

    test('resultAll can be unwrapped', async () => {
      const result = unwrap(await resultAll([
        resultRecord(false, { a: 'a' }),
        resultRecord(false, { b: 'b' }),
        resultRecord(false, { c: 'c' }),
      ] as const))
      expect(result).toStrictEqual([
        { a: 'a' },
        { b: 'b' },
        { c: 'c' },
      ])
    })
  })
})
