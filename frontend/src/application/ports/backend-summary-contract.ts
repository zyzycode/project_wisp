import type { BackendEventAwareChatRequest, BackendEventAwareChatResponse, BackendEventErrorResponse } from './backend-events-contract';
export interface BackendSummaryRequest { readonly version: 1; readonly requestId: string; readonly locale: 'ru' | 'en'; readonly stream: false; readonly pairs: readonly { readonly userText: string; readonly assistantText: string }[] }
export interface BackendSummaryResponse { readonly version: 1; readonly requestId: string; readonly text: string }
export type BackendSummaryChatRequest = BackendEventAwareChatRequest & { readonly summary?: { readonly text: string } };
export type BackendSummaryChatResponse = BackendEventAwareChatResponse;
export type BackendSummaryErrorResponse = BackendEventErrorResponse;
