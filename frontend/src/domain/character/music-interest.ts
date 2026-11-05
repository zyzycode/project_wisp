export type MusicTopic = 'jazz' | 'classical' | 'rock' | 'electronic';
export const MUSIC_TOPICS: readonly MusicTopic[] = ['jazz', 'classical', 'rock', 'electronic'];
export type MusicMessage = { readonly topic: MusicTopic; readonly kind: 'opening' | 'continuation' }
  | { readonly topic: MusicTopic; readonly kind: 'preference'; readonly disposition: 'like' | 'dislike' };
const labels: Readonly<Record<MusicTopic, readonly [string, string, string]>> = {
  jazz: ['джаз', 'джазе', 'jazz'], classical: ['классика', 'классике', 'classical music'],
  rock: ['рок', 'роке', 'rock'], electronic: ['электронная музыка', 'электронной музыке', 'electronic music'],
};
/** Exact finite discussion forms; model wording and assignments are never evidence. */
export function recognizeMusicMessage(input: string): MusicMessage | undefined {
  if (input.length > 240) return undefined;
  const text = input.normalize('NFC').trim().toLowerCase().replace(/[.!?]$/u, '');
  for (const topic of MUSIC_TOPICS) {
    const [ru, prep, en] = labels[topic];
    if (text === `давай поговорим о ${prep}` || text === `let's discuss ${en}`) return { topic, kind: 'opening' };
    if (text === `продолжим разговор о ${prep}` || text === `let's keep discussing ${en}`) return { topic, kind: 'continuation' };
    if (text === `мне нравится ${ru}` || text === `i like ${en}`) return { topic, kind: 'preference', disposition: 'like' };
    if (text === `мне не нравится ${ru}` || text === `i dislike ${en}`) return { topic, kind: 'preference', disposition: 'dislike' };
  }
  return undefined;
}
export function acceptsMusicIntention(gates: { readonly awake: boolean; readonly quiet: boolean; readonly role: boolean;
  readonly causal: boolean; readonly otherBundle: boolean }, draw: number): boolean {
  return gates.awake && !gates.quiet && !gates.role && !gates.causal && !gates.otherBundle
    && Number.isFinite(draw) && draw >= 0 && draw < .25;
}
export function musicInterestTrack(count: number) {
  const n = Number.isSafeInteger(count) && count >= 0 && count <= 12 ? count : 0;
  return { value: 2 * n, samples: n, confidence: n / (n + 6) };
}
export function musicInterestBand(count: number): 'unknown' | 'emerging' | 'established' {
  return count >= 12 ? 'established' : count >= 6 ? 'emerging' : 'unknown';
}
/** A newly acknowledged positive experience never weakens an existing discussion-interest band. */
export function musicCountsDoNotDecrease(previous: readonly { readonly topic: MusicTopic }[], next: readonly { readonly topic: MusicTopic }[]): boolean {
  return MUSIC_TOPICS.every(topic => next.filter(s => s.topic === topic).length >= previous.filter(s => s.topic === topic).length);
}
