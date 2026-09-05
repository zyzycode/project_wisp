import React from 'react';
import type { IAIProvider } from '../../application/ports/ai-provider.interface';
import { MockAIProvider } from '../../infrastructure/ai/mock-ai-provider';
import { useDesktopPetController } from '../hooks/useDesktopPetController';
import { PetOverlay } from './PetOverlay';

const DEFAULT_MOCK_AI_PROVIDER = new MockAIProvider({ simulatedLatencyMs: 300 });

export interface DesktopPetProps {
  readonly aiProvider?: IAIProvider;
}

/** DesktopPet is only the Renderer composition root for Body, UI, and the current provider. */
export const DesktopPet: React.FC<DesktopPetProps> = ({
  aiProvider = DEFAULT_MOCK_AI_PROVIDER,
}) => {
  const model = useDesktopPetController({ aiProvider, bridge: window.wispAPI });
  return <PetOverlay model={model} />;
};
