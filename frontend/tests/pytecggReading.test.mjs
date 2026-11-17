import test from 'node:test';
import assert from 'node:assert/strict';
import {freshPytecggReading} from '../lib/pytecggReading.ts';

test('Zimbabwe and SANSA use one package identity and freshness rule',()=>{
 const now=Date.parse('2026-11-17T12:00:00Z');
 const reading={gg_engine:'pytecgg',gg_version:'1.3.0',gg_vtec:25,gg_time:'2026-11-17T11:59:00Z'};
 assert.equal(freshPytecggReading(reading,0,now),true);
 assert.equal(freshPytecggReading({...reading,gg_engine:'gg_modip_lt_window_ls'},0,now),false);
 assert.equal(freshPytecggReading({...reading,gg_time:'2026-11-17T11:49:59Z'},0,now),false);
 assert.equal(freshPytecggReading(reading,181,now),false);
 assert.equal(freshPytecggReading({...reading,gg_time:'2026-11-17T12:03:00Z'},0,now),false);
});
