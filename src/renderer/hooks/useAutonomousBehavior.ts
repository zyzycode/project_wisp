import { useState, useEffect, useRef, useCallback } from 'react';
import type { Point2D, RectBounds } from '../../domain/models/position';
import type { AnimationState, AnimationEvent } from '../../domain/animation/animation-state-machine';
import {
  calculateNextWanderTarget,
  interpolatePosition,
  decideNextAutonomousAction,
  DEFAULT_BEHAVIOR_CONFIG,
  BehaviorConfig,
} from '../../domain/behavior/autonomous-behavior';

interface UseAutonomousBehaviorProps {
  currentPosition: Point2D;
  screenBounds: RectBounds | null;
  animState: AnimationState;
  isDragging: boolean;
  onPositionChange: (pos: Point2D) => void;
  dispatchAnim: (event: AnimationEvent) => boolean;
  config?: BehaviorConfig;
  enabled?: boolean;
}

export function useAutonomousBehavior({
  currentPosition,
  screenBounds,
  animState,
  isDragging,
  onPositionChange,
  dispatchAnim,
  config = DEFAULT_BEHAVIOR_CONFIG,
  enabled = true,
}: UseAutonomousBehaviorProps) {
  const [isWandering, setIsWandering] = useState<boolean>(false);
  const positionRef = useRef<Point2D>(currentPosition);
  positionRef.current = currentPosition;

  const wanderStateRef = useRef<{
    startPos: Point2D;
    targetPos: Point2D;
    startTime: number;
    durationMs: number;
  } | null>(null);

  // Autonomous Behavior Loop
  useEffect(() => {
    if (!enabled || isDragging || animState === 'sleep' || animState === 'dragged' || animState === 'falling') {
      setIsWandering(false);
      wanderStateRef.current = null;
      return;
    }

    let timerId: ReturnType<typeof setTimeout>;

    const scheduleNextAction = () => {
      const idleDuration =
        config.minIdleDurationMs +
        Math.random() * (config.maxIdleDurationMs - config.minIdleDurationMs);

      timerId = setTimeout(() => {
        if (!screenBounds || isDragging || animState !== 'idle') return;

        const action = decideNextAutonomousAction(config);

        if (action === 'wander') {
          const wanderTarget = calculateNextWanderTarget(
            positionRef.current,
            screenBounds,
            { width: 100, height: 100 },
            config
          );

          wanderStateRef.current = {
            startPos: { ...positionRef.current },
            targetPos: wanderTarget.target,
            startTime: performance.now(),
            durationMs: wanderTarget.durationMs,
          };

          setIsWandering(true);
          dispatchAnim('START_FLOAT');
        } else if (action === 'take_nap') {
          dispatchAnim('START_SLEEP');
        } else if (action === 'stretch' || action === 'idle_look_around') {
          dispatchAnim('PET'); // Trigger happy/stretch expression
        }

        scheduleNextAction();
      }, idleDuration);
    };

    scheduleNextAction();

    return () => {
      clearTimeout(timerId);
    };
  }, [enabled, isDragging, animState, screenBounds, config, dispatchAnim]);

  // Wander movement frame loop
  useEffect(() => {
    if (!isWandering || !wanderStateRef.current) return;

    let frameId: number;

    const stepWander = (now: number) => {
      if (!wanderStateRef.current) return;

      const elapsed = now - wanderStateRef.current.startTime;
      const progress = Math.min(1, elapsed / wanderStateRef.current.durationMs);

      const nextPos = interpolatePosition(
        wanderStateRef.current.startPos,
        wanderStateRef.current.targetPos,
        progress
      );

      onPositionChange(nextPos);

      if (progress < 1) {
        frameId = requestAnimationFrame(stepWander);
      } else {
        setIsWandering(false);
        wanderStateRef.current = null;
        dispatchAnim('STOP_FLOAT');
      }
    };

    frameId = requestAnimationFrame(stepWander);

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [isWandering, onPositionChange, dispatchAnim]);

  const triggerNap = useCallback(() => {
    setIsWandering(false);
    wanderStateRef.current = null;
    dispatchAnim('START_SLEEP');
  }, [dispatchAnim]);

  const wakeUp = useCallback(() => {
    dispatchAnim('WAKE_UP');
  }, [dispatchAnim]);

  return {
    isWandering,
    triggerNap,
    wakeUp,
  };
}
