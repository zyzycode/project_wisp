/** Bounded input segmentation, not recognition: 20ms frames of mono 16kHz PCM. */
export class VoiceActivityDetector {
  private frame: number[] = [];
  private preroll: number[][] = [];
  private phrase: number[][] | null = null;
  private speechWindow: boolean[] = [];
  private speechConfirmed = false;
  private silentFrames = 0;

  public reset(): void {
    this.frame = []; this.preroll = []; this.phrase = null;
    this.speechWindow = []; this.speechConfirmed = false; this.silentFrames = 0;
  }
  public append(samples: Float32Array): number[][] {
    const utterances: number[][] = [];
    for (const value of samples) {
      this.frame.push(Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0);
      if (this.frame.length < 320) continue;
      const frame = this.frame; this.frame = [];
      const loud = Math.sqrt(frame.reduce((sum, sample) => sum + sample * sample, 0) / 320) >= 0.012;
      if (!this.phrase) {
        this.preroll.push(frame);
        if (this.preroll.length > 15) this.preroll.shift();
        if (!loud) continue;
        this.phrase = this.preroll; this.preroll = [];
        this.speechWindow = [true]; this.speechConfirmed = false; this.silentFrames = 0;
      } else {
        this.phrase.push(frame);
        this.speechWindow.push(loud);
        if (this.speechWindow.length > 20) this.speechWindow.shift();
        if (this.speechWindow.filter(Boolean).length >= 13) this.speechConfirmed = true;
        if (loud) this.silentFrames = 0;
        else this.silentFrames++;
      }
      if (this.silentFrames >= 40 || this.phrase.length >= 750) {
        if (this.speechConfirmed) utterances.push(this.phrase.flat());
        this.phrase = null; this.speechWindow = []; this.speechConfirmed = false; this.silentFrames = 0;
      }
    }
    return utterances;
  }
}
