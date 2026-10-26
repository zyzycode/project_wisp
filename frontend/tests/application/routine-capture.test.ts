import { expect, it, vi } from 'vitest';
import { RoutineCapture } from '../../src/application/services/routine-capture';
import type { IRoutineObservationRepository, RoutineSample } from '../../src/application/ports/routine-observation.port';
import type { MemoryResult } from '../../src/application/ports/memory-repository.interface';
const base = Date.parse('2026-10-26T10:00:00.000Z');
const settle = async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); };
function fixture() {
  let generation = 0, epoch = 'epoch', cohort = 'cohort';
  const repository: IRoutineObservationRepository = {
    begin: vi.fn(async () => ({ ok: true as const, value: { datasetEpoch: epoch, cohortId: cohort } })),
    append: vi.fn(async () => ({ ok: true as const, value: undefined })),
    readStatus: vi.fn(async () => ({ ok: true as const, value: { datasetEpoch: epoch, cohortId: cohort, latestEndUtcMs: null, zoneId: null, offsetMinutes: null } })),
  };
  const capture = new RoutineCapture({ repository, context: () => ({ generation }), storageMode: () => 'persistent', createId: () => 'candidate', appRunId: 'run' });
  let sequence = 0;
  const sample = (nowMs: number, overrides: Partial<RoutineSample> = {}) => capture.sample({ nowMs, utcMs: base + nowMs, zoneId: 'UTC', localDate: '2026-10-26', offsetMinutes: 0, continuity: 0, sequence: ++sequence, presence: 'active', positiveAvailable: true, ...overrides }, 'available');
  return { capture, repository, sample, mutate: () => { generation++; capture.invalidate(); }, reset: () => { generation++; epoch = 'next'; cohort = 'next-cohort'; capture.resetCommitted(); } };
}
it('starts only after metadata acknowledgement, then flushes a semantic five-minute record', async () => {
  const f = fixture(); f.sample(0); await settle();
  f.sample(1000); f.sample(2000); f.capture.boundary(); await settle();
  expect(f.repository.append).toHaveBeenCalledWith(expect.objectContaining({ appRunId: 'run', datasetEpoch: 'epoch', cohortId: 'cohort', activeMs: 1000, unknownMs: 0 }), { generation: 0 });
  expect(f.capture.getStatus().lastAcknowledgedAt).toBe(new Date(base + 2000).toISOString());
});
it('keeps at most one pending flush, loses overflowing closed portions as gaps and never retries unknown outcomes', async () => {
  const f = fixture(); let resolve!: (value: MemoryResult<void>) => void;
  vi.mocked(f.repository.append).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  f.sample(0); await settle(); f.sample(1000); f.sample(2000); f.capture.boundary();
  f.sample(3000); f.sample(4000); f.capture.boundary();
  expect(f.repository.append).toHaveBeenCalledTimes(1);
  expect(f.capture.getStatus()).toMatchObject({ storage: 'degraded', lastAcknowledgedAt: null });
  resolve({ ok: false, code: 'unavailable' }); await settle();
  f.sample(5000); f.sample(6000); f.capture.boundary(); await settle();
  expect(f.repository.append).toHaveBeenCalledTimes(1);
});
it('drops old receipts across full reset and starts new epoch with no old sample baseline', async () => {
  const f = fixture(); let resolve!: (value: MemoryResult<void>) => void;
  vi.mocked(f.repository.append).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  f.sample(0); await settle(); f.sample(1000); f.sample(2000); f.capture.boundary();
  f.reset(); resolve({ ok: true as const, value: undefined }); await settle();
  expect(f.capture.getStatus().lastAcknowledgedAt).toBeNull();
  f.sample(3000); await settle(); f.sample(4000); f.sample(5000); f.capture.boundary(); await settle();
  expect(f.repository.append).toHaveBeenLastCalledWith(expect.objectContaining({ datasetEpoch: 'next', cohortId: 'next-cohort', startUtcMs: base + 4000 }), { generation: 1 });
});
it('ordinary memory mutation preserves persisted cohort and uses a fresh generation without relabeling', async () => {
  const f = fixture(); f.sample(0); await settle(); f.sample(1000); f.sample(2000); f.mutate();
  f.sample(3000); await settle(); f.sample(4000); f.sample(5000); f.capture.boundary(); await settle();
  expect(f.repository.append).toHaveBeenCalledOnce();
  expect(f.repository.append).toHaveBeenCalledWith(expect.objectContaining({ datasetEpoch: 'epoch', cohortId: 'cohort', startUtcMs: base + 4000 }), { generation: 1 });
});
it('rotates cohort only on calendar discontinuity, not ordinary source failure', async () => {
  const f = fixture(); f.sample(0); await settle(); f.sample(1000); f.sample(2000, { positiveAvailable: false, presence: 'unknown', continuity: 1 }); f.sample(3000, { continuity: 1 });
  expect(f.repository.begin).toHaveBeenCalledOnce(); expect(f.repository.append).not.toHaveBeenCalled();
  f.sample(4000, { utcMs: base - 1000 }); await settle(); f.sample(5000, { utcMs: base }); await settle();
  expect(f.repository.begin).toHaveBeenLastCalledWith(expect.objectContaining({ forceNewCohort: true }), { generation: 0 });
});
it('does not retry failed metadata or claim unsupported source as available', async () => {
  const f = fixture(); vi.mocked(f.repository.begin).mockResolvedValueOnce({ ok: false, code: 'unavailable' });
  f.sample(0); await settle(); for (let n = 1; n <= 50; n++) f.sample(n * 1000);
  expect(f.repository.begin).toHaveBeenCalledOnce(); expect(f.repository.append).not.toHaveBeenCalled();
  f.capture.sample({ nowMs: 60000, utcMs: base + 60000, zoneId: null, offsetMinutes: 0, localDate: '2026-10-26', sequence: 99, continuity: 1, presence: 'unknown', positiveAvailable: false }, 'unsupported');
  expect(f.capture.getStatus()).toMatchObject({ source: 'unsupported', storage: 'degraded', lastAcknowledgedAt: null });
});

it('drops a delayed metadata acknowledgement after reset rather than relabeling it', async () => {
  const f = fixture(); let done!: (value: Awaited<ReturnType<IRoutineObservationRepository['begin']>>) => void;
  vi.mocked(f.repository.begin).mockImplementationOnce(() => new Promise(resolve => { done = resolve; }));
  f.sample(0); f.reset(); done({ ok: true, value: { datasetEpoch: 'old', cohortId: 'old' } }); await settle();
  expect(f.repository.readStatus).not.toHaveBeenCalled();
  f.sample(1000); await settle(); f.sample(2000); f.sample(3000); f.capture.boundary(); await settle();
  expect(f.repository.append).toHaveBeenLastCalledWith(expect.objectContaining({ datasetEpoch: 'next', cohortId: 'next-cohort' }), { generation: 1 });
});
it('an explicit clock excursion during pending metadata cannot restore the previous cohort', async () => {
  const f = fixture(); let done!: (value: Awaited<ReturnType<IRoutineObservationRepository['begin']>>) => void;
  vi.mocked(f.repository.begin).mockImplementationOnce(() => new Promise(resolve => { done = resolve; }));
  f.sample(0); f.capture.clockDiscontinuity(); done({ ok: true, value: { datasetEpoch: 'epoch', cohortId: 'old' } }); await settle();
  f.sample(1000); await settle();
  expect(f.repository.begin).toHaveBeenLastCalledWith(expect.objectContaining({ forceNewCohort: true }), { generation: 0 });
});
