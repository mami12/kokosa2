import assert from 'node:assert/strict';
import {nativeZizobetContractRow} from '../server/ledger/native-zizobet-contract.mjs';
import {liveContract} from '../server/ledger/live-contract-rules.mjs';
const offer=(id,native,params,line='',outcome='Over')=>({
 provider_id:'ZIZOBET',market_key:'zz'+id+'@'+Buffer.from(JSON.stringify(params)).toString('base64url'),
 native_market_id:String(id),native_market_name:native,native_parameters:params,
 market_name:'Përkthim që nuk përdoret për shlyerje',outcome_name:outcome,line
});
const home=offer(9001,'Total [total] Corners HomeTeam in 5 minutes interval [from]-[to]',
 {p1:16,p2:20},'0.5');
const resolved=nativeZizobetContractRow(home);
assert.equal(resolved.market_name,'Total 0.5 home team corners in minutes 16-20 (5-minute interval)');
assert.deepEqual(liveContract(resolved),{
 version:1,kind:'window-total',event:'corner',side:'home',from:16,to:20,
 choice:'over',threshold:0.5
});
assert.equal(home.market_name,'Përkthim që nuk përdoret për shlyerje','never mutate stored quote');

const intervalTotal=nativeZizobetContractRow(offer(9015,
 '10 minutes - Total corners from first value - second value:00 min',
 {p1:21,p2:30},'0.5'));
assert.equal(intervalTotal.market_name,'Total 0.5 corners in minutes 21-30 (10-minute interval)');
assert.equal(liveContract(intervalTotal)?.kind,'window-total');
const teamInterval=nativeZizobetContractRow(offer(9016,
 '10 minutes - Awayteam total corners from first value - second value:00 min',
 {p1:21,p2:30},'0.5'));
assert.equal(teamInterval.market_name,'Total 0.5 away team corners in minutes 21-30 (10-minute interval)');
assert.deepEqual(liveContract(teamInterval),{
 version:1,kind:'window-total',event:'corner',side:'away',from:21,to:30,
 choice:'over',threshold:0.5
});
const cornerResult=nativeZizobetContractRow(offer(9017,
 '10 minutes - Corner result from first value - second value:00 min',
 {p1:21,p2:30},'','1'));
assert.equal(cornerResult.market_name,'Who takes most corners in minutes 21-30 (10-minute interval)');
assert.equal(liveContract(cornerResult)?.kind,'interval-leader');
const firstCorner=nativeZizobetContractRow(offer(9018,
 '10 minutes - 1st corner from first value:00 - second value min',
 {p1:21,p2:30},'','1'));
assert.equal(liveContract(firstCorner)?.kind,'window-first-event');
const intervalHandicap=nativeZizobetContractRow(offer(9019,
 '10 minutes - Corner handicap from first value:00 - second value min',
 {p1:21,p2:30},'-1.5'));
assert.equal(intervalHandicap.market_name,'Corner handicap in minutes 21-30 (10-minute interval)');
assert.equal(liveContract({...intervalHandicap,outcome_name:'1'})?.kind,'interval-handicap');

const oddEvenCorners=nativeZizobetContractRow(offer(9022,
 '10 minutes - odd/even corners from first value:00 - second value min',
 {p1:21,p2:30}));
assert.equal(oddEvenCorners.market_name,'Odd/Even corners in minutes 21-30 (10-minute interval)');
assert.equal(liveContract({...oddEvenCorners,outcome_name:'Odd'})?.kind,'window-parity');

const rangeAwayCorners=nativeZizobetContractRow(offer(9023,
 'Total 0.5 away team corners in minutes time range (10-minute interval)',
 {p1:21,p2:30},'0.5'));
assert.equal(rangeAwayCorners.market_name,'Total 0.5 away team corners in minutes 21-30 (10-minute interval)');
assert.equal(liveContract(rangeAwayCorners)?.kind,'window-total');
const numberedGoal=nativeZizobetContractRow(offer(9024,
 'Who scores goal number in minutes time range (10-minute interval)',
 {p1:21,p2:30,p3:2},'','1'));
assert.equal(numberedGoal.market_name,'Who scores goal 2 in minutes 21-30 (10-minute interval)');
assert.equal(liveContract(numberedGoal)?.kind,'nth-time');

const intervalBookings=nativeZizobetContractRow(offer(9020,
 'Total 0.5 bookings in 10 minutes interval 21-30',{}));
assert.equal(intervalBookings.market_name,'Total 0.5 cards in minutes 21-30 (10-minute interval)');
assert.equal(liveContract(intervalBookings)?.event,'card');


const oneMinuteOffside=nativeZizobetContractRow(offer(9021,
 '1 minute - Total offsides from first value:00 to value min',
 {p1:16,p2:16},'0.5'));
assert.equal(oneMinuteOffside.market_name,'Total 0.5 offsides in minutes 16-16 (1-minute interval)');
assert.deepEqual(liveContract(oneMinuteOffside),{
 version:1,kind:'window-total',event:'offside',from:16,to:16,
 choice:'over',threshold:0.5
});

const race=offer(9002,'Which team wins race to X corners?',{},'7');
assert.equal(nativeZizobetContractRow(race).market_name,'Which team wins race to 7 corners');
const score=offer(18639,'Correct score [{score}]',{p3:'1:0'});
assert.equal(nativeZizobetContractRow(score).market_name,'Correct score rest of match (from 1:0)');
const firstHalfScore=offer(18640,'1st half - correct score [{score}]',{p3:'2:0'});
assert.equal(
 nativeZizobetContractRow(firstHalfScore).market_name,
 '1st half - Correct score rest of half (from 2:0)'
);
const teamResult=nativeZizobetContractRow(
 {...offer(7001,'{competitor1} to win',{}),'homeTeamName':'Dire Dawa','awayTeamName':'Arba Minch'},
 {competitors:{competitor1:'Dire Dawa',competitor2:'Arba Minch'}}
);
assert.equal(teamResult.market_name,'Dire Dawa to win');
const extended=offer(9003,'Total Goals [p4]',{p4:42});
assert.equal(nativeZizobetContractRow(extended).market_name,'Total Goals 42',
 'native contracts must decode parameters beyond p1-p3');
for(const [id,name,line] of [[9010,'Total Goals','1.25'],[9011,'Total Corners','1.75'],
 [9012,'Total Goals','0.75'],[9013,'Total Corners','0.25']]){
 assert.equal(liveContract(nativeZizobetContractRow(offer(id,name,{},line))),null,
  'quarter-line '+name+' '+line+' must not use full-win/full-loss event settlement');
}
assert.equal(liveContract(nativeZizobetContractRow(offer(9014,'Total Goals',{},'1.5')))?.kind,'over',
 'ordinary half-goal lines keep their verified event settlement contract');
assert.throws(()=>nativeZizobetContractRow({...home,native_parameters:{p1:16,p2:21}}),
 e=>e.code==='MARKET_EVIDENCE_UNSUPPORTED');
assert.throws(()=>nativeZizobetContractRow({...home,line:'0.5',native_market_id:'9002'}),
 e=>e.code==='MARKET_EVIDENCE_UNSUPPORTED');
assert.throws(()=>nativeZizobetContractRow(offer(9001,'Total [total] Corners HomeTeam in 5 minutes interval [from]-[to]',{p1:16,p2:21},'0.5')),
 e=>e.code==='MARKET_EVIDENCE_UNSUPPORTED');
assert.equal(nativeZizobetContractRow({...home,provider_id:'OTHER'}).market_name,home.market_name);
console.log('PASS Zizobet quoted dynamic parameters and native settlement contract');
