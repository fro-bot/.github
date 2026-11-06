/**
 * A stand-in for the command `route-stderr` wraps: it writes what the environment says and exits as told.
 * `CASE_STDOUT` goes to stdout, `CASE_OUTPUT` is appended to `$GITHUB_OUTPUT`, `CASE_STDERR` goes to stderr and
 * `CASE_EXIT` is the exit code. It echoes its own arguments as JSON to the file named by `CASE_ARGV_FILE`, so a test
 * can see exactly which argv reached it.
 */

import {appendFileSync, writeFileSync, writeSync} from 'node:fs'
import process from 'node:process'

const {CASE_ARGV_FILE, CASE_EXIT, CASE_OUTPUT, CASE_STDERR, CASE_STDOUT, GITHUB_OUTPUT} = process.env

if (CASE_ARGV_FILE !== undefined && CASE_ARGV_FILE !== '') {
  writeFileSync(CASE_ARGV_FILE, JSON.stringify(process.argv.slice(2)))
}
if (CASE_STDOUT !== undefined && CASE_STDOUT !== '') writeSync(1, CASE_STDOUT)
if (CASE_OUTPUT !== undefined && CASE_OUTPUT !== '' && GITHUB_OUTPUT !== undefined) {
  appendFileSync(GITHUB_OUTPUT, CASE_OUTPUT)
}
if (CASE_STDERR !== undefined && CASE_STDERR !== '') writeSync(2, CASE_STDERR)
process.exitCode = Number(CASE_EXIT ?? '0')
