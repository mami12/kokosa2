import {nativeZizobetContractRow} from './native-zizobet-contract.mjs';
import {liveContract} from './live-contract-rules.mjs';
import {SUPPORTED_FACT_KINDS} from './match-event-facts.mjs';

/**
 * Recover corner contracts for older tickets placed from a real Zizobet offer
 * before a parser existed. Only the immutable accepted native quote is used;
 * display translations, AAMS labels and other providers are never inferred.
 */
export function recoverLegacyZizobetCornerContract(line){
 let accepted=line?.accepted_contract;
 if(typeof accepted==='string'){
  try{accepted=JSON.parse(accepted);}catch{return null;}
 }
 if(!accepted||typeof accepted!=='object'||accepted.settlementHold)return null;
 if(String(accepted.sourceProviderId??'').toUpperCase()!=='ZIZOBET')return null;
 const nativeName=String(accepted.nativeMarketName??'').trim();
 if(!nativeName||!/\b(?:corner|corners|corner kicks|kornera)\b/i.test(nativeName))return null;
 if(/\baams(?:[-\s]?logic)?\b/i.test(nativeName))return null;
 const row={
  provider_id:'ZIZOBET',
  market_key:accepted.providerMarketKey??line.market_key,
  market_name:accepted.providerMarketName??line.market_name,
  outcome_key:accepted.providerOutcomeKey??line.outcome_key,
  outcome_name:accepted.nativeOutcomeName??accepted.providerOutcomeName??line.outcome_name,
  line:accepted.line??line.line??'',
  period:accepted.providerPeriod??line.period??0,
  native_market_id:accepted.nativeMarketId??null,
  native_outcome_id:accepted.nativeOutcomeId??null,
  native_market_name:nativeName,
  native_outcome_name:accepted.nativeOutcomeName??null,
  native_parameters:accepted.nativeParameters??null
 };
 let normalized;
 try{normalized=nativeZizobetContractRow(row);}catch{return null;}
 const quoted={
  ...line,...normalized,
  market_name:normalized?.market_name??nativeName,
  outcome_key:row.outcome_key,
  outcome_name:row.outcome_name,
  line:row.line,
  period:row.period
 };
 const counts=accepted.acceptedLiveSnapshot?.counters??{};
 let contract;
 try{contract=liveContract(quoted,{counts});}catch{return null;}
 if(!contract||contract.event!=='corner'||!SUPPORTED_FACT_KINDS.has(contract.kind))return null;
 return contract;
}
