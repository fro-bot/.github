/** Where a registry CLI body writes: the sinks the goke runner hands its action. */
export interface RegistryIo {
  readonly stdout: (text: string) => void
  readonly stderr: (text: string) => void
}
