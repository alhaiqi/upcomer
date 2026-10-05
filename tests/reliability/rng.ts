// A small seeded generator (mulberry32), so a run can be repeated with RELIABILITY_SEED.
export type Rng = ReturnType<typeof createRng>;

export function createRng(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => {
    if (!items.length) throw new Error("pick from an empty list");
    return items[int(0, items.length - 1)];
  };
  const chance = (probability: number) => next() < probability;
  const subset = <T>(items: readonly T[]) => items.filter(() => chance(0.5));
  const letters = (length: number, alphabet = "abcdefghijklmnopqrstuvwxyz") =>
    Array.from({ length }, () => alphabet[int(0, alphabet.length - 1)]).join("");
  // Randomly upper- or lower-cases each letter.
  const mixCase = (text: string) => [...text].map(char => (chance(0.5) ? char.toUpperCase() : char.toLowerCase())).join("");
  return { next, int, pick, chance, subset, letters, mixCase };
}
