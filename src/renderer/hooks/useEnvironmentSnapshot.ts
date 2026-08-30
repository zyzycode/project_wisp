import { useEffect, useState } from 'react';
import type { EnvironmentSnapshot } from '../../domain/behavior/surface-kinematics';

/**
 * Renderer-side view of Main-owned environment state. No Electron APIs leak
 * into React; future motion/surface orchestration can consume this DTO directly.
 */
export function useEnvironmentSnapshot(): EnvironmentSnapshot | null {
  const [snapshot, setSnapshot] = useState<EnvironmentSnapshot | null>(null);

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
