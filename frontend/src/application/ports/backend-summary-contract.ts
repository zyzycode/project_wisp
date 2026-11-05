import type { BackendEventAwareChatRequest, BackendEventAwareChatResponse, BackendEventErrorResponse } from './backend-events-contract';
export interface BackendPairSummaryRequest { readonly requestId: string; readonly locale: 'ru' | 'en'; readonly stream: false; readonly pairs: readonly { readonly userText: string; readonly assistantText: string }[] }
export type BackendSummaryRequest = BackendPairSummaryRequest | import('./backend-life-history-contract').BackendLifeSummaryRequest;
export interface BackendSummaryResponse { readonly requestId: string; readonly text: string }
export type BackendSummaryChatRequest = BackendEventAwareChatRequest & { readonly summary?: { readonly text: string } | import('./backend-life-history-contract').BackendLifeSummaryContext };
export type BackendSummaryChatResponse = BackendEventAwareChatResponse;
export type BackendSummaryErrorResponse = BackendEventErrorResponse;
