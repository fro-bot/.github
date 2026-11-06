/**
 * The `scripts/gateway-announce.ts` entrypoint on the goke runner. It takes no argument and one option: one root
 * command reads the gateway variables and either `--event <name>` (the typed builder for that event reads its own
 * variables) or `EVENT_TYPE` and `EVENT_CONTEXT_JSON` from the environment, POSTs the HMAC-signed event and
 * prints the result as one JSON line. The command is not read-only: it POSTs to an
 * external service.
 *
 * Announcing is best-effort presence, so no outcome fails the step: the usage code, the help code and the
 * code for a thrown error are all 0. The kill switch, a missing `EVENT_TYPE`, malformed context JSON, a context
 * a builder cannot build, `--event` together with `EVENT_TYPE` or `EVENT_CONTEXT_JSON`, and a non-2xx all end in
 * exit 0 with a `gateway-announce:` line on stderr. Argv that matches nothing declared,
 * `--help` included, prints usage and posts nothing.
 */

import {defineCommand, runCliMain, z, type CliConfig} from '@fro-bot/core/cli'
import {EVENT_TYPES, runGatewayAnnounce} from './gateway-announce.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function gatewayAnnounceCli(): CliConfig {
  return {
    name: 'gateway-announce',
    usageCode: 0,
    errorExitCode: 0,
    commands: [
      defineCommand({
        readOnly: false,
        options: {event: {flag: '--event <name>', schema: z.enum(EVENT_TYPES).optional()}},
        action: async context => {
          await runGatewayAnnounce(context.env, context, context.options.event)
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(gatewayAnnounceCli())
}
