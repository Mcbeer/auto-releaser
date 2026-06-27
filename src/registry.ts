// The public seam. v1 registers only built-ins; "going public" later = external
// .register() calls with zero interface change. See EXTENSIBILITY-DESIGN.md §1.
export class Registry<T extends { name: string }> {
  #impls = new Map<string, T>();

  register(impl: T): void {
    this.#impls.set(impl.name, impl);
  }

  get(name: string): T {
    const impl = this.#impls.get(name);
    if (impl === undefined) {
      const known = [...this.#impls.keys()].join(", ") || "(none)";
      throw new Error(`Unknown "${name}". Registered: ${known}`);
    }
    return impl;
  }
}
