/**
 * Test support: runs `runRouteStderr` in its own process, the way the CLI does, so a test can see what the router
 * leaves on the process stdout and stderr and what it does with stdin. The plan is the JSON in the first argument;
 * the stderr replay goes to the process stderr.
 */

import process from 'node:process'
import {runRouteStderr, type RouteStderrPlan} from '../src/route-stderr.ts'

const plan = JSON.parse(process.argv[2] ?? '{}') as RouteStderrPlan

process.exitCode = await runRouteStderr(plan, {
  env: process.env,
  replay: stderr => process.stderr.write(stderr),
})
