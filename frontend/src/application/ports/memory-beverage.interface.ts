/** Narrow coffee/tea hypotheses, MEMORY_ENGINE §15. Declarations; activation belongs to #114. */
import type { MemorySourcePair } from './memory-items.interface';
import type { MemoryOperationContext, MemoryResult } from './memory-repository.interface';

export type BeverageValue = 'coffee' | 'tea';
export interface BeveragePreferenceRef { readonly itemId: string; readonly revision: number }
export interface BeveragePreference {
  readonly ref: BeveragePreferenceRef;
  readonly category: 'beverage_preference';
  readonly value: BeverageValue;
  readonly provenance: 'model_proposal' | 'user_statement';
  readonly validity: 'hypothesis' | 'confirmed' | 'rejected';
  readonly manuallyCorrected: boolean;
  readonly status: 'active' | 'withdrawn';
  readonly source: MemorySourcePair;
  readonly updatedAt: string;
}
/** Untrusted semantic guess. Exact quote validates attribution, never truth or stability. */
export interface BeverageProposal { readonly value: BeverageValue; readonly evidenceQuote: string }
/** Opaque RAM offer bound to one current-generation, successfully persisted source pair. */
export interface BeverageOffer {
  readonly offerId: string;
  readonly proposal: BeverageProposal;
  readonly source: MemorySourcePair;
}
/** Separate from scalar facts, topics and Character preferences. */
export interface AIProviderBeverageContext {
  readonly allowProposal: boolean;
  readonly current?: { readonly value: BeverageValue; readonly validity: 'hypothesis' | 'confirmed' };
}
export type BeverageMutation = { readonly commandId: string; readonly updatedAt: string } & (
  | { readonly kind: 'save_hypothesis'; readonly itemId: string; readonly expected: null;
      readonly value: BeverageValue; readonly source: MemorySourcePair; readonly consented: true }
  | { readonly kind: 'confirm' | 'correct'; readonly expected: BeveragePreferenceRef;
      readonly value: BeverageValue; readonly source: MemorySourcePair; readonly confirmed: true }
  | { readonly kind: 'reject' | 'withdraw' | 'delete'; readonly expected: BeveragePreferenceRef }
);
export interface BeverageReceipt {
  readonly commandId: string;
  readonly ref: BeveragePreferenceRef;
  readonly outcome: 'hypothesis' | 'confirmed' | 'rejected' | 'withdrawn' | 'deleted';
}
/** A request that consumed current preference; output pair is suppressed, never new evidence. */
export interface BeverageTurnUse {
  readonly expected: BeveragePreferenceRef;
  readonly requestId: string;
  readonly userMessageId: string;
}
/** Trusted binding created by preflight recognizer, not provider/Renderer text classification. */
export interface BeverageCorrectionTurn {
  readonly expected: BeveragePreferenceRef;
  readonly value: BeverageValue;
  readonly requestId: string;
  readonly userMessageId: string;
}
export interface IBeveragePreferencesRepository {
  read(context: MemoryOperationContext): Promise<MemoryResult<BeveragePreference | null>>;
  mutate(command: BeverageMutation, next: MemoryOperationContext): Promise<MemoryResult<BeverageReceipt>>;
}
