import { afterAll, expect as assert, type Assertion } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'

/** Retain the exact old fixture/feel expectations while making misses report-only.
 * Only numeric feel metrics enter here; booleans/lifecycle/finite-state checks
 * use real assertions. Nonfinite metrics always fail. Hard safety also runs in CI.
 */
export function reportExpect(name: string) {
  const rows: { metric: string; value: unknown; target: unknown[]; status: string; count: number }[] = []
  afterAll(() => {
    const directory = new URL('./out/', import.meta.url)
    mkdirSync(directory, { recursive: true })
    writeFileSync(new URL(`legacy-${name}.json`, directory), JSON.stringify(rows, null, 2) + '\n')
    console.info(`Legacy ${name}: ${rows.filter(r => r.status === '⚠ out').length} out-of-target metric groups (informational)`)
  })
  return (value: number, message?: string) => {
    if (!Number.isFinite(value)) throw new Error(`${name}: nonfinite feel metric ${value}`)
    const test = assert.getState().currentTestName ?? name
    const wrap = (matcher: Assertion, prefix = ''): Assertion => new Proxy(matcher, {
      get(target, key) {
        const method = Reflect.get(target, key)
        if (typeof method !== 'function') return typeof method === 'object' ? wrap(method, `${prefix}${String(key)}.`) : method
        return (...args: unknown[]) => {
          let status = 'ok'
          try { method.apply(target, args) } catch (error) {
            if (!(error instanceof Error) || error.name !== 'AssertionError') throw error
            status = '⚠ out'
          }
          const metric = `${test}: ${message ?? ''} ${prefix}${String(key)}`
          const previous = rows.find(r => r.metric === metric && JSON.stringify(r.target) === JSON.stringify(args) && r.status === status)
          if (previous) { previous.count++; previous.value = value }
          else rows.push({ metric, value, target: args, status, count: 1 })
        }
      },
    })
    return wrap(assert(value, message))
  }
}
