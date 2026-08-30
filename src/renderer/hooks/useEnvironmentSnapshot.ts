import { useEffect, useState } from 'react';
import type { EnvironmentSnapshotDTO } from '../../shared/ipc-contracts';

/**
 * Renderer-side view of Main-owned environment state. No Electron APIs leak
 * into React; future motion/surface orchestration can consume this DTO directly.
 */
export function useEnvironmentSnapshot(): EnvironmentSnapshotDTO | null {
  const [snapshot, setSnapshot] = useState<EnvironmentSnapshotDTO | null>(null);

  useEffect(() => {
    let active = true;
    void window.wispAPI.getEnvironmentSnapshot()
      .then((nextSnapshot) => {
        if (active) setSnapshot(nextSnapshot);
      })
      .catch((error: unknown) => console.error('Failed to get environment snapshot:', error));

    const unsubscribe = window.wispAPI.onEnvironmentChanged((nextSnapshot) => {
      if (active) setSnapshot(nextSnapshot);
    });

    return (): void => {
      active = false;
      unsubscribe();
    };
  }, []);

  return snapshot;
}
