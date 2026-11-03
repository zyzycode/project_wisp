export function resolveSpriteSource(source: string): string {
  if (source === 'system://wisp/default_idle.svg') {
    return SYSTEM_IDLE_FALLBACK_SOURCE;
  }
  if (source.startsWith('/assets/')) {
    return `.${source}`;
  }
  return source;
}

const SYSTEM_IDLE_FALLBACK_SOURCE = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 512 512%22%3E%3Cpath fill=%22%237c3aed%22 d=%22M256 48c105 0 176 82 176 190 0 124-80 206-176 226C160 444 80 362 80 238 80 130 151 48 256 48Z%22/%3E%3Ccircle cx=%22195%22 cy=%22220%22 r=%2218%22 fill=%22%231e1b4b%22/%3E%3Ccircle cx=%22317%22 cy=%22220%22 r=%2218%22 fill=%22%231e1b4b%22/%3E%3Cpath d=%22M205 302c34 25 68 25 102 0%22 fill=%22none%22 stroke=%22%231e1b4b%22 stroke-linecap=%22round%22 stroke-width=%2214%22/%3E%3C/svg%3E';
