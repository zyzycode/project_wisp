import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  AnimationStateMachine,
  AnimationState,
  AnimationEvent,
} from '../../domain/animation/animation-state-machine';
import type { CharacterExpression } from '../../domain/models/character-visuals';

export function useAnimationStateMachine(initialState: AnimationState = 'idle') {
  const fsm = useMemo(() => new AnimationStateMachine(initialState), []);
  const [animState, setAnimState] = useState<AnimationState>(fsm.getCurrentState());
  const [expression, setExpression] = useState<CharacterExpression>(fsm.getCurrentExpression());
  const lastTimeRef = useRef<number>(performance.now());

  useEffect(() => {
    const unsubscribe = fsm.subscribe((newState, newExpr) => {
      setAnimState(newState);
      setExpression(newExpr);
    });

    let animationFrameId: number;

    const tick = (now: number) => {
      const delta = now - lastTimeRef.current;
      lastTimeRef.current = now;

      if (delta > 0 && delta < 1000) {
        fsm.update(delta);
      }

      animationFrameId = requestAnimationFrame(tick);
    };

    animationFrameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animationFrameId);
      unsubscribe();
    };
  }, [fsm]);

  const dispatch = useCallback(
    (event: AnimationEvent, force?: boolean, loop?: boolean) => {
      return fsm.transition(event, force, loop);
    },
    [fsm]
  );

  return {
    state: animState,
    expression,
    dispatch,
  };
}
