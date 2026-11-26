import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {buildMarkets} from '../server/collector.mjs';

const row=(marketKey,line,outcomeKey,outcomeName,price,updatedAt,period=0)=>({
 match_id:70001,market_key:marketKey,market_name:'Total Goals',
 native_market_name:'Total Goals',line,outcome_key:outcomeKey,
 outcome_name:outcomeName,price,suspended:false,is_base:false,
 grp_order:10,period,updated_at:new Date(updatedAt)
});
const older='2026-11-23T10:00:00.000Z',newer='2026-11-23T10:00:05.000Z';
const rows=[
 row('zz100@e30','2.5','Over','Over',1.85,older),
 row('zz100@e30','2.5','Under','Under',1.95,older),
 // Same visible offer under a second native ID must not render as another card.
 row('zz101@e30','2.5','Over','Over',1.90,newer),
 row('zz101@e30','2.5','Under','Under',1.90,newer),
 // Different line and period are separate contracts and must remain visible.
 row('zz102@e30','3.5','Over','Over',2.10,newer),
 row('zz102@e30','3.5','Under','Under',1.70,newer),
 row('zz103@e30','2.5','Over','Over',2.20,newer,1),
 row('zz103@e30','2.5','Under','Under',1.60,newer,1),
];
const markets=buildMarkets(rows);
assert.equal(markets.length,3,'only the exact duplicate display offer is removed');
const fullTime=markets.find(m=>m.period===0&&m.line==='2.5');
assert.ok(fullTime);
assert.equal(fullTime.key,'zz101@e30','the freshest native quote remains the selectable market');
assert.deepEqual(fullTime.outcomes.map(o=>o.name).sort(),['Over','Under']);
assert.equal(fullTime.outcomes.find(o=>o.name==='Over').price,1.90);
assert.ok(markets.some(m=>m.line==='3.5'),'different lines remain');
assert.ok(markets.some(m=>m.period===1),'different periods remain');
console.log('PASS identical visible markets are deduplicated without merging selection IDs or removing distinct lines/periods');
