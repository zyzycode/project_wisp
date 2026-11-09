/** Electron execution budget after dev compilation; inputs are validated by the runner. */
export function smokeDeadlineMs({ nativeProbe, nativeRegression, lifeCase, lifeSoakMs }) {
  if (nativeProbe) return 240_000 + (nativeRegression ? 0 : lifeSoakMs - 10_000);
  return lifeCase ? 120_000 : 50_000 + lifeSoakMs;
}
