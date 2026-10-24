/**
 * JSON on stdout: one document per line.
 *
 * The output is compact by default, which is what every script that prints JSON does today except
 * `reset-survey-status`, which indents by 2. Pass `indent` to keep that shape.
 */

import process from 'node:process'

/** Where a line is written. `process.stdout` and a test recorder both fit. */
export interface TextSink {
  readonly write: (chunk: string) => unknown
}

export interface JsonFormatOptions {
  /** Spaces per level, as `JSON.stringify` takes them. Omitted means compact. */
  readonly indent?: number
}

export interface WriteJsonOptions extends JsonFormatOptions {
  /** Defaults to `process.stdout`. */
  readonly sink?: TextSink
}

/**
 * `value` as JSON followed by a newline. Throws a `TypeError` for a value `JSON.stringify` cannot
 * represent (`undefined`, a function, a symbol): printing the text `undefined` would hand a JSON
 * consumer such as `jq` a broken document.
 */
export function formatJsonLine(value: unknown, options: JsonFormatOptions = {}): string {
  const text: string | undefined = JSON.stringify(value, null, options.indent)
  if (text === undefined) throw new TypeError('value cannot be represented as JSON')
  return `${text}\n`
}

/** Writes `formatJsonLine(value, options)` to the sink in one call. */
export function writeJsonLine(value: unknown, options: WriteJsonOptions = {}): void {
  const sink = options.sink ?? process.stdout
  sink.write(formatJsonLine(value, options))
}
