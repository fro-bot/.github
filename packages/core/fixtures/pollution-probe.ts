import process from 'node:process'
import {defineCommand, runCli, z} from '../src/cli.ts'

/**
 * Runs the runner on hostile argv in its own process and reports whether any built-in changed. A
 * regression that lets argv reach a prototype poisons only this process, never the test run.
 *
 * `PROBE_ARGV` is a JSON array. `PROBE_STREAM` picks the usage stream. `PROBE_CONTROL_MUTATE=1` changes a
 * built-in on purpose, so a test can see the probe report it. The output is one JSON line.
 */

// The built-ins are read through `Reflect.get`, which takes no `this`, so they are values here.
const TARGETS: readonly (readonly [string, object])[] = [
  ['Object.prototype', Object.prototype],
  ['Object.prototype.toString', Reflect.get(Object.prototype, 'toString')],
  ['Function.prototype', Function.prototype],
  ['Array.prototype', Array.prototype],
  ['Array.prototype.map', Reflect.get(Array.prototype, 'map') as object],
]

function snapshot(target: object): Map<string, PropertyDescriptor | undefined> {
  return new Map(Reflect.ownKeys(target).map(key => [String(key), Object.getOwnPropertyDescriptor(target, key)]))
}

function sameDescriptor(a: PropertyDescriptor | undefined, b: PropertyDescriptor | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  return (
    Object.is(a.value, b.value) &&
    a.get === b.get &&
    a.set === b.set &&
    a.writable === b.writable &&
    a.enumerable === b.enumerable &&
    a.configurable === b.configurable
  )
}

/** The names of the own properties that were added, removed or redefined. */
function changed(before: Map<string, PropertyDescriptor | undefined>, target: object): string[] {
  const after = snapshot(target)
  return [...new Set([...before.keys(), ...after.keys()])].filter(
    key => !sameDescriptor(before.get(key), after.get(key)),
  )
}

/** What a call gives, or the failure message: a poisoned built-in is a report, not a crash. */
function attempt<T>(call: () => T): T | string {
  try {
    return call()
  } catch (error: unknown) {
    return `throws: ${error instanceof Error ? error.message : String(error)}`
  }
}

const before = TARGETS.map(([, target]) => snapshot(target))
const argv = JSON.parse(process.env.PROBE_ARGV ?? '[]') as string[]
if (process.env.PROBE_CONTROL_MUTATE === '1') Reflect.set(TARGETS[1]?.[1] ?? {}, 'call', 'poisoned')
let ran = false

const outcome = await runCli(
  {
    name: 'probe',
    usageCode: 64,
    usageStream: process.env.PROBE_STREAM === 'stdout' ? 'stdout' : 'stderr',
    commands: [
      defineCommand({
        readOnly: false,
        options: {flag: {flag: '--flag', schema: z.boolean().optional()}},
        action: () => {
          ran = true
        },
      }),
    ],
  },
  {argv},
).catch((error: unknown) => ({thrown: error instanceof Error ? error.message : String(error)}))

process.stdout.write(
  JSON.stringify({
    outcome,
    ran,
    changed: TARGETS.flatMap(([label, target], index) =>
      changed(before[index] ?? new Map<string, PropertyDescriptor | undefined>(), target).map(key => `${label}.${key}`),
    ),
    toString: attempt(() => Object.prototype.toString.call({})),
    map: attempt(() => [1].map(value => value)),
  }),
)
