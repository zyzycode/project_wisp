import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { parseRoutineHypothesis } from '../../src/infrastructure/ai/backend-routine-validation';
import { projectInteractionChat } from '../../src/infrastructure/ai/backend-interaction-validation';
import { projectEventRequest } from '../../src/infrastructure/ai/backend-events-validation';
import { ExternalAIProviderClient } from '../../src/infrastructure/ai/external-ai-provider-client';
import { providerRequest } from './backend-ai-fixture';
const corpus: { valid: {name:string;value:unknown}[]; invalid:{name:string;value:unknown}[] } = JSON.parse(readFileSync(path.resolve('../docs/contracts/fixtures/desktop-backend-v1/routine-hypothesis/context.json'),'utf8'));
it('independently checks the exact shared routine wire corpus', () => {
 for(const entry of corpus.valid) expect(parseRoutineHypothesis(entry.value),entry.name).toEqual(entry.value);
 for(const entry of corpus.invalid) expect(()=>parseRoutineHypothesis(entry.value),entry.name).toThrow();
});
it('keeps the absent baseline exact and appends only allowed primitives without source identity', () => {
 const request=providerRequest(), baseline=projectInteractionChat(request), hypothesis=parseRoutineHypothesis(corpus.valid[0]!.value);
 const projected=projectInteractionChat({...request,routineHypothesis:hypothesis}); const {routineHypothesis,...unchanged}=projected;
 expect(unchanged).toEqual(baseline); expect(routineHypothesis).toEqual(hypothesis); expect(JSON.stringify(routineHypothesis)).not.toMatch(/source|zoneId|cohort|dataset|revision|title/u);
 const event={requestId:request.requestId,characterSnapshot:request.characterSnapshot,memoryContext:request.memoryContext ?? {facts:[],episodes:[],characterPreferences:[]},locale:'ru' as const,event:{type:'social_bid_started' as const,occurredAt:'2026-11-09T07:00:00.000Z'},routineHypothesis:hypothesis};
 expect(()=>projectEventRequest(event)).toThrow('ordinary chat only');
});
it.each([401,503,504])('uses the existing %i error without retries or extracting routine context', async status => {
 const request={...providerRequest(),routineHypothesis:parseRoutineHypothesis(corpus.valid[0]!.value)};
 const fetcher=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({requestId:request.requestId,error:{code:status===401?'unauthorized':status===504?'upstream_timeout':'upstream_unavailable'}}),{status,headers:{'Content-Type':'application/json'}}));
 const client=new ExternalAIProviderClient({baseUrl:'https://backend.example',development:false,now:Date.now,fetch:fetcher});
 if(status===401) await expect(client.generateResponse(request)).rejects.toThrow(); else expect((await client.generateResponse(request)).status).toBe('fallback'); expect(fetcher).toHaveBeenCalledOnce(); expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toHaveProperty('routineHypothesis',request.routineHypothesis);
});
