import { powerMonitor } from 'electron';

/** A system boundary ends microphone consent; resuming never reopens it. */
export function subscribeVoiceRevocation(revoke: () => void): () => void {
  powerMonitor.on('suspend', revoke);
  powerMonitor.on('lock-screen', revoke);
  powerMonitor.on('user-did-resign-active', revoke);
  return () => {
    powerMonitor.removeListener('suspend', revoke);
    powerMonitor.removeListener('lock-screen', revoke);
    powerMonitor.removeListener('user-did-resign-active', revoke);
  };
}
