// Disposable smoke utility process only: fixed sampling makes before/after comparable.
let seed = 42;
Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
void import('../../src/infrastructure/voice-output/worker').catch(() => process.exit(1));
export {};
