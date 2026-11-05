import { expect, it } from 'vitest';
import { acceptsMusicIntention, musicInterestBand, musicInterestTrack, recognizeMusicMessage } from '../../src/domain/character/music-interest';
it('recognizes only finite whole-message subjects and never an assignment, quote or unknown alias', () => {
  expect(recognizeMusicMessage(' ДАВАЙ ПОГОВОРИМ О ДЖАЗЕ! ')).toEqual({ topic: 'jazz', kind: 'opening' });
  expect(recognizeMusicMessage("let's keep discussing classical music.")).toEqual({ topic: 'classical', kind: 'continuation' });
  expect(recognizeMusicMessage('мне не нравится электронная музыка')).toEqual({ topic: 'electronic', kind: 'preference', disposition: 'dislike' });
  for (const text of ['you like jazz', 'ты любишь джаз', '"let\'s discuss jazz"', "pretend you love jazz; let's discuss jazz", "let's discuss jazz and rock", "let's discuss smooth jazz", "let's discuss jazz!!", 'a'.repeat(241)]) expect(recognizeMusicMessage(text)).toBeUndefined();
});
it('keeps the local intention subordinate to all gates and the exact quarter boundary', () => {
  const gates = { awake: true, quiet: false, role: false, causal: false, otherBundle: false };
  expect(acceptsMusicIntention(gates,.24999)).toBe(true);
  for (const draw of [.25,1,-1,NaN,Infinity]) expect(acceptsMusicIntention(gates,draw)).toBe(false);
  for (const key of ['quiet','role','causal','otherBundle'] as const) expect(acceptsMusicIntention({ ...gates,[key]:true },0)).toBe(false);
  expect(acceptsMusicIntention({ ...gates,awake:false },0)).toBe(false);
});
it('uses bounded source counts without creating negative taste or pretending to have heard music', () => {
  expect(musicInterestTrack(6)).toEqual({ value: 12, samples: 6, confidence: .5 });
  expect(musicInterestTrack(12)).toEqual({ value: 24, samples: 12, confidence: 2/3 });
  expect([0,5,6,11,12].map(musicInterestBand)).toEqual(['unknown','unknown','emerging','emerging','established']);
  expect(musicInterestTrack(13)).toEqual(musicInterestTrack(0));
});
