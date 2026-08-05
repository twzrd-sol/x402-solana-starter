import type { Env } from "../src/types.js";

export function fakeEnv(overrides: Partial<Env> = {}): Env {
  return { ...overrides };
}
