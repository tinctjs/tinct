/** @internal Placeholder CPU kernels until Phase 2 lands the implementations. */
export const cpuTodo = (name: string) => (): never => {
  throw new Error(`tinct: the '${name}' CPU kernel is not implemented yet (Phase 2)`)
}
