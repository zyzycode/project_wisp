import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { RoutineHypothesisSettings } from '../../src/renderer/components/Chat/RoutineHypothesisSettings';
import { RoutineHypothesisClient, getRoutineHypothesisClient } from '../../src/renderer/routine-hypothesis-client';
import type { RoutineHypothesisResultDTO } from '../../src/shared/routine-hypothesis-contracts';
const preview={sharing:false,available:true,backendAvailable:false,suppressed:false,windowStartHour:6 as const,counts:{eligibleDays:14,positiveDays:10,recentPositiveDays:5,observedThroughDate:'2026-11-08',qualifies:true}};
function fixture() {
 const read=vi.fn(async()=>({ok:true as const,state:preview}));
 const command=vi.fn(async(c: {readonly requestId:string}):Promise<RoutineHypothesisResultDTO>=>({ok:true,requestId:c.requestId}));
 const bridge={read,command}; return {bridge,read,command,client:getRoutineHypothesisClient(bridge)};
}
it('shows actual coverage, off-by-default opt-in, separate withdrawal and offline scope without AI calls', async()=>{
 const f=fixture(); f.client.acceptStream('s'); await f.client.read();
 const html=renderToStaticMarkup(<RoutineHypothesisSettings bridge={f.bridge} streamId="s"/>);
 expect(html).toContain('Подходящих дней: 14 из 28'); expect(html).toContain('Только при работающей Wisp'); expect(html).toContain('Не использовать этот вывод'); expect(html).toContain('AI-соединение сейчас недоступно'); expect(html).not.toContain('checked=""'); expect(f.command).not.toHaveBeenCalled();
});
it('an unknown acknowledgement is never retried and requires a read before another setting change', async()=>{
 const f=fixture(); const client=new RoutineHypothesisClient(f.bridge,()=> 'request'); client.acceptStream('s'); await client.read();
 f.command.mockRejectedValueOnce(new Error('lost acknowledgement')); await client.suppress(6,true);
 expect(f.command).toHaveBeenCalledOnce(); expect(client.getState()).toMatchObject({value:null,busy:false}); expect(client.getState().message).toContain('не подтверждено');
});
it('cannot restore an old stream from a late sharing acknowledgement', async()=>{
 const f=fixture(); let resolve!: (v:RoutineHypothesisResultDTO)=>void; f.command.mockImplementationOnce(()=>new Promise(yes=>{resolve=yes;}));
 const client=new RoutineHypothesisClient(f.bridge,()=> 'request'); client.acceptStream('s'); await client.read(); const pending=client.share(true); client.acceptStream('next');
 resolve({ok:true,requestId:'request'}); await pending; expect(client.getState()).toEqual({value:null,busy:false,message:null}); expect(f.read).toHaveBeenCalledOnce();
});
