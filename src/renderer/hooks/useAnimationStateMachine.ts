import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  AnimationStateMachine,
  type AnyAnimationState,
  type AnimationEvent,
  type TerminalAnimationState,
} from '../../domain/animation/animation-state-machine';
import type { CharacterExpression } from '../../domain/models/character-visuals';

export function useAnimationStateMachine(initialState: AnyAnimationState = 'idle') {
  const fsm = useMemo(() => new AnimationStateMachine(initialState), []);
  const [animState, setAnimState] = useState<AnyAnimationState>(fsm.getCurrentState());
  const [expression, setExpression] = useState<CharacterExpression>(fsm.getCurrentExpression());

  useEffect(() => {
    const unsubscribe = fsm.subscribe((newState, newExpr) => {
      setAnimState(newState);
      setExpression(newExpr);
    });

    return () => {
      unsubscribe();
    };
  }, [fsm]);

  const dispatch = useCallback(
    (event: AnimationEvent, force?: boolean, loop?: boolean) => {
      return fsm.transition(event, force, loop);
    },
    [fsm]
  );

  const completeCurrentState = useCallback((): boolean => {
    return fsm.completeCurrentState();
  }, [fsm]);

  const synchronizeTerminalState = useCallback((state: TerminalAnimationState): boolean => {
    return fsm.synchronizeTerminalState(state);
  }, [fsm]);

  return {
    state: animState,
    expression,
    dispatch,
    completeCurrentState,
    synchronizeTerminalState,
  };
}
