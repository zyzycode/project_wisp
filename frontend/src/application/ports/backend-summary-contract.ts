import type { BackendEventAwareChatRequest, BackendEventAwareChatResponse, BackendEventErrorResponse } from './backend-events-contract';
export interface BackendSummaryRequest { readonly version: 5; readonly requestId: string; readonly locale: 'ru' | 'en'; readonly stream: false; readonly pairs: readonly { readonly userText: string; readonly assistantText: string }[] }
export interface BackendSummaryResponse { readonly version: 5; readonly requestId: string; readonly text: string }
export type BackendSummaryChatRequest = Omit<BackendEventAwareChatRequest, 'version'> & { readonly version: 5; readonly summary?: { readonly text: string } };
export type BackendSummaryChatResponse = Omit<BackendEventAwareChatResponse, 'version'> & { readonly version: 5 };
export type BackendSummaryErrorResponse = Omit<BackendEventErrorResponse, 'version'> & { readonly version: 5 };
