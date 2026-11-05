import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { parseMusicTopic } from '../../src/infrastructure/ai/backend-music-interest';
import { projectInteractionChat } from '../../src/infrastructure/ai/backend-interaction-validation';
import { providerRequest } from './backend-ai-fixture';
const read=(name:string):unknown=>JSON.parse(readFileSync(path.resolve('../docs/contracts/fixtures/desktop-backend-v1/music-topic',name),'utf8'));
function corpus(name:string){const r=read(name);if(!Array.isArray(r))throw new Error('Invalid fixture');return r;}
it('validates the independent shared strict corpus and preserves the absent baseline exactly',()=>{
  for(const c of corpus('invalid.json'))expect(()=>parseMusicTopic(c.value),c.name).toThrow();
  const request=providerRequest(),baseline=projectInteractionChat(request);
  expect(baseline).not.toHaveProperty('musicTopic');
  for(const c of corpus('valid.json')){
    const musicTopic=parseMusicTopic(c.value),enriched=projectInteractionChat({...request,musicTopic});
    const {musicTopic:actual,...rest}=enriched;expect(actual).toEqual(musicTopic);expect(rest).toEqual(baseline);
  }
});
it('omits the whole music bundle behind an existing higher-priority topic without changing that request',()=>{
  const request={...providerRequest(),dialogueTopic:{mode:'reply' as const,text:'An existing topic',statedAt:'2026-11-05T10:00:00.000Z'}};
  const musicTopic=parseMusicTopic(corpus('valid.json')[0].value);
  expect(projectInteractionChat({...request,musicTopic})).toEqual(projectInteractionChat(request));
});
it('drops music atomically at the byte limit without evicting baseline history or required content',()=>{
  const musicTopic=parseMusicTopic(corpus('valid.json')[0].value);
  let boundary=false;
  for(let n=0;n<=1800;n+=10){
    const recentContext=Array.from({length:8},(_,i)=>({role:i%2===0?'user' as const:'wisp' as const,text:i%2===0?'界'.repeat(200):i===7?'界'.repeat(n)+'a'.repeat(1800-n):'界'.repeat(1800),createdAt:'2026-11-05T10:00:00.000Z'}));
    const base=providerRequest();
    const memoryContext: import('../../src/application/ports/memory-knowledge.interface').AIProviderMemoryContext={facts:[{key:'user.display_name',value:'界'.repeat(80)},{key:'user.preferred_address',value:'界'.repeat(80)},{key:'user.favorite_topic',value:'界'.repeat(120)}],episodes:[0,1].map(()=>({kind:'dialogue' as const,userText:'界'.repeat(240),assistantText:'界'.repeat(400),occurredAt:'2026-11-05T10:00:00.000Z'})),characterPreferences:[]};
    const request={...base,recentContext,memoryContext,userMessage:{...base.userMessage,text:'界'.repeat(240)},characterSnapshot:{...base.characterSnapshot,personality:{...base.characterSnapshot.personality,aiSelfConcept:'界'.repeat(500)}},previousInitiative:{kind:'social_bid' as const,text:'界'.repeat(240),createdAt:'2026-11-05T10:00:00.000Z'}};
    const baseline=projectInteractionChat(request),enriched=projectInteractionChat({...request,musicTopic});
    if(!enriched.musicTopic){expect(enriched).toEqual(baseline);boundary=true;break;}
  }
  expect(boundary).toBe(true);
});
