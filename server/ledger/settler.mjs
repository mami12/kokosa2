/**
 * Settlement.
 *
 * Grades the lines of a finished match and closes the tickets: any LOST line makes the
 * ticket LOST, otherwise the ticket is WON with the odds of the surviving lines (VOID
 * lines are removed from the price, as a real bookmaker does), and an all-VOID ticket is
 * refunded. Manager commissions and results remain reports for manual settlement;
 * player payouts are the only automatic wallet movement here.
 *
 * The rules come from the original app, with one addition: because our feed also delivers
 * corners and cards, those markets can be graded instead of always being voided.
 */
import { pool, query } from '../db.mjs';
import {isPlayerOfferMarket} from '../market-policy.mjs';
import {gradeEventLine,needsEvents,gradeClosedCornerWindow,loadEventEvidence} from './event-evidence.mjs';
import { getMatchById } from '../matches.mjs';
import { getResult, captureFinishedMatches, unsettledMatchIds } from './results.mjs';
import {captureHalfTimeResults} from './halftime-results.mjs';
import { chargeManagerCommission, refundManagerCommission } from './manager-finance.mjs';
import { isResultBttsMarket, parseResultBttsOutcome, gradeResultBtts } from './result-btts.mjs';
import { isResultTotalMarket, isTotalBttsMarket, isFirstHalfResultBtts, parseResultTotal, parseTotalBtts, gradeMixedTotal,
  isWinnerTotalMarket, isTeamNotToLoseTotalMarket, isBttsTotalAndMarket,
  parseWinnerTotal, parseTeamNotToLoseTotal, parseBttsTotal,
  gradeTeamNotToLoseTotal, gradeBttsTotal } from './mixed-combos.mjs';
import {isWinningMarginMarket,gradeWinningMargin} from './winning-margin.mjs';
import {isDcHalfBttsMarket,gradeDcHalfBtts} from './dc-half-btts.mjs';
import {isHtFtComboMarket,isCornersHtFtMarket,gradeHtFtCombo} from './htft-combo.mjs';
import {isMultiscoresMarket,gradeMultiscores,isMatchbetFirstGoalMarket,gradeMatchbetFirstGoal} from './multiscores.mjs';
import {isQualificationMarket,gradeQualification} from './qualification.mjs';
import { systemColumnPayout } from './system-columns.mjs';
import { eventMarketRequirement } from './event-market-policy.mjs';
import { isStatisticMarket, hasStatisticEvidence, gradeStatisticLine } from './statistic-markets.mjs';
import {goalTotalContract} from './goal-total-contract.mjs';
import {isScoringPropMarket,gradeScoringPropMarket} from './scoring-props.mjs';
import {isParityLikeMarket,gradeParityMarket} from './parity-markets.mjs';
import {isHandicapMarket,parseHandicapContract,gradeHandicapContract} from './handicap-contracts.mjs';
import {isHtFtMarket,parseHtFtOutcome,gradeHtFt} from './ht-ft.mjs';
import {isDcBttsMarket,parseDcBttsOutcome,gradeDcBtts} from './dc-btts.mjs';
import {isHalfComboFamily,parseHalfCombination,gradeHalfCombination} from './half-combinations.mjs';
import {isPeriodGoalTotal,parsePeriodGoalTotal,gradePeriodGoalTotal} from './period-goal-totals.mjs';
import {isHalfExactMarketFamily} from './half-exact-markets.mjs';
import {cornerTotalContract} from './corner-total-contract.mjs';
import {parseTeamCountMarket,liveContract} from './live-contract-rules.mjs';
import {statisticsNeedReview} from './settlement-review.mjs';
import {nativeZizobetContractRow} from './native-zizobet-contract.mjs';
import {createLiveSettlementPreviews} from './live-shadow-settlement.mjs';
import {gradeStoredEventContract,SUPPORTED_FACT_KINDS} from './match-event-facts.mjs';
import {recoverLegacyZizobetCornerContract} from './legacy-zizobet-corner-contract.mjs';
import {backfillPendingTeamGoalContracts} from './live-contract-backfill.mjs';
import {settleVerifiedLiveProposals} from './verified-live-settlement.mjs';

const legacyHandicapResult=(line,result)=>{
 const saved=line?.live_contract?.kind==='score-handicap'?line.live_contract:null;
 // Historical generic "Handicap" rows contain no proof whether a draw
 // was offered. Do not reconstruct an uncertain 2-way vs 3-way payout.
 if(!saved&&!/\b(?:asian|european|1x2|2[\s-]*way|3[\s-]*way|corner (?:spread|handicap))\b/i.test(
     String(line?.market_name??'')))return null;
 const c=saved??parseHandicapContract(line,{
  teams:{home:result?.home_team,away:result?.away_team}});
 return gradeHandicapContract(c,result);
};

const round = (n) => Number(Number(n).toFixed(2));
/**
 * Never downgrade a correlated provider offer to one familiar constituent.
 * An unknown "A AND B" is PENDING unless its entire compound contract
 * is parsed by a specific settlement grader. In particular, reading
 * "Double Chance And Total Goals" as plain DC paid BOTH 12/Over and 12/Under.
 */
export function unverifiedCompositeLine(line={},result={}){
 const name=String(line.market_name??line.marketName??'').trim();
 // These three correlated families have incompatible periods or a third
 // condition. They must NEVER fall into generic FT DC/BTTS or HT/FT grading
 // just because one familiar phrase appears in the title.
 if((/^double\s*chance\b.*\b(?:1st|first|2nd|second)\s+half\b/i.test(name)&&!isDcHalfBttsMarket(name))||
    (/^(?:1st|first)\s*\/\s*(?:2nd|second)\s+half\s+both\s+teams?\s+to\s+score/i.test(name)&&!isScoringPropMarket({market_name:name}))||
    (/\bcorners?\b.*\bhalf[\s-]*time\s*\/?\s*full[\s-]*time\b/i.test(name)&&!isCornersHtFtMarket(name))||
    (isHtFtMarket(name)&&!isHtFtComboMarket(name)&&/\b(?:correct score|exact goals?|total goals?|total corners?|both teams?|btts)\b/i.test(name)))
  return true;
 if(!/\b(?:and|with)\b|&|(?<!\d)\+|\+(?=[a-z])/i.test(name))return false;
 if(!/\b(?:result|winner|goals?|total|double chance|both teams?|btts|1x2|corners?|cards?|shots?|fouls?|score)\b/i.test(name))
  return false;
 if(isHalfComboFamily(line)||isResultTotalMarket(name)||isTotalBttsMarket(name)||
    isFirstHalfResultBtts(name)||isResultBttsMarket(name)||isDcBttsMarket(name)||
    isWinnerTotalMarket(name)||isTeamNotToLoseTotalMarket(name)||isBttsTotalAndMarket(name)||
    isDcHalfBttsMarket(name)||isHtFtComboMarket(name)||isMatchbetFirstGoalMarket(name)||isMultiscoresMarket(name))
  return false;
 // Named team totals are one condition, not two unrelated outcomes.
 if(goalTotalContract(line,result)||cornerTotalContract(line,result))return false;
 return true;
}
export function gradeWinningMethod(line,result){
 if(!/^winning\s+method$/i.test(String(line?.market_name??line?.accepted_contract?.providerMarketName??'').trim()))return null;
 const fh=scoreValue(result?.home_score),fa=scoreValue(result?.away_score);
 if(fh===null||fa===null)return null;
 const rawOutcome=[line?.outcome_name,line?.accepted_contract?.providerOutcomeName,line?.outcome_key]
  .find(v=>v!=null&&String(v).trim()!==''&&!/^z\d+$/i.test(String(v).trim()))
  ??line?.outcome_name??line?.accepted_contract?.providerOutcomeName??line?.outcome_key;
 const nk=normalizedTeamLabel(rawOutcome);
 if(!nk)return null;
 const homeName=normalizedTeamLabel(line?.accepted_contract?.homeTeamName??line?.home_team??result?.home_team);
 const awayName=normalizedTeamLabel(line?.accepted_contract?.awayTeamName??line?.away_team??result?.away_team);
 const is1st=/^(?:1|1st|first|home)\b/.test(nk)||(homeName&&(nk===homeName||nk.startsWith(homeName+' ')));
 const is2nd=/^(?:2|2nd|second|away)\b/.test(nk)||(awayName&&(nk===awayName||nk.startsWith(awayName+' ')));
 if(is1st===is2nd)return null;
 const isRegular=/\bregular\s*time\b/.test(nk);
 const isExtra=/\bextra\s*time\b/.test(nk);
 const isPenalty=/\bpenalt/.test(nk);
 if(Number(isRegular)+Number(isExtra)+Number(isPenalty)!==1)return null;
 const decide=v=>v?'WON':'LOST';
 if(fh!==fa){
  if(isRegular)return decide(is1st?fh>fa:fa>fh);
  return 'LOST'; // Decided in 90m regular time; ET and Penalties cannot win.
 }
 // 90m draw: regular-time selections lose; ET/Penalties require confirmed outcome facts.
 if(isRegular)return 'LOST';
 const sideOf=raw=>{
  const v=normalizedTeamLabel(raw);
  if(!v)return null;
  if(['1','home','home team','hometeam',homeName].filter(Boolean).includes(v))return 'home';
  if(['2','away','away team','awayteam',awayName].filter(Boolean).includes(v))return 'away';
  return null;
 };
 const penSide=sideOf(result?.penalty_winner);
 if(penSide){
  if(isExtra)return 'LOST';
  return decide(is1st?penSide==='home':penSide==='away');
 }
 const extraSide=sideOf(result?.extra_time_winner);
 if(extraSide){
  if(isPenalty)return 'LOST';
  return decide(is1st?extraSide==='home':extraSide==='away');
 }
 const qualSide=sideOf(result?.qualifying_team??result?.qualifier??result?.advancing_team??result?.winner);
 if(qualSide){
  const pickedHome=is1st;
  if((pickedHome&&qualSide!=='home')||(!pickedHome&&qualSide!=='away'))return 'LOST';
  const method=normalizedTeamLabel(result?.win_method??result?.winning_method);
  if(/\bpenalt/.test(method))return decide(isPenalty);
  if(/\bextra\s*time\b/.test(method))return decide(isExtra);
 }
 return null;
}
/**
 * An accepted, formerly unmapped Zizobet combo can be repaired WITHOUT
 * editing its contract or overriding a held wager. This is restricted to
 * two fully decoded, financially gradeable FT/HT/2H components, with every
 * field reconciled against the immutable accepted quote. All other holds
 * remain PENDING. Existing WON/LOST and wallet rows are never rewritten.
 */
export function gradeHeldNativeCombo(line,result){
 const saved=line?.accepted_contract,reason=String(saved?.settlementHold??'');
 // NATIVE_PARAMETERS_UNMAPPED means team names ({competitor1}/{competitor2}) or score
 // placeholder [{score}] could not be resolved at bet-placement time (pre-fix tickets).
 // Re-attempt resolution now using team names from the final result record.
 if(reason==='NATIVE_PARAMETERS_UNMAPPED'&&String(saved?.sourceProviderId??'').toUpperCase()==='ZIZOBET'){
  const homeTeam=saved.homeTeamName??result?.home_team??null;
  const awayTeam=saved.awayTeamName??result?.away_team??null;
  const effectiveResult=(result&&((!result.home_team&&homeTeam)||(!result.away_team&&awayTeam)))
   ?{...result,home_team:result.home_team||homeTeam,away_team:result.away_team||awayTeam}
   :result;
  const frozenForResolve={
   provider_id:'ZIZOBET',
   // Use nativeMarketName (with unresolved placeholders) so resolveMarketTitle
   // can substitute {$competitor1}/{$competitor2} from the result's team names.
   native_market_name:saved.nativeMarketName??saved.providerMarketName??line.market_name,
   market_key:saved.providerMarketKey??line.market_key,
   native_market_id:saved.nativeMarketId??null,
   native_parameters:saved.nativeParameters??null,
   line:saved.line??line.line??null,
   homeTeamName:homeTeam,
   awayTeamName:awayTeam,
  };
  let resolved=null;
  try{resolved=nativeZizobetContractRow(frozenForResolve);}catch{return null;}
  if(!resolved?.market_name)return null;
  // Re-use the existing grade path with the now-resolved market name, but
  // strip the settlement hold so gradeLine() can proceed normally.
  const resolvedLine={...line,market_name:resolved.market_name,
   outcome_name:saved.providerOutcomeName??line.outcome_name,
   outcome_key:saved.providerOutcomeKey??line.outcome_key,
   line:String(saved.line??line.line??''),
   period:line.period??saved.providerPeriod??0,
   accepted_contract:{...saved,settlementHold:null}};
  if(!hasRequiredSettlementEvidence(resolvedLine,effectiveResult))return null;
  return gradeLine(resolvedLine,effectiveResult);
 }
 if(!['NATIVE_FINAL_RULE_UNMAPPED','NATIVE_HALF_COMBO_UNMAPPED',
      'NATIVE_PERIOD_GOAL_UNMAPPED','NATIVE_CONTRACT_REVIEW',
      'NATIVE_LIVE_HANDICAP_UNMAPPED','NATIVE_HANDICAP_UNMAPPED',
      'NATIVE_HTFT_UNMAPPED','NATIVE_DC_BTTS_UNMAPPED'].includes(reason))return null;
 if(String(saved?.sourceProviderId??'').toUpperCase()!=='ZIZOBET')return null;
 const equal=(a,b)=>String(a??'')===String(b??'');
 if(!saved.providerMarketName||!saved.providerOutcomeName||
    !equal(saved.providerMarketName,line.market_name)||
    !equal(saved.providerOutcomeName,line.outcome_name)||
    !equal(saved.providerMarketKey,line.market_key)||
    !equal(saved.providerOutcomeKey,line.outcome_key)||
    !equal(saved.line,line.line))return null;
 const rawPeriod=Number(saved.providerPeriod??0);
 if(![0,1,2].includes(rawPeriod)||
    (line.period!=null&&Number(line.period)!==rawPeriod))return null;
 const frozen={
  market_name:saved.providerMarketName,
  outcome_name:saved.providerOutcomeName,
  outcome_key:saved.providerOutcomeKey,
  line:String(saved.line??''),period:rawPeriod,
  accepted_contract:saved
 };
 const contract=parseHalfCombination(frozen,{
  home:saved.homeTeamName??result?.home_team,
  away:saved.awayTeamName??result?.away_team
 });
 if(contract) return gradeHalfCombination(contract,result);

 const m = String(saved.providerMarketName ?? '').trim();
 const key = String(saved.providerOutcomeKey ?? saved.providerOutcomeName ?? '').trim().toLowerCase();
 const home = scoreValue(result?.home_score);
 const away = scoreValue(result?.away_score);
 const hh = scoreValue(result?.half_home_score);
 const ha = scoreValue(result?.half_away_score);
 if (home === null || away === null) return null;

 if (/^goal[\s/]*no\s*goal$/i.test(m)) {
   const bothScored = home > 0 && away > 0;
   if (['yes', 'po', 'goal'].includes(key)) return bothScored ? 'WON' : 'LOST';
   if (['no', 'jo', 'no goal'].includes(key)) return !bothScored ? 'WON' : 'LOST';
   return null;
 }

 if (/^(?:european\s+)?handicap$/i.test(m)) {
   const lineVal = num(saved.line);
   const uk = key.toUpperCase();
   if (lineVal !== null && Number.isInteger(lineVal) && ['1', 'X', '2', 'HOME', 'DRAW', 'AWAY'].includes(uk)) {
     const adjustedHome = home + lineVal;
     if (uk === '1' || uk === 'HOME') return adjustedHome > away ? 'WON' : 'LOST';
     if (uk === 'X' || uk === 'DRAW') return adjustedHome === away ? 'WON' : 'LOST';
     if (uk === '2' || uk === 'AWAY') return adjustedHome < away ? 'WON' : 'LOST';
   }
   return null;
 }

 if (/^2nd\s+half\s*-\s*3[\s-]*way$/i.test(m)) {
   if (hh === null || ha === null) return null;
   const h2 = home - hh, a2 = away - ha;
   const uk = key.toUpperCase();
   if (uk === '1') return h2 > a2 ? 'WON' : 'LOST';
   if (uk === 'X') return h2 === a2 ? 'WON' : 'LOST';
   if (uk === '2') return a2 > h2 ? 'WON' : 'LOST';
   return null;
 }

 if (/^any\s+team\s+to\s+win$/i.test(m)) {
   const someoneWon = home !== away;
   if (['yes', 'po'].includes(key)) return someoneWon ? 'WON' : 'LOST';
   if (['no', 'jo'].includes(key)) return !someoneWon ? 'WON' : 'LOST';
   return null;
 }

 if(isHalftimeRestMarket(m)){
  return gradeHalftimeRest({...line,market_name:m,
    outcome_name:saved.providerOutcomeName,outcome_key:saved.providerOutcomeKey,
    accepted_contract:saved},result);
 }

 if (/^who\s+wins\s+the\s+rest\s+of\s+the\s+match\?$/i.test(m)) {
   const snap = saved.acceptedLiveSnapshot;
   let baseHome = snap?.scoreHome ?? snap?.counters?.goal?.home;
   let baseAway = snap?.scoreAway ?? snap?.counters?.goal?.away;
   if (baseHome == null || baseAway == null) {
     const p3 = saved.nativeParameters?.p3;
     if (typeof p3 === 'string' && p3.includes(':')) {
       const parts = p3.split(':').map(Number);
       if (Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
         baseHome = parts[0];
         baseAway = parts[1];
       }
     }
   }
   if (baseHome == null || baseAway == null) return null;
   const deltaHome = home - baseHome, deltaAway = away - baseAway;
   if (deltaHome < 0 || deltaAway < 0) return null;
   const uk = key.toUpperCase();
   if (uk === '1') return deltaHome > deltaAway ? 'WON' : 'LOST';
   if (uk === 'X') return deltaHome === deltaAway ? 'WON' : 'LOST';
   if (uk === '2') return deltaAway > deltaHome ? 'WON' : 'LOST';
   return null;
 }

 if (/^home\s+team\s+to\s+score\s+2nd\s+half$/i.test(m)) {
   if (hh === null) return null;
   const scored = (home - hh) > 0;
   if (['yes', 'po'].includes(key)) return scored ? 'WON' : 'LOST';
   if (['no', 'jo'].includes(key)) return !scored ? 'WON' : 'LOST';
   return null;
 }

 if (/^away\s+team\s+to\s+score\s+2nd\s+half$/i.test(m)) {
   if (ha === null) return null;
   const scored = (away - ha) > 0;
   if (['yes', 'po'].includes(key)) return scored ? 'WON' : 'LOST';
   if (['no', 'jo'].includes(key)) return !scored ? 'WON' : 'LOST';
   return null;
 }

 const h2 = (hh !== null) ? home - hh : null;
 const a2 = (ha !== null) ? away - ha : null;
 const total = home + away;
 const total1h = (hh !== null && ha !== null) ? hh + ha : null;
 const total2h = (h2 !== null && a2 !== null) ? h2 + a2 : null;
 const lineVal = num(saved.line);

 if (/^home\s+team\s+wins\s+both\s+halves$/i.test(m)) {
   if (hh === null || ha === null || h2 === null || a2 === null) return null;
   const won = (hh > ha) && (h2 > a2);
   if (['yes', 'po'].includes(key)) return won ? 'WON' : 'LOST';
   if (['no', 'jo'].includes(key)) return !won ? 'WON' : 'LOST';
   return null;
 }
 if (/^away\s+team\s+wins\s+both\s+halves$/i.test(m)) {
   if (hh === null || ha === null || h2 === null || a2 === null) return null;
   const won = (ha > hh) && (a2 > h2);
   if (['yes', 'po'].includes(key)) return won ? 'WON' : 'LOST';
   if (['no', 'jo'].includes(key)) return !won ? 'WON' : 'LOST';
   return null;
 }

 if (/^home\s+team\s+wins\s+any\s+of\s+the\s+halves$/i.test(m)) {
   if (hh === null || ha === null || h2 === null || a2 === null) return null;
   const won = (hh > ha) || (h2 > a2);
   if (['yes', 'po'].includes(key)) return won ? 'WON' : 'LOST';
   if (['no', 'jo'].includes(key)) return !won ? 'WON' : 'LOST';
   return null;
 }
 if (/^away\s+team\s+wins\s+any\s+of\s+the\s+halves$/i.test(m)) {
   if (hh === null || ha === null || h2 === null || a2 === null) return null;
   const won = (ha > hh) || (a2 > h2);
   if (['yes', 'po'].includes(key)) return won ? 'WON' : 'LOST';
   if (['no', 'jo'].includes(key)) return !won ? 'WON' : 'LOST';
   return null;
 }

 if (/^home\s+team\s+wins\s+to\s+nil$/i.test(m)) {
   const won = (home > away) && (away === 0);
   if (['yes', 'po'].includes(key)) return won ? 'WON' : 'LOST';
   if (['no', 'jo'].includes(key)) return !won ? 'WON' : 'LOST';
   return null;
 }
 if (/^away\s+team\s+wins\s+to\s+nil$/i.test(m)) {
   const won = (away > home) && (home === 0);
   if (['yes', 'po'].includes(key)) return won ? 'WON' : 'LOST';
   if (['no', 'jo'].includes(key)) return !won ? 'WON' : 'LOST';
   return null;
 }

 if (/^both\s+half\s+goals\s+over\s+1\.5$/i.test(m)) {
   if (total1h === null || total2h === null) return null;
   const won = (total1h > 1.5) && (total2h > 1.5);
   if (['yes', 'po'].includes(key)) return won ? 'WON' : 'LOST';
   if (['no', 'jo'].includes(key)) return !won ? 'WON' : 'LOST';
   return null;
 }
 if (/^both\s+half\s+goals\s+under\s+1\.5$/i.test(m)) {
   if (total1h === null || total2h === null) return null;
   const won = (total1h < 1.5) && (total2h < 1.5);
   if (['yes', 'po'].includes(key)) return won ? 'WON' : 'LOST';
   if (['no', 'jo'].includes(key)) return !won ? 'WON' : 'LOST';
   return null;
 }

 if (/^1st\s*\/\s*2nd\s+half\s+both\s+teams?\s+to\s+score$/i.test(m)) {
   if (hh === null || ha === null || h2 === null || a2 === null) return null;
   const b1 = hh > 0 && ha > 0;
   const b2 = h2 > 0 && a2 > 0;
   const pair = `${b1 ? 'yes' : 'no'} / ${b2 ? 'yes' : 'no'}`;
   const cleanOutcome = String(saved.providerOutcomeName ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
   return cleanOutcome === pair ? 'WON' : 'LOST';
 }

 if (/^draw\s+or\s+total\s+goals\s+over$/i.test(m)) {
   if (lineVal === null) return null;
   const won = (home === away) || (total > lineVal);
   if (['yes', 'po'].includes(key)) return won ? 'WON' : 'LOST';
   if (['no', 'jo'].includes(key)) return !won ? 'WON' : 'LOST';
   return null;
 }
 if (/^draw\s+or\s+total\s+goals\s+under$/i.test(m)) {
   if (lineVal === null) return null;
   const won = (home === away) || (total < lineVal);
   if (['yes', 'po'].includes(key)) return won ? 'WON' : 'LOST';
   if (['no', 'jo'].includes(key)) return !won ? 'WON' : 'LOST';
   return null;
 }

 if (/^home\s*team\s+win(?:s)?\s+or\s+total\s+over$/i.test(m)) {
   if (lineVal === null) return null;
   const won = (home > away) || (total > lineVal);
   if (['yes', 'po'].includes(key)) return won ? 'WON' : 'LOST';
   if (['no', 'jo'].includes(key)) return !won ? 'WON' : 'LOST';
   return null;
 }
 if (/^home\s*team\s+win(?:s)?\s+or\s+total\s+under$/i.test(m)) {
   if (lineVal === null) return null;
   const won = (home > away) || (total < lineVal);
   if (['yes', 'po'].includes(key)) return won ? 'WON' : 'LOST';
   if (['no', 'jo'].includes(key)) return !won ? 'WON' : 'LOST';
   return null;
 }
 if (/^away\s*team\s+win(?:s)?\s+or\s+total\s+over$/i.test(m)) {
   if (lineVal === null) return null;
   const won = (away > home) || (total > lineVal);
   if (['yes', 'po'].includes(key)) return won ? 'WON' : 'LOST';
   if (['no', 'jo'].includes(key)) return !won ? 'WON' : 'LOST';
   return null;
 }
 if (/^away\s*team\s+win(?:s)?\s+or\s+total\s+under$/i.test(m)) {
   if (lineVal === null) return null;
   const won = (away > home) || (total < lineVal);
   if (['yes', 'po'].includes(key)) return won ? 'WON' : 'LOST';
   if (['no', 'jo'].includes(key)) return !won ? 'WON' : 'LOST';
   return null;
 }

 if (/^home\s*team\s+to\s+win$/i.test(m)) {
   const won = home > away;
   if (['yes', 'po'].includes(key)) return won ? 'WON' : 'LOST';
   if (['no', 'jo'].includes(key)) return !won ? 'WON' : 'LOST';
   return null;
 }
 if (/^away\s*team\s+to\s+win$/i.test(m)) {
   const won = away > home;
   if (['yes', 'po'].includes(key)) return won ? 'WON' : 'LOST';
   if (['no', 'jo'].includes(key)) return !won ? 'WON' : 'LOST';
   return null;
 }

 if (/^last\s+team\s+to\s+score$/i.test(m)) {
   let last = null;
   if (home === 0 && away === 0) last = 'none';
   else if (home > 0 && away === 0) last = 'home';
   else if (home === 0 && away > 0) last = 'away';
   else if (result?.last_team_to_score) last = result.last_team_to_score;
   if (!last) return null;
   if (last === 'home') return (key === '1' || key === 'home') ? 'WON' : 'LOST';
   if (last === 'away') return (key === '2' || key === 'away') ? 'WON' : 'LOST';
   if (last === 'none') return (key === 'none' || key === 'no goal') ? 'WON' : 'LOST';
   return null;
 }

 if (/^(?:1st\s+half\s*-\s*)?first\s+team\s+to\s+score$/i.test(m)) {
   const is1H = /1st\s+half/i.test(m);
   const targetH = is1H ? hh : home;
   const targetA = is1H ? ha : away;
   if (targetH === null || targetA === null) return null;
   let first = null;
   if (targetH === 0 && targetA === 0) first = 'none';
   else if (targetH > 0 && targetA === 0) first = 'home';
   else if (targetH === 0 && targetA > 0) first = 'away';
   else if (!is1H && result?.first_team_to_score) first = result.first_team_to_score;
   if (!first) return null;
   if (first === 'home') return (key === '1' || key === 'home') ? 'WON' : 'LOST';
   if (first === 'away') return (key === '2' || key === 'away') ? 'WON' : 'LOST';
   if (first === 'none') return (key === 'none' || key === 'no goal') ? 'WON' : 'LOST';
   return null;
 }

 // "Will there be a tie"
 if (/^will\s+there\s+be\s+a\s+tie$/i.test(m)) {
   const isDraw = home === away;
   if (['yes', 'po'].includes(key)) return isDraw ? 'WON' : 'LOST';
   if (['no', 'jo'].includes(key)) return !isDraw ? 'WON' : 'LOST';
   return null;
 }

 // "Hometeam/Awayteam no bet" (DNB)
 if (/^(?:home|away)\s*team\s+no\s+bet$/i.test(m)) {
   const pickedHome = /^home/i.test(m);
   if (home === away) return 'WON';
   return (home > away) === pickedHome ? 'WON' : 'LOST';
 }

 // Winning margin
 if (/(?:^|\s)winning\s+margins?/i.test(m)) {
   const wm_margin = Math.abs(home - away);
   const wm_winner = home > away ? 'home' : away > home ? 'away' : 'draw';
   if (/^(?:draw|tie|0)$/.test(key)) return wm_winner === 'draw' ? 'WON' : 'LOST';
   const wm_plus = key.match(/^(\d+)\+$/);
   if (wm_plus) return wm_winner !== 'draw' && wm_margin >= Number(wm_plus[1]) ? 'WON' : 'LOST';
   const wm_plain = key.match(/^(\d+)$/);
   if (wm_plain) return wm_margin === Number(wm_plain[1]) ? 'WON' : 'LOST';
   return null;
 }

 // "Hometeam/Awayteam not to lose & total over/under"
 if (/^(?:home|away)team\s+not\s+to\s+lose\s*&\s*total\s+(?:over|under)$/i.test(m)) {
   const ntl_isHome = /^home/i.test(m);
   const ntl_isOver = /over$/i.test(m);
   const ntl_notLost = ntl_isHome ? home >= away : away >= home;
   if (lineVal === null) return null;
   if (total === lineVal) return 'LOST';
   const ntl_totalWins = ntl_isOver ? total > lineVal : total < lineVal;
   return ntl_notLost && ntl_totalWins ? 'WON' : 'LOST';
 }

 // "Both teams to score and total over/under"
 if (/^both\s+teams?\s+to\s+score\s+and\s+[Тт]?otal\s+(?:over|under)$/i.test(m)) {
   const bt_isOver = /over$/i.test(m);
   const bt_btts = home > 0 && away > 0;
   if (lineVal === null) return null;
   if (total === lineVal) return 'LOST';
   const bt_totalWins = bt_isOver ? total > lineVal : total < lineVal;
   return bt_btts && bt_totalWins ? 'WON' : 'LOST';
 }

 // "Winner & total" / "goal & result"
 if (/^winner\s*&\s*total$/i.test(m) || /goal\s*&\s*result$/i.test(m)) {
   const wt_parts = String(saved.providerOutcomeName ?? '').trim().match(/^(.+?)\s+and\s+(.+)$/i);
   if (!wt_parts) return null;
   const wt_res = wt_parts[1].toLowerCase().trim();
   const wt_tot = wt_parts[2].toLowerCase().trim();
   let wt_resWins;
   if (/^(?:1|home|home win)$/.test(wt_res)) wt_resWins = home > away;
   else if (/^(?:x|draw|tie)$/.test(wt_res)) wt_resWins = home === away;
   else if (/^(?:2|away|away win)$/.test(wt_res)) wt_resWins = away > home;
   else return null;
   const wt_tMatch = wt_tot.match(/^(over|under)\s*(\d+(?:[.,]\d+)?)$/);
   if (!wt_tMatch) return null;
   const wt_line = Number(wt_tMatch[2].replace(',', '.'));
   if (total === wt_line) return 'LOST';
   const wt_totalWins = wt_tMatch[1] === 'over' ? total > wt_line : total < wt_line;
   return wt_resWins && wt_totalWins ? 'WON' : 'LOST';
 }

 // Full-match aggregate corner counters and exact fixture-name final-result
 // markets do not need an event chronology. They are safe only after the
 // immutable ZIZOBET quote identity and fixture names above have matched.

 const frozenFinalLine={...line,market_name:m,outcome_name:saved.providerOutcomeName,
  outcome_key:saved.providerOutcomeKey,line:String(saved.line??''),period:rawPeriod,
  accepted_contract:saved};

 // Winning Method: single-leg cup/knockout match only.
 if(/^winning\s+method$/i.test(m))return gradeWinningMethod(frozenFinalLine,result);

 // Who advances to next round / to qualify
 if(isQualificationMarket(m))return gradeQualification(frozenFinalLine,result);

 // Named-team period goal totals (1st half - TeamName total, 2nd half - TeamName total)
 if(isPeriodGoalTotal(frozenFinalLine)){
  const pgContract=parsePeriodGoalTotal(frozenFinalLine,{
   home:saved.homeTeamName??result?.home_team,
   away:saved.awayTeamName??result?.away_team
  });
  if(pgContract)return gradePeriodGoalTotal(pgContract,result);
 }

 // Scoring props: clean sheets, team-score-half etc.
 if(isScoringPropMarket(frozenFinalLine))return gradeScoringPropMarket(frozenFinalLine,result);

 // Multiscores "Other home/away win" depends on the immutable native outcome
 // grid stored at acceptance. Do not discard that grid after identity checks.
 if(isMultiscoresMarket(m))return gradeMultiscores(frozenFinalLine,result);
 const cornerStatus=gradeFinalTeamCornerMarket(frozenFinalLine,result);
 if(cornerStatus!==undefined)return cornerStatus;
 const namedStatus=gradeNamedFinalTeamMarket(frozenFinalLine,result);
 if(namedStatus!==undefined)return namedStatus;

 // A held native quote may still be covered by an existing, exact
 // settlement rule added after the ticket was accepted. Only delegate after
 // the immutable ZIZOBET market/outcome/line/period snapshot above has matched.
 // The normal evidence gate rejects unknown composites, missing HT/stat facts,
 // ambiguous team totals and event markets without their frozen event contract.
 const ordinaryLine={...line,accepted_contract:undefined,period:rawPeriod};
 if(hasRequiredSettlementEvidence(ordinaryLine,result)){
  const status=gradeLine(ordinaryLine,result);
  if(['WON','LOST','VOID'].includes(status))return status;
 }
 return null;
}
const REMAINING_TIMED_KINDS = new Set([
  'window', 'window-total', 'interval-leader', 'interval-result',
  'interval-handicap', 'window-first-event', 'window-parity',
]);

/** Re-derive an immutable Zizobet event contract for previously held lines. */
function recoverHeldZizobetEventContract(line, result) {
  const saved = line?.accepted_contract;
  const reason = String(saved?.settlementHold ?? '');
  if (!['NATIVE_FINAL_RULE_UNMAPPED', 'NATIVE_PARAMETERS_UNMAPPED', 'NATIVE_CONTRACT_REVIEW'].includes(reason)) return null;
  if (String(saved?.sourceProviderId ?? '').toUpperCase() !== 'ZIZOBET') return null;
  const eq = (a, b) => String(a ?? '') === String(b ?? '');
  if (!saved.providerMarketName || !saved.providerOutcomeName ||
      !eq(saved.providerMarketName, line.market_name) ||
      !eq(saved.providerOutcomeName, line.outcome_name) ||
      !eq(saved.providerMarketKey, line.market_key) ||
      !eq(saved.providerOutcomeKey, line.outcome_key) ||
      !eq(saved.line, line.line)) return null;
  const homeTeam = saved.homeTeamName ?? line?.home_team ?? result?.home_team ?? null;
  const awayTeam = saved.awayTeamName ?? line?.away_team ?? result?.away_team ?? null;
  let resolved = null;
  try {
    resolved = nativeZizobetContractRow({
      provider_id: 'ZIZOBET',
      native_market_name: saved.nativeMarketName ?? saved.providerMarketName ?? line.market_name,
      market_key: saved.providerMarketKey ?? line.market_key,
      native_market_id: saved.nativeMarketId ?? null,
      native_parameters: saved.nativeParameters ?? null,
      line: saved.line ?? line.line ?? null,
      homeTeamName: homeTeam,
      awayTeamName: awayTeam,
    });
  } catch { return null; }
  if (!resolved?.market_name) return null;
  const snap = saved.acceptedLiveSnapshot ?? {};
  const counts = snap.counters ?? {};
  let contract = null;
  try {
    contract = liveContract({
      ...line,
      market_name: resolved.market_name,
      outcome_name: saved.nativeOutcomeName ?? saved.providerOutcomeName ?? line.outcome_name,
      outcome_key: saved.providerOutcomeKey ?? line.outcome_key,
      line: String(saved.line ?? line.line ?? ''),
      period: line.period ?? saved.providerPeriod ?? 0,
    }, { counts, teams: { home: homeTeam, away: awayTeam } });
  } catch { return null; }
  if (!contract || !SUPPORTED_FACT_KINDS.has(contract.kind)) return null;
  const isRelative = ['lead-up', 'half-next-event'].includes(contract.kind) ||
    (contract.kind === 'sequence' && /\bnext\b/i.test(resolved.market_name));
  if (snap.isLive && isRelative && contract.baseline == null) return null;
  if (!snap.isLive || !REMAINING_TIMED_KINDS.has(contract.kind)) return contract;
  const clockMin = snap.clockMilliseconds == null ? null : Number(snap.clockMilliseconds) / 60000;
  const atMs = Date.parse(snap.capturedAt ?? '');
  const stampMs = Date.parse(snap.clockObservedAt ?? '');
  const freshClock = Number.isFinite(clockMin) && clockMin >= 0 &&
    Number.isFinite(atMs) && Number.isFinite(stampMs) &&
    stampMs <= atMs + 5000 && atMs - stampMs <= 45000;
  if (freshClock && Number.isFinite(contract.from) && clockMin < contract.from) return contract;
  const c = counts?.[contract.event];
  if (!freshClock || c?.home == null || c?.away == null) return null;
  return {
    ...contract,
    entryBaseline: { home: Number(c.home), away: Number(c.away) },
    entryClockMinute: clockMin,
    entryObservedAt: snap.capturedAt,
  };
}

/** Keyset round-robin for PENDING work, not OFFSET (which shifts as tickets
 * settle). An old unresolved line must not monopolize every short pass.
 * The UUID primary key gives a deterministic total order across restarts.
 */
export function createPendingLineScanner(){
 let after=null;
 return async function scan(execute,selectPrefix,cap){
  const select=cursor=>execute(selectPrefix+
   ' and ($1::uuid is null or l.id>$1::uuid) order by l.id limit $2',
   [cursor,cap]);
  let rows=(await select(after)).rows;
  if(!rows.length&&after!==null){
   after=null;
   rows=(await select(null)).rows;
  }
  after=rows.length?rows[rows.length-1].id:null;
  return rows;
 };
}
const nextHalfTimeLines=createPendingLineScanner();
const nextPrimaryEventLines=createPendingLineScanner();


/** accents/spaces removed so "Südtirol" == "sudtirol" and team names compare safely */
const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');

/** which family a market belongs to, from the name we stored with the line */
export function classify(marketName = '') {
  if (isFirstHalfResultBtts(marketName)) return 'HALF_RESULT_BTTS';
  if (isDcBttsMarket(marketName)) return 'DC_BTTS';
  if (isDcHalfBttsMarket(marketName)) return 'DC_HALF_BTTS';
  if (isHtFtComboMarket(marketName)) return 'HTFT_COMBO';
  if (isWinnerTotalMarket(marketName)) return 'WINNER_TOTAL';
  if (isTeamNotToLoseTotalMarket(marketName)) return 'TEAM_NOT_TO_LOSE_TOTAL';
  if (isBttsTotalAndMarket(marketName)) return 'BTTS_TOTAL_AND';
  if (isResultTotalMarket(marketName)) return 'RESULT_TOTAL';
  if (isTotalBttsMarket(marketName)) return 'TOTAL_BTTS';
  if (isResultBttsMarket(marketName)) return 'RESULT_BTTS';
  if (/^which team to score$/i.test(String(marketName).trim())) return 'WHICH_TEAM_TO_SCORE';
  if (isWinningMarginMarket({market_name:marketName})) return 'WINNING_MARGIN';
  if (isMultiscoresMarket(marketName)) return 'MULTISCORES';
  if (isMatchbetFirstGoalMarket(marketName)) return 'MATCHBET_FIRST_GOAL';
  if (isQualificationMarket(marketName)) return 'TO_QUALIFY';
  if (/\b(?:win|wins|draw)\s+or\s+(?:both\s+teams?\s+(?:to\s+)?score|total\s+(?:goals?\s+)?(?:over|under))\b/i.test(marketName)) return 'CHANCE_MIX';
  const s = String(marketName).toLowerCase();
  if (isHtFtMarket(marketName)) return 'HT_FT';
  if (/\b(?:offside|offsides|woodwork|throw|throws|throw-ins?|saves?|tackles?|free\s*kicks?|goal\s*kicks?)\b/i.test(s)) return 'OTHER';
  // Bare 3way is a normal 1X2 market. Full Time 1UP/2UP/3UP are
  // early-lead contracts and must never fall through to ordinary FT grading.
  if (/^full[\s.-]*time[\s:.-]*(?:1up|2up|3up)$/i.test(s.trim())) return '1X2';
  if (/^3[\s-]*way$/i.test(s.trim())) return '1X2';
  if (/correct score|exact score/i.test(s)) return 'CORRECT_SCORE';
  if (/^\s*(?:half\s*time|halftime)\s*[-:.]?\s*(?:3[\s-]*way|1x2)\s*$/i.test(s))return '1X2';
  if (/odd[\s/]*even|tek[\s/]*cift/i.test(s)) return 'ODD_EVEN';
  if (/draw no bet|\bdnb\b/i.test(s)) return 'DNB';
  if (/^(?:home|away)team\s+no\s+bet\s*$/i.test(s.trim())) return 'DNB';
  if (/^(?:home|away)\s+team\s+no\s+bet\s*$/i.test(s.trim())) return 'DNB';
  if (/clean sheet/i.test(s)) return 'CLEAN_SHEET';
  if (/total goals?\s*\(?(?:exact|bands)\)?|exact goals|multigoals|number of goals|exact corners|(?:(?:home|away)(?:\s*team)?\s+|(?:home|away)team\s+)?corners?\s*range|corners?\s*\(?(?:exact|bands|aggregated)\)?|total corners?\s*\(?(?:exact|bands|aggregated)\)?/i.test(s)) return 'BANDS_EXACT';
  if (/corner.*(?:result|winner|1x2)|(?:result|winner|1x2).*corner|^(?:most|more)\s+corners?$|^(?:(?:1st|first|2nd|second)\s+half\s*[-–.:]?\s*)?corner\s*bet$/i.test(s.trim())) return 'CORNER_1X2';
  if (/corner/.test(s)) return 'CORNERS';
  if (/\bcards?\b|booking|yellow|red/.test(s)) return 'CARDS';
  if (/both teams to score|\bbtts\b|goal[\s/]*no\s*goal|gol[\s/]*pa\s*gol/i.test(s)) return 'BTTS';
  if ((isFirstHalfLine(s) || isSecondHalfLine(s)) && /\b(?:result|winner|1x2|3[\s-]*way)\b/.test(s)) return '1X2';
  if (/^any team to win$/i.test(s.trim())) return 'ANY_TEAM_WIN';
  if (/^will\s+there\s+be\s+a\s+tie\s*$/i.test(s.trim())) return 'WILL_TIE';
  if (/(?:who|which team)\s+wins?\s+the\s+rest/i.test(s)||
      /rest\s+of\s+the\s+(?:match|half)/i.test(s)||
      /halftime\s*-?\s*who\s+wins\s+the\s+rest/i.test(s)) return 'REST_OF_MATCH';
  if (/^(?:home|away)\s+team\s+to\s+score\s+(?:in\s+)?2nd\s+half$/i.test(s.trim())) return 'TEAM_TO_SCORE_2ND_HALF';
  if (/^(?:home|away)\s*(?:team\s+)?to\s+win\s*$/i.test(s.trim())) return '1X2';
  if (/double chance/.test(s)) return 'DC';
  if (/handicap|fora|asian/.test(s)) return 'HANDICAP';
  if (/final result|full time result|1 ?x ?2|match result|winner|moneyline/.test(s)) return '1X2';
  if (/^(?:next goal|next goal \S+|1st half\s*-?\s*next goal \S+)$/i.test(s.trim())) return 'REST_OF_MATCH';
  if (/total|over\/?under|over\s*\/\s*(?:exact(?:ly)?\s*\/\s*)?under|goals/.test(s)) return 'TOTAL';
  return 'OTHER';
}

const num = (v) => (v != null && v !== '' && Number.isFinite(Number(String(v).replace(',', '.'))) ? Number(String(v).replace(',', '.')) : null);
const isFirstHalfLine = (marketName = '') =>
  /\b(?:first|1st)\s*half\b|\b1h\b|\bhalf.?time\b|^ht(?:\s|$)/i.test(marketName) &&
  !/half\s*time\s*[\/\-]?\s*full\s*time|\bht\s*[\/\-]?\s*ft\b/i.test(marketName) &&
  !/\bwho\s+wins\s+the\s+rest\b|\brest\s+of\b/i.test(marketName);
const isSecondHalfLine = (marketName = '') =>
  /\b(?:second|2nd)\s*half\b|\b2h\b/i.test(marketName);
/** The provider's period field is part of the quoted contract. A generic
 * "1X2", "BTTS" or "Exact Corners" name must not silently use full-time
 * totals when its period is 1H/2H.
 */
export function scorePeriodOf(line={}) {
 const market=String(line.market_name??line.marketName??'');
 const raw=line.period??line.accepted_contract?.providerPeriod??0,period=Number(raw);
 if(!Number.isInteger(period)||![0,1,2].includes(period))return null;
 const first=isFirstHalfLine(market),second=isSecondHalfLine(market);
 if(first&&second||first&&period===2||second&&period===1)return null;
 return first?1:second?2:period;
}
const withFrozenPeriod=line=>{
 if(!line||line.period!=null)return line;
 const raw=line.accepted_contract?.providerPeriod;
 const n=raw==null?null:Number(raw);
 return n!=null&&Number.isInteger(n)&&[0,1,2].includes(n)?
  {...line,period:n}:line;
};
const plainDnb=name=>/^(?:(?:full[ .-]*time|match|(?:first|1st|second|2nd)\s+half)\s*[.:-]?\s*)?(?:draw\s+no\s+bet|dnb)(?:\s+(?:first|1st|second|2nd)\s+half)?$/i
 .test(String(name??'').trim());
const scoreValue=v=>v!=null&&v!==''&&Number.isSafeInteger(Number(v))&&
  Number(v)>=0&&Number(v)<=200?Number(v):null;
const normalizedTeamLabel=value=>String(value??'').normalize('NFD')
 .replace(/[\u0300-\u036f]/g,'').toLowerCase()
 .replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();

/** Full-time team corner counts are final Zizobet result facts, not event-order
 * facts. Grade only the explicit full-match team count grammar; interval,
 * race, first/next and half markets never enter this path.
 */
function gradeFinalTeamCornerMarket(line,result){
 const period=Number(line?.period??line?.accepted_contract?.providerPeriod??0);
 if(period!==0)return undefined;
 const contract=parseTeamCountMarket({...line,period:0});
 if(!contract||contract.event!=='corner')return undefined;
 const source=String(result?.source??'').toUpperCase();
 if(source&&!['ZIZOBET','ADMIN','FEED'].includes(source))return null;
 const home=scoreValue(result?.corners_home),away=scoreValue(result?.corners_away);
 const count=contract.side==='home'?home:contract.side==='away'?away:null;
 if(count===null)return null;
 const decide=value=>value?'WON':'LOST';
 if(contract.kind==='over'||contract.kind==='under'){
  const threshold=Number(contract.threshold);
  if(!Number.isFinite(threshold)||threshold<0||!Number.isInteger(threshold*2))return null;
  if(Number.isInteger(threshold)&&count===threshold)return 'VOID';
  return decide(contract.kind==='over'?count>threshold:count<threshold);
 }
 if(contract.kind==='exact')return decide(count===Number(contract.target));
 if(contract.kind==='range')return decide(count>=Number(contract.min)&&count<=Number(contract.max));
 if(contract.kind==='atLeast')return decide(count>=Number(contract.target));
 return null;
}

/** Match team-named final-result markets only against the exact fixture names
 * frozen on the accepted quote or present in the verified final result.
 */
function namedFinalTeamContract(line,result){
 const period=Number(line?.period??line?.accepted_contract?.providerPeriod??0);
 if(period!==0)return undefined;
 const rawTitle=String(line?.market_name??line?.accepted_contract?.providerMarketName??'').trim();
 const title=normalizedTeamLabel(rawTitle);
 // Generic Draw No Bet and Home/Away Team No Bet already have their own
 // standard DNB grader. Only a literal fixture-team prefix is a named offer.
 if(plainDnb(rawTitle)||/^(?:(?:home|away)(?:\s*team)?|hometeam|awayteam|any\s*team)\s+no\s+bet$/i.test(title)||/^any\s+team\s+to\s+win$/i.test(title))return undefined;
 const suffix=title.endsWith(' to win')?' to win':
  title.endsWith(' wins')?' wins':title.endsWith(' win')?' win':
  title.endsWith(' no bet')?' no bet':null;
 if(!suffix)return undefined;
 const prefix=title.slice(0,-suffix.length).trim();
 const homeName=normalizedTeamLabel(line?.accepted_contract?.homeTeamName??line?.home_team??result?.home_team);
 const awayName=normalizedTeamLabel(line?.accepted_contract?.awayTeamName??line?.away_team??result?.away_team);
 const isGenericHome=/^(?:home(?:\s+team)?|hometeam|team\s*1)$/.test(prefix);
 const isGenericAway=/^(?:away(?:\s+team)?|awayteam|team\s*2)$/.test(prefix);
 if(isGenericHome||isGenericAway){
  const choice=normalizedTeamLabel(line?.outcome_name??line?.outcome_key);
  if(['1','x','2','draw','tie'].includes(choice))return undefined;
 }
 const side=isGenericHome||(prefix&&homeName&&prefix===homeName)?'home':
  isGenericAway||(prefix&&awayName&&prefix===awayName)?'away':null;
 if(!side)return null;
 return {kind:suffix===' to win'?'team-win':'named-dnb',side,homeName,awayName};
}
function gradeNamedFinalTeamMarket(line,result){
 const contract=namedFinalTeamContract(line,result);
 if(contract===undefined)return undefined;
 if(!contract)return null;
 const home=scoreValue(result?.home_score),away=scoreValue(result?.away_score);
 if(home===null||away===null)return null;
 const homeWin=home>away,awayWin=away>home,draw=home===away;
 const choice=normalizedTeamLabel(line?.outcome_name??line?.outcome_key);
 const decide=value=>value?'WON':'LOST';
 if(contract.kind==='team-win'){
  if(choice==='yes'||choice==='po')return decide(contract.side==='home'?homeWin:awayWin);
  if(choice==='no'||choice==='jo')return decide(contract.side==='home'?!homeWin:!awayWin);
  return null;
 }
 // Native team-specific "no bet" offers sometimes expose 1/X/2 outcomes.
 // Treat those literal outcomes as the corresponding final match result;
 // a direct team-name/home/away pick retains standard DNB draw protection.
 if(choice==='x'||choice==='draw'||choice==='tie')return decide(draw);
 if(choice==='1')return decide(homeWin);
 if(choice==='2')return decide(awayWin);
 const selectedSide=choice==='home'||choice===contract.homeName?'home':
  choice==='away'||choice===contract.awayName?'away':null;
 if(!selectedSide)return null;
 if(draw)return 'WON';
 return decide(selectedSide==='home'?homeWin:awayWin);
}

/** "Halftime - Who wins the rest" is scoped to the remainder of the FIRST HALF.
 * Compare the frozen purchase-time score with the confirmed HT score. A
 * second-half goal must never reverse a first-half market.
 */
function isHalftimeRestMarket(value){
 return /^(?:half\s*time|halftime)\s*[-–.:]?\s*who\s+wins\s+the\s+rest\??$/i
  .test(String(value??'').trim());
}
function gradeHalftimeRest(line,result){
 const snapshot=line?.accepted_contract?.acceptedLiveSnapshot;
 if(!snapshot)return null;
 const baseHome=scoreValue(snapshot.scoreHome??snapshot.counters?.goal?.home);
 const baseAway=scoreValue(snapshot.scoreAway??snapshot.counters?.goal?.away);
 if(baseHome===null||baseAway===null)return null;
 const phase=String(snapshot.feedPhase??'').toLowerCase()
  .replace(/[^a-z0-9]+/g,' ').trim();
 const firstHalf=/^(?:1|1h|h1|1st|1st half|first half|firsthalf|period 1|period1)$/.test(phase);
 const laterPhase=/^(?:2|2h|h2|2nd|2nd half|second half|secondhalf|halftime|half time|ht|ft|full time|ended|finished)$/.test(phase);
 const clock=Number(snapshot.clockMilliseconds);
 const prematch=snapshot.isLive===false;
 if(prematch){
  if(baseHome!==0||baseAway!==0)return null;
 }else if(laterPhase||(!firstHalf&&(!Number.isFinite(clock)||clock>=45*60*1000)))return null;
 const endHome=scoreValue(result?.half_home_score);
 const endAway=scoreValue(result?.half_away_score);
 if(endHome===null||endAway===null)return null;
 const deltaHome=endHome-baseHome,deltaAway=endAway-baseAway;
 if(deltaHome<0||deltaAway<0)return null;
 const selections=[line?.outcome_key,line?.outcome_name]
  .map(value=>String(value??'').trim().toLowerCase());
 const homeName=normalizedTeamLabel(line?.home_team??line?.accepted_contract?.homeTeamName??result?.home_team);
 const awayName=normalizedTeamLabel(line?.away_team??line?.accepted_contract?.awayTeamName??result?.away_team);
 const decide=value=>value?'WON':'LOST';
 if(selections.some(value=>value==='1'||value==='home'||value.startsWith('home ')||
    homeName&&normalizedTeamLabel(value)===homeName))
  return decide(deltaHome>deltaAway);
 if(selections.some(value=>value==='x'||value==='draw'||value==='tie'))
  return decide(deltaHome===deltaAway);
 if(selections.some(value=>value==='2'||value==='away'||value.startsWith('away ')||
    awayName&&normalizedTeamLabel(value)===awayName))
  return decide(deltaAway>deltaHome);
 return null;
}

const periodScores=(line,result)=>{
 const period=scorePeriodOf(line);
 if(period===null)return null;
 const home=scoreValue(result?.home_score),away=scoreValue(result?.away_score);
 if(home===null||away===null)return null;
 if(period===0)return {home,away};
 const hh=scoreValue(result?.half_home_score),ha=scoreValue(result?.half_away_score);
 if(hh===null||ha===null||hh>home||ha>away)return null;
 return period===1?{home:hh,away:ha}:{home:home-hh,away:away-ha};
};


/** A known final score is not enough to grade first-half/corner/card props.
 * Keep those lines pending for more authoritative feed evidence instead of
 * inventing a win/loss or immediately refunding a valid winning proposition.
 */
export function hasRequiredSettlementEvidence(line, result) {
  // A native quote awaiting rule review must never be graded by a
  // coincidentally similar legacy market-name fallback.
  if(line?.accepted_contract?.settlementHold)
    return gradeHeldNativeCombo(line,result)!==null;
  line=withFrozenPeriod(line);
  if(/^full[\s.-]*time[\s:.-]*(?:1up|2up|3up)$/i.test(String(line.market_name??'').trim()))
    return hasRequiredSettlementEvidence({...line,market_name:'Full Time Result',live_contract:null},result);
  if (!result||scoreValue(result.home_score)===null||scoreValue(result.away_score)===null)return false;
  const cornerResult=gradeFinalTeamCornerMarket(line,result);
  if(cornerResult!==undefined)return ['WON','LOST','VOID'].includes(cornerResult);
  const namedResult=gradeNamedFinalTeamMarket(line,result);
  if(namedResult!==undefined)return ['WON','LOST','VOID'].includes(namedResult);
  if(!Array.isArray(line.builder_legs)&&unverifiedCompositeLine(line,result))return false;
  if(line.live_contract?.kind==='half-combo')
   return gradeHalfCombination(line.live_contract,result)!==null;
  // Explicit team/half propositions use only verified HT and FT scoreboards.
  // Do not send these through the old general event/total fallback.
  // Exact team/period goal quotes overlap the broad historical scoring
  // property recognizer. They must use their numerical HT/FT count rule.
  if(isHalfComboFamily(line))return gradeHalfCombination(parseHalfCombination(line,result),result)!==null;
  if(isWinningMarginMarket(line))return gradeWinningMargin(line,result)!==null;
  if(isDcHalfBttsMarket(String(line.market_name??'')))return gradeDcHalfBtts(line,result)!==null;
  if(isHtFtComboMarket(String(line.market_name??'')))return gradeHtFtCombo(line,result)!==null;
  if(isMultiscoresMarket(String(line.market_name??'')))return gradeMultiscores(line,result)!==null;
  if(isMatchbetFirstGoalMarket(String(line.market_name??'')))return gradeMatchbetFirstGoal(line,result)!==null;
  if(isQualificationMarket(String(line.market_name??'')))return gradeQualification(line,result)!==null;
  if(isPeriodGoalTotal(line))return gradePeriodGoalTotal(parsePeriodGoalTotal(line,result),result)!==null;
  if(isScoringPropMarket(line))return gradeScoringPropMarket(line,result)!==null;
  if(isHalfExactMarketFamily(line))return false; // FT counts are not 1H/2H corner/card facts
  if(isParityLikeMarket(line))return gradeParityMarket(line,result)!==null;
  if(isHandicapMarket(line))return legacyHandicapResult(line,result)!==null;
  // A final aggregate card count cannot tell red from yellow cards.
  if(/\b(?:yellow|red)\s+cards?\b/i.test(String(line?.market_name??'')))return false;
  // Zizobet is the declared settlement authority. A missing secondary-provider
  // comparison must not hold a verified Zizobet final corner/statistics result
  // in PENDING; secondary feeds are enrichment only, not payout vetoes.
  if(String(result?.source??'').toUpperCase()!=='ZIZOBET'&&statisticsNeedReview(line,result))return false;
  if (Array.isArray(line.builder_legs)) return line.builder_legs.every(leg => hasRequiredSettlementEvidence(leg, result));
  if (needsEvents(line)) return ['WON','LOST','VOID'].includes(gradeEventLine(line,result));
  if (isStatisticMarket(line)) return hasStatisticEvidence(line,result);
  const marketName = String(line.market_name ?? '');
  const period=scorePeriodOf(line);
  if(period===null||!periodScores(line,result))return false;
  // HT/FT is a combined proposition. A separate 1H/2H period field would
  // change its meaning and must not be guessed.
  if(period!==0&&isHtFtMarket(marketName))return false;
  // Period-specific corners/cards/fouls/shots require period-specific facts;
  // neither a final match total nor a final half-time GOAL score proves them.
  if(period!==0&&/\b(?:corners?|cards?|bookings?|fouls?|shots?|players?|kornera?|karton|faulle?)\b/i.test(marketName))
   return false;
  if (isSecondHalfLine(marketName)) {
    // The 2H goals are FT minus the verified HT score. Never use this
    // subtraction for 2H corners/cards/players, which need period evidence.
    if (/\b(?:corners?|cards?|bookings?|fouls?|shots?|players?)\b/i.test(marketName)) return false;
    const h=Number(result.home_score)-Number(result.half_home_score);
    const a=Number(result.away_score)-Number(result.half_away_score);
    if (!Number.isSafeInteger(h)||h<0||!Number.isSafeInteger(a)||a<0) return false;
  }
  const family = goalTotalContract(line,result)?'TOTAL':classify(marketName);
  if(family==='DNB'&&!plainDnb(marketName))return false;

  if (family === 'REST_OF_MATCH') {
    if (/halftime\s*-?\s*who\s+wins\s+the\s+rest|\bhalftime\b.*\brest\b/i.test(marketName)) {
      if (scoreValue(result.half_home_score) == null || scoreValue(result.half_away_score) == null) return false;
    }
  }

  if (family === 'CORNER_1X2' && (result.corners_home == null || result.corners_away == null)) return false;
  if (family === 'HT_FT') {
    // 1/X and 2/X are fully decidable whenever verified HT and FT
    // scoreboards exist. A missing or contradictory scoreboard is not a loss.
    const option=parseHtFtOutcome(line.outcome_name,line.outcome_key);
    return gradeHtFt(option,result.half_home_score,result.half_away_score,
      result.home_score,result.away_score)!==null;
  }
  if (family === 'BANDS_EXACT') {
    const isCorner = /corner/i.test(marketName);
    // An unrecognized qualifier could be a real team name rather than the
    // words "Home team". Never grade "Inter Milan exact corners" from both
    // teams' combined corners, or a named player's exact goals as match goals.
    const base=marketName.toLowerCase().replace(/\bhometeam\b/g,'home team').replace(/\bawayteam\b/g,'away team').replace(/^(?:(?:full time|match)|(?:(?:1st|first) half))\s*[.:-]?\s*/,'').trim();
    const provenFamily=isCorner
      ?/^(?:(?:(?:home|away)\s+team\s+)?corners?\s*range|exact corners?|total corners?\s*\((?:exact|bands|aggregated)\)|corners?\s*\((?:exact|bands|aggregated)\))$/.test(base)
      :/^(?:exact goals?|multigoals|number of goals|total goals?\s*\((?:exact|bands)\))$/.test(base);
    if(!provenFamily)return false;
    if (isCorner && (result.corners_home == null || result.corners_away == null)) return false;
  }
  if (family === 'CORNERS') {
    const contract = cornerTotalContract(line, result);
    if (!contract) return false;
    if ((contract.scope !== 'away' && result.corners_home == null) ||
        (contract.scope !== 'home' && result.corners_away == null)) return false;
  }
  if (family === 'CARDS') {
    // Total match cards alone can use final home+away card counters. The old
    // generic path would incorrectly count BOTH teams for a team/half total.
    const scope=marketName.toLowerCase().replace(/\s+/g,' ').trim();
    if(Number(line?.period??0)!==0||
       !/^(?:(?:full time|match)\s+)?(?:total\s+)?cards?(?:\s+(?:total|over\s*\/?\s*under))?$/.test(scope))
      return false;
    if(result.cards_home == null||result.cards_away == null)return false;
  }
  // Early-payout promotions depend on event history, not only the final score.
  if (/early\s*payout/i.test(marketName)) return false;
  return true;
}

/**
 * 'WON' | 'LOST' | 'VOID' or null (insufficient evidence).
 * VOID is allowed only for a proved settlement-rule push/cancellation.
 */
export function gradeLine(line, result) {
  if(line?.accepted_contract?.settlementHold)
    return gradeHeldNativeCombo(line,result);
  const cornerResult=gradeFinalTeamCornerMarket(line,result);
  if(cornerResult!==undefined)return cornerResult;
  const namedResult=gradeNamedFinalTeamMarket(line,result);
  if(namedResult!==undefined)return namedResult;
  line=withFrozenPeriod(line);
  if(/^full[\s.-]*time[\s:.-]*(?:1up|2up|3up)$/i.test(String(line.market_name??'').trim()))
    return gradeLine({...line,market_name:'Full Time Result',live_contract:null},result);
  // Never score a two-condition native quote by matching only the first
  // recognized word. A provider-aligned unknown contract remains PENDING.
  if(!Array.isArray(line.builder_legs)&&unverifiedCompositeLine(line,result))return null;
  if(!Array.isArray(line.builder_legs)&&line.live_contract?.kind==='half-combo')
    return gradeHalfCombination(line.live_contract,result);
  if(!Array.isArray(line.builder_legs)&&isHalfExactMarketFamily(line))return null;
  if(!Array.isArray(line.builder_legs)&&isHandicapMarket(line))
    return legacyHandicapResult(line,result);
  if(!Array.isArray(line.builder_legs)&&isParityLikeMarket(line))
    return gradeParityMarket(line,result);
  if(!Array.isArray(line.builder_legs)&&isHalfComboFamily(line))
    return gradeHalfCombination(parseHalfCombination(line,result),result);
  if(!Array.isArray(line.builder_legs)&&isWinningMarginMarket(line))
    return gradeWinningMargin(line,result);
  if(!Array.isArray(line.builder_legs)&&isDcHalfBttsMarket(String(line.market_name??'')))
    return gradeDcHalfBtts(line,result);
  if(!Array.isArray(line.builder_legs)&&isHtFtComboMarket(String(line.market_name??'')))
    return gradeHtFtCombo(line,result);
  if(!Array.isArray(line.builder_legs)&&isMultiscoresMarket(String(line.market_name??'')))
    return gradeMultiscores(line,result);
  if(!Array.isArray(line.builder_legs)&&isMatchbetFirstGoalMarket(String(line.market_name??'')))
    return gradeMatchbetFirstGoal(line,result);
  if(!Array.isArray(line.builder_legs)&&isQualificationMarket(String(line.market_name??'')))
    return gradeQualification(line,result);
  if(!Array.isArray(line.builder_legs)&&isPeriodGoalTotal(line))
    return gradePeriodGoalTotal(parsePeriodGoalTotal(line,result),result);
  if(!Array.isArray(line.builder_legs)&&isScoringPropMarket(line))
    return gradeScoringPropMarket(line,result);
  if(needsEvents(line)&&!Array.isArray(line.builder_legs))return gradeEventLine(line,result)??null;
  if (line.builder_legs !== null && line.builder_legs !== undefined) {
    const legs = line.builder_legs;
    if (!Array.isArray(legs) || legs.length < 2 || legs.length > 5 || legs.some(l => l.builder_legs)) return null;
    const statuses = legs.map(leg => gradeLine(leg,result));
    if (statuses.includes('LOST')) return 'LOST';
    return statuses.every(s => s === 'WON') ? 'WON' : statuses.every(s => ['WON','VOID'].includes(s)) ? 'VOID' : null;
  }
  // 1H totals and BTTS cannot be graded from the full-time score. Their
  // original ticket contract is snapshotted in market_name.
  if (!hasRequiredSettlementEvidence(line, result)) return null;
  if (isStatisticMarket(line)) return gradeStatisticLine(line,result);
  const periodScore=periodScores(line,result);
  if(!periodScore)return null;
  const home=periodScore.home,away=periodScore.away;
  const totalGoals = home + away;
  const homeWin = home > away;
  const awayWin = away > home;
  const draw = home === away;
  const bothScored = home > 0 && away > 0;

  const key = String(line.outcome_key ?? '').toLowerCase().trim();
  const name = String(line.outcome_name ?? '').toLowerCase();
  const goalTotal=goalTotalContract(line,result);
  const cornerTotal=cornerTotalContract(line,result);
  const lineValue = num(line.line)??num(goalTotal?.line)??num(cornerTotal?.line);
  const type = goalTotal?'TOTAL':classify(line.market_name);

  const homeName = norm(result.home_team);
  const awayName = norm(result.away_team);
  // A shared team-name prefix cannot identify which side won. For example,
  // Manchester is not proof of Manchester City versus Manchester United.
  const isHomeName = (n) => !!n && !!homeName && homeName === n;
  const isAwayName = (n) => !!n && !!awayName && awayName === n;

  const decide = (yes) => (yes ? 'WON' : 'LOST');

  switch (type) {
    case 'HALF_RESULT_BTTS': {
      if (result.half_home_score == null || result.half_away_score == null) return null;
      const selection = parseResultBttsOutcome(line.outcome_key, result.home_team, result.away_team)
        ?? parseResultBttsOutcome(line.outcome_name, result.home_team, result.away_team);
      return gradeResultBtts(selection, result.half_home_score, result.half_away_score);
    }
    case 'RESULT_TOTAL':
    case 'TOTAL_BTTS': {
      const parse = type === 'RESULT_TOTAL' ? parseResultTotal : parseTotalBtts;
      const selection = parse(line.outcome_key, result.home_team, result.away_team)
        ?? parse(line.outcome_name, result.home_team, result.away_team);
      return gradeMixedTotal(line.market_name, selection, home, away);
    }
    case 'RESULT_BTTS': {
      const selection = parseResultBttsOutcome(line.outcome_key, result.home_team, result.away_team)
        ?? parseResultBttsOutcome(line.outcome_name, result.home_team, result.away_team);
      if (!selection) return null; // Never grade an unidentified combination as ordinary BTTS.
      return gradeResultBtts(selection, home, away);
    }
    case '1X2': {
      if (key === '1' || key === 'home' || /^home/.test(name)) return decide(homeWin);
      if (key === 'x' || key === 'draw' || /^draw|^tie/.test(name)) return decide(draw);
      if (key === '2' || key === 'away' || /^away/.test(name)) return decide(awayWin);
      if (isHomeName(norm(name))) return decide(homeWin);
      if (isAwayName(norm(name))) return decide(awayWin);
      return null;
    }

    case 'DC': {
      if (key === '1x' || key === 'homeordraw') return decide(homeWin || draw);
      if (key === '12' || key === 'homeoraway') return decide(homeWin || awayWin);
      if (key === 'x2' || key === 'draworaway') return decide(awayWin || draw);
      const flat = norm(name);
      if (/^1x|homeordraw/.test(flat)) return decide(homeWin || draw);
      if (/^12|homeoraway/.test(flat)) return decide(homeWin || awayWin);
      if (/^x2|draworaway/.test(flat)) return decide(awayWin || draw);
      return null;
    }

    case 'BTTS':
      if (key === 'yes' || key === 'goal' || /^yes|^po\b|^goal/i.test(name)) return decide(bothScored);
      if (key === 'no' || key === 'no goal' || /^no|^jo\b|^no\s*goal/i.test(name)) return decide(!bothScored);
      return null;

    case 'WHICH_TEAM_TO_SCORE': {
      const selection=norm(line.outcome_name??line.outcome_key??'');
      // norm() removes spaces and punctuation, so compare canonical tokens.
      if(/^(?:bothteams?|both|12)$/.test(selection))return decide(bothScored);
      if(/^(?:only1|home|hometeam|1)$/.test(selection))
        return decide(home>0&&away===0);
      if(/^(?:only2|away|awayteam|2)$/.test(selection))
        return decide(away>0&&home===0);
      if(/^(?:none|neither|noteam|nogoals?)$/.test(selection))
        return decide(home===0&&away===0);
      return null;
    }

    case 'TOTAL':
    case 'CORNERS':
    case 'CARDS': {
      let target = totalGoals;
      if(type==='TOTAL'&&goalTotal?.scope==='home')target=home;
      if(type==='TOTAL'&&goalTotal?.scope==='away')target=away;
      if (type === 'CORNERS') {
        if (!cornerTotal) return null;
        const h=num(result.corners_home),a=num(result.corners_away);
        if (cornerTotal.scope==='home' && h===null || cornerTotal.scope==='away' && a===null ||
            cornerTotal.scope==='total' && (h===null || a===null)) return null;
        target = cornerTotal.scope==='home'?h:cornerTotal.scope==='away'?a:h+a;
      }
      if (type === 'CARDS') {
        if (result.cards_home === null || result.cards_away === null) return null;
        target = Number(result.cards_home) + Number(result.cards_away);
      }
      if (lineValue === null || !Number.isFinite(target)) return null;
      // A TWO-WAY full-integer total (1.0, 2.0, 3.0...) pushes at
      // exactly that count. A three-way total sells an explicit exact-count
      // selection and MUST NOT be mistaken for the two-way push contract.
      const threeWay = /\b(?:3[\s-]*way|three[\s-]*way|3[\s-]*outcomes?|three[\s-]*outcomes?)\b/i.test(String(line.market_name ?? ''));
      const over = key === 'over' || /^over(?:\s|$)/.test(name);
      const under = key === 'under' || /^under(?:\s|$)/.test(name);
      if (over === under) {
        const exact = threeWay && (key === 'exact' || key === 'exactly' || key === 'equal' ||
          /^exact(?:ly)?(?:\s+\d+(?:[.,]\d+)?)?$/.test(name) ||
          name.trim() === String(lineValue));
        return exact ? decide(target === lineValue) : null;
      }
      if (!threeWay && Number.isInteger(lineValue) && target === lineValue) return 'VOID';
      return decide(over ? target > lineValue : target < lineValue);
    }

    case 'HANDICAP': {
      if (lineValue === null || !Number.isInteger(lineValue*2)) return null;
      // Asian quarter handicaps require split-stake settlement; never
      // mispay them as a simple win/loss or silently void the wager.
      const side = key === '1' || /^home/.test(name) || isHomeName(norm(name)) ? 'home' : key === '2' || /^away/.test(name) || isAwayName(norm(name)) ? 'away' : null;
      if (!side) return null;
      const adjusted = (side === 'home' ? home : away) + lineValue;
      const opponent = side === 'home' ? away : home;
      if (adjusted === opponent) return 'VOID'; // verified handicap push
      return decide(adjusted > opponent);
    }

    case 'CORRECT_SCORE': {
      // Rest-of-half: score from base at purchase to end of that half.
      // Rest-of-match: score from base at purchase to end of full time.
      const restHalf=String(line.market_name??'').match(/^(?:1st|first|2nd|second)\s+half\s*[-–:]\s*correct\s+score\s+rest\s+of\s+half\s*\(from\s*(\d{1,2})\s*:\s*(\d{1,2})\)$/i);
      const restFull=!restHalf&&String(line.market_name??'').match(/^correct score rest of match\s*\(from\s*(\d{1,2})\s*:\s*(\d{1,2})\)$/i);
      let actualHome,actualAway;
      if(restHalf){
       // Uses period score (hh for 1st half, fh-hh for 2nd half) minus frozen base.
       // `home` and `away` here are already periodScore.home/away from periodScores().
       actualHome=home-Number(restHalf[1]);
       actualAway=away-Number(restHalf[2]);
      }else if(restFull){
       actualHome=Number(result.home_score)-Number(restFull[1]);
       actualAway=Number(result.away_score)-Number(restFull[2]);
      }else{
       actualHome=home;
       actualAway=away;
      }
      if(!Number.isSafeInteger(actualHome)||actualHome<0||
         !Number.isSafeInteger(actualAway)||actualAway<0)return null;
      const m=String(line.outcome_name??line.outcome_key??'').trim().match(/^(\d+)\s*[:\-]\s*(\d+)$/);
      if(m)return decide(actualHome===Number(m[1])&&actualAway===Number(m[2]));
      if(/\bother\b/i.test(name)){
        // The actual quoted exact scores were frozen at purchase. A generic
        // 0..4 score grid is NOT proof of the provider's "Other" outcome.
        const grid=line.live_contract?.kind==='correct-score-grid'?line.live_contract.grid:null;
        if(!Array.isArray(grid)||!grid.length||grid.length>500||
           !grid.every(pair=>Array.isArray(pair)&&pair.length===2&&
             pair.every(n=>Number.isSafeInteger(n)&&n>=0&&n<=99)))return null;
        const outside=!grid.some(([h,a])=>h===actualHome&&a===actualAway);
        const otherName=String(line.outcome_name??'').toLowerCase();
        const type=/\bhome\s+win\b/.test(otherName)?actualHome>actualAway:
          /\baway\s+win\b/.test(otherName)?actualAway>actualHome:
          /\bdraw\b/.test(otherName)?actualHome===actualAway:true;
        return decide(outside&&type);
      }
      return null;
    }

    case 'ODD_EVEN': {
      const isOdd = totalGoals % 2 === 1;
      if (key === 'odd' || /^odd|tek/.test(name)) return decide(isOdd);
      if (key === 'even' || /^even|cift/.test(name)) return decide(!isOdd);
      return null;
    }

    case 'DNB': {
      const pickedHome=key==='1'||key==='home'||name==='home'||isHomeName(norm(name));
      const pickedAway=key==='2'||key==='away'||name==='away'||isAwayName(norm(name));
      // An unknown selection is never a loss or a draw refund.
      if(pickedHome===pickedAway)return null;
      if(draw)return 'WON';
      return decide(homeWin?pickedHome:pickedAway);
    }

    case 'HT_FT': {
      const option=parseHtFtOutcome(line.outcome_name,line.outcome_key);
      return gradeHtFt(option,result.half_home_score,result.half_away_score,
        result.home_score,result.away_score);
    }

    case 'CORNER_1X2': {
      const ch = num(result.corners_home), ca = num(result.corners_away);
      if (ch === null || ca === null) return null;
      const cHomeWin = ch > ca, cAwayWin = ca > ch, cDraw = ch === ca;
      if (key === '1' || key === 'home' || /^home/.test(name)) return decide(cHomeWin);
      if (key === 'x' || key === 'draw' || /^draw|^tie/.test(name)) return decide(cDraw);
      if (key === '2' || key === 'away' || /^away/.test(name)) return decide(cAwayWin);
      if (isHomeName(norm(name))) return decide(cHomeWin);
      if (isAwayName(norm(name))) return decide(cAwayWin);
      return null;
    }

    case 'BANDS_EXACT': {
      const isCorner = /corner/i.test(line.market_name);
      let val = totalGoals;
      if (isCorner) {
        const ch = num(result.corners_home), ca = num(result.corners_away);
        if (ch === null || ca === null) return null;
        const mn = String(line.market_name ?? '').toLowerCase();
        const isHomeC = /\b(?:home(?:\s*team)?|hometeam|team\s*1)\b/.test(mn);
        const isAwayC = /\b(?:away(?:\s*team)?|awayteam|team\s*2)\b/.test(mn);
        if (isHomeC && isAwayC) return null;
        val = isHomeC ? ch : isAwayC ? ca : ch + ca;
      }
      const rawName=String(line.outcome_name??line.outcome_key??'')
        .normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
      const cleanName=norm(rawName);
      // norm() discards '+'; check the unstripped provider selection FIRST.
      // "4+" is at least four, not exactly four.
      const plus=rawName.match(/^(\d+)\s*(?:\+|or\s+more)$/);
      if(plus)return decide(val>=Number(plus[1]));
      const band = String(line.outcome_name ?? line.outcome_key).match(/^(\d+)\s*(?:-|to|or)\s*(\d+)$/i);
      if (band) {
        const min = Number(band[1]), max = Number(band[2]);
        return decide(val >= min && val <= max);
      }
      const exact = cleanName.match(/^(\d+)$/);
      if (exact) {
        return decide(val === Number(exact[1]));
      }
      return null;
    }

    case 'DC_BTTS': {
      const selected=parseDcBttsOutcome(line.outcome_name,line.outcome_key);
      return gradeDcBtts(selected,home,away);
    }

    case 'CLEAN_SHEET': {
      const words=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
        .toLowerCase().replace(/\b(home|away)team\b/g,'$1 team')
        .replace(/[^a-z0-9]+/g,' ').trim();
      const title=' '+words(line.market_name)+' ';

      if (/\bdraw\s+or\s+(?:any\s+)?clean\s*sheet\b/i.test(title)) {
        const won = (home === away) || (home === 0) || (away === 0);
        if (key === 'yes' || name === 'yes' || name === 'po') return decide(won);
        if (key === 'no' || name === 'no' || name === 'jo') return decide(!won);
        return null;
      }
      if (/\b(?:home\s*team\s*wins?|hometeam\s*wins?)\s+or\s+(?:any\s+)?clean\s*sheet\b/i.test(title)) {
        const won = (home > away) || (home === 0) || (away === 0);
        if (key === 'yes' || name === 'yes' || name === 'po') return decide(won);
        if (key === 'no' || name === 'no' || name === 'jo') return decide(!won);
        return null;
      }
      if (/\b(?:away\s*team\s*wins?|awayteam\s*wins?)\s+or\s+(?:any\s+)?clean\s*sheet\b/i.test(title)) {
        const won = (away > home) || (home === 0) || (away === 0);
        if (key === 'yes' || name === 'yes' || name === 'po') return decide(won);
        if (key === 'no' || name === 'no' || name === 'jo') return decide(!won);
        return null;
      }
      if (/\bany\s+clean\s*sheet\b/i.test(title)) {
        const won = (home === 0) || (away === 0);
        if (key === 'yes' || name === 'yes' || name === 'po') return decide(won);
        if (key === 'no' || name === 'no' || name === 'jo') return decide(!won);
        return null;
      }

      const has=term=>!!term&&title.includes(' '+words(term)+' ');
      const h=has(result.home_team)||/\b(?:home(?: team)?|team 1|ekipi 1)\b/.test(title);
      const a=has(result.away_team)||/\b(?:away(?: team)?|team 2|ekipi 2)\b/.test(title);
      // A generic "Clean Sheet Yes" without an identifiable team cannot
      // use the opponent's goals by guessing a side.
      if(h===a)return null;
      const sheet=h?away===0:home===0;
      if(key==='yes'||name==='yes'||name==='po')return decide(sheet);
      if(key==='no'||name==='no'||name==='jo')return decide(!sheet);
      return null;
    }

    case 'CHANCE_MIX': {
      const m = String(line.market_name ?? '').match(/\b(draw|home\s*team\s*wins?|hometeam\s*wins?|away\s*team\s*wins?|awayteam\s*wins?)\s+or\s+(both\s+teams?\s+(?:to\s+)?score|total\s+(?:goals?\s+)?(over|under)(?:\s+(\d+(?:[.,]\d+)?))?)\b/i);
      if (!m) return null;
      const first = /^draw$/i.test(m[1]) ? (home === away)
        : /^home/i.test(m[1]) ? (home > away) : (away > home);
      let second;
      if (m[3]) {
        const threshold = num(line.line) ?? (m[4] ? num(m[4]) : 2.5);
        if (threshold === null) return null;
        second = /^over$/i.test(m[3]) ? (totalGoals > threshold) : (totalGoals < threshold);
      } else {
        second = home > 0 && away > 0;
      }
      const won = first || second;
      if (key === 'yes' || name === 'yes' || name === 'po') return decide(won);
      if (key === 'no' || name === 'no' || name === 'jo') return decide(!won);
      return null;
    }

    case 'ANY_TEAM_WIN': {
      const someoneWon = home !== away;
      if (key === 'yes' || /^yes|^po\b/i.test(name)) return decide(someoneWon);
      if (key === 'no' || /^no|^jo\b/i.test(name)) return decide(!someoneWon);
      return null;
    }

    case 'REST_OF_MATCH': {
      if(isHalftimeRestMarket(line.market_name))return gradeHalftimeRest(line,result);
      const snap = line.accepted_contract?.acceptedLiveSnapshot;
      let baseHome = snap?.scoreHome ?? snap?.counters?.goal?.home;
      let baseAway = snap?.scoreAway ?? snap?.counters?.goal?.away;
      if (baseHome == null || baseAway == null) {
        const p3 = line.accepted_contract?.nativeParameters?.p3;
        if (typeof p3 === 'string' && p3.includes(':')) {
          const parts = p3.split(':').map(Number);
          if (Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
            baseHome = parts[0];
            baseAway = parts[1];
          }
        }
      }
      if (baseHome == null || baseAway == null) {
        const fromMatch = String(line.market_name ?? '').match(/(?:from\s+|\()(\d{1,2})\s*[:\-]\s*(\d{1,2})\)?/i);
        if (fromMatch) {
          baseHome = Number(fromMatch[1]);
          baseAway = Number(fromMatch[2]);
        }
      }
      if (baseHome == null || baseAway == null) return null;
      const endHome=scoreValue(result.home_score);
      const endAway=scoreValue(result.away_score);
      if(endHome===null||endAway===null)return null;
      const deltaHome = endHome - Number(baseHome), deltaAway = endAway - Number(baseAway);
      if (deltaHome < 0 || deltaAway < 0) return null;
      if (key === '1' || /^home/.test(name)) return decide(deltaHome > deltaAway);
      if (key === 'x' || /^draw|^tie/.test(name)) return decide(deltaHome === deltaAway);
      if (key === '2' || /^away/.test(name)) return decide(deltaAway > deltaHome);
      return null;
    }

    case 'TEAM_TO_SCORE_2ND_HALF': {
      const fh = scoreValue(result.home_score), fa = scoreValue(result.away_score);
      const hh = scoreValue(result.half_home_score), ha = scoreValue(result.half_away_score);
      if (fh == null || fa == null || hh == null || ha == null) return null;
      const isHome = /home/i.test(line.market_name);
      const scored = isHome ? (fh - hh) > 0 : (fa - ha) > 0;
      if (key === 'yes' || /^yes|^po\b/i.test(name)) return decide(scored);
      if (key === 'no' || /^no|^jo\b/i.test(name)) return decide(!scored);
      return null;
    }

    case 'WILL_TIE': {
      const isDraw = home === away;
      if (key === 'yes' || /^yes|^po\b/i.test(name)) return decide(isDraw);
      if (key === 'no' || /^no|^jo\b/i.test(name)) return decide(!isDraw);
      return null;
    }

    case 'WINNING_MARGIN':
      return gradeWinningMargin(line, result);

    case 'WINNER_TOTAL': {
      const sel = parseWinnerTotal(line.outcome_key, result.home_team, result.away_team)
        ?? parseWinnerTotal(line.outcome_name, result.home_team, result.away_team);
      return gradeMixedTotal(line.market_name, sel, home, away);
    }

    case 'TEAM_NOT_TO_LOSE_TOTAL': {
      const sel = parseTeamNotToLoseTotal(line.market_name, line.outcome_key)
        ?? parseTeamNotToLoseTotal(line.market_name, line.outcome_name);
      return gradeTeamNotToLoseTotal(sel, home, away);
    }

    case 'BTTS_TOTAL_AND': {
      const sel = parseBttsTotal(line.market_name, line.outcome_key)
        ?? parseBttsTotal(line.market_name, line.outcome_name);
      return gradeBttsTotal(sel, home, away);
    }

    case 'DC_HALF_BTTS':
      return gradeDcHalfBtts(line, result);

    case 'HTFT_COMBO':
      return gradeHtFtCombo(line, result);

    case 'MULTISCORES':
      return gradeMultiscores(line, result);

    case 'TO_QUALIFY':
      return gradeQualification(line, result);

    default:
      // anything we cannot judge (player props, halves, unknown markets) is voided
      return null;
  }
}

/**
 * Closes a ticket after all legs resolve, or immediately when any leg loses.
 * A lost accumulator can close while unrelated lines are still PENDING.
 *
 * Runs in a transaction and re-reads the ticket under a lock, so two settlement passes
 * can never pay the same ticket twice.
 */
export async function recalcTicket(ticketId, { database = pool } = {}) {
  const client = await database.connect();
  try {
    await client.query('begin');

    const found = await client.query('select * from app_ticket where id = $1 for update', [ticketId]);
    const ticket = found.rows[0];
    if (!ticket || ticket.status !== 'PENDING') {
      await client.query('commit');
      return null;
    }

    const lines = (await client.query('select * from app_ticket_line where ticket_id = $1', [ticketId])).rows;
    const lost = lines.filter((l) => l.status === 'LOST');
    // A standard accumulator is lost as soon as ANY accepted selection loses.
    // Do not leave a provably lost ticket open just because other games remain live.
    // Preserve other line statuses as PENDING for an honest per-match audit.
    if (!lost.length && lines.some((l) => l.status === 'PENDING')) {
      await client.query('commit'); // no losing leg; still waiting for another match
      return null;
    }

    const won = lines.filter((l) => l.status === 'WON');
    const voids = lines.filter((l) => l.status === 'VOID');

    let status;
    let payout;
    if (!lost.length && won.length) {
      status = 'WON';
      // Honor the accepted ticket quote in full, including legacy rounding.
      // Removed VOID legs and explicitly repriced selections require a new quote.
      payout = voids.length||won.some(line=>line.settled_odds!=null)
        ? systemColumnPayout(Number(ticket.stake), won.map(line => line.settled_odds??line.odds_at_placement))
        : round(Number(ticket.potential_payout));
    } else if (!lost.length && !won.length && voids.length) {
      status = 'VOID';
      payout = round(Number(ticket.stake)); // full refund
    } else {
      status = 'LOST';
      payout = 0;
    }

    await client.query(
      `update app_ticket set status = $2, potential_payout = $3, settled_at = now() where id = $1`,
      [ticketId, status, payout],
    );

    if (payout > 0 && ticket.user_id) {
      const userRow = await client.query('select balance, manager_id, username from app_user where id = $1 for update', [
        ticket.user_id,
      ]);
      const after = round(Number(userRow.rows[0].balance) + payout);
      await client.query('update app_user set balance = $2, updated_at = now() where id = $1', [ticket.user_id, after]);
      await client.query(
        `insert into app_transaction (user_id, amount, type, reference_id, balance_after, description)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          ticket.user_id,
          payout,
          status === 'VOID' ? 'BET_REFUND' : 'BET_WON',
          ticketId,
          after,
          status === 'VOID' ? 'Kthim basti (VOID)' : 'Fitim basti',
        ],
      );
    }

    // Manager earnings are reports for manual settlement, never wallet money.
    if (ticket.user_id) {
      const user = await client.query('select manager_id, username from app_user where id = $1', [ticket.user_id]);
      const managerId = user.rows[0]?.manager_id;
      if (managerId && (status === 'WON' || status === 'LOST')) {
        await chargeManagerCommission(client, {managerId,ticketId,username:user.rows[0].username,stake:ticket.stake,selectionCount:lines.length});
      } else if (status === 'VOID') {
        // Refund actual historical debits to their original actor exactly once.
        const actors=await client.query(`select distinct user_id from app_transaction where reference_id=$1 and type='MANAGER_COMMISSION_DEBIT' order by user_id`,[ticketId]);
        for(const actor of actors.rows)await refundManagerCommission(client,{managerId:actor.user_id,ticketId,username:user.rows[0]?.username});
      }
    }

    // Freeze fully graded results in the same transaction as their payment.
    // A recovered payment must not leave its accepted score open to a later
    // conflicting provider frame because the original match pass was aborted.
    await client.query(`update app_match_result r set settled_at=coalesce(r.settled_at,now())
      where r.match_id in (select match_id from app_ticket_line where ticket_id=$1)
        and r.source in ('ZIZOBET','ADMIN')
        and not exists(select 1 from app_ticket_line l where l.match_id=r.match_id and l.status='PENDING')`, [ticketId]);
    await client.query('commit');
    return { ticketId, status, payout };
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * A legacy VOID can mean unsupported parsing. Refund only a confirmed
 * two-way full-integer total push, never an unknown market or outcome.
 */
export function isProvenTwoWayTotalPush(line,result){
 line=withFrozenPeriod(line);
 if(!line||!result||Array.isArray(line.builder_legs)||needsEvents(line))return false;
 const market=String(line.market_name??'');
 if(/\b(?:3[\s-]*way|three[\s-]*way|3[\s-]*outcomes?|three[\s-]*outcomes?)\b/i.test(market))return false;
 const choice=[line.outcome_key,line.outcome_name].map(x=>String(x??'').trim().toLowerCase());
 if(!choice.some(x=>/^(?:over|under)(?:\b|$)/.test(x)))return false;
 const amount=num(line.line);
 if(amount===null||!Number.isInteger(amount))return false;
 if(isStatisticMarket(line))
  return hasStatisticEvidence(line,result)&&gradeStatisticLine(line,result)==='VOID';
 const family=goalTotalContract(line,result)?'TOTAL':classify(market);
 if(!['TOTAL','CORNERS','CARDS'].includes(family))return false;
 return hasRequiredSettlementEvidence(line,result)&&gradeLine(line,result)==='VOID';
}

/** A DNB draw is a winning selection, repriced to 1.00 at settlement. */
export function settledOddsFor(line,result,status){
 if(status!=='WON'||!line||!result||Array.isArray(line.builder_legs))return null;
 const named=namedFinalTeamContract(line,result);
 const pick=normalizedTeamLabel(line.outcome_name??line.outcome_key);
 const namedDnbTeamPick=named?.kind==='named-dnb'&&
  ['home','away',named.homeName,named.awayName].includes(pick);
 if(!plainDnb(line.market_name)&&!namedDnbTeamPick)return null;
 line=withFrozenPeriod(line);
 const period=periodScores(line,result);
 return period&&period.home===period.away?1:null;
}
/**
 * First-half-only score contracts may settle on verified HT independently of
 * the full-time result. No corner/card/player-event or HT/FT proposition
 * may use the synthetic HT-only score context.
 */
export function firstHalfScoreOnly(line){
 if(!line||Array.isArray(line.builder_legs)||needsEvents(line))return false;
 line=withFrozenPeriod(line);
 const name=String(line.market_name??''),lower=name.toLowerCase();
 const period=scorePeriodOf(line);
 if(period!==1)return false;
 if(/\b(?:both halves|either half|each half|second half|2nd half|full time|rest of match|extra time)\b/i.test(name)||
    /\b(?:ht\s*\/\s*ft|halftime\s*\/\s*fulltime|half.?time\s*\/\s*full.?time)\b/i.test(name))
  return false;
 if(/\b(?:corners?|kornera?|cards?|bookings?|kartona?|fouls?|faulle?|shots?|goditj|players?|lojtare?|offsides?)\b/i.test(name))return false;
 if(isHtFtMarket(name)||isStatisticMarket(line)||isHalfExactMarketFamily(line))return false;
 const saved=line.live_contract;
 if(saved){
  if(saved.kind==='period-goal-total')
   return saved.half===1&&saved.event==='goal';
  if(saved.kind==='half-combo')return saved.half===1;
  if(saved.kind==='score-handicap')
   return saved.half===1&&saved.event==='goal'&&saved.rest!==true;
  // Other incident contracts need their own chronological facts.
  if(SUPPORTED_FACT_KINDS.has(saved.kind))return false;
 }
 if(isPeriodGoalTotal(line))
  return parsePeriodGoalTotal(line,{home:line.home_team,away:line.away_team})?.half===1;
 if(isHalfComboFamily(line))
  return parseHalfCombination(line,{home:line.home_team,away:line.away_team})?.half===1;
 if(isHandicapMarket(line))return false; // only explicit frozen rules
 if(isScoringPropMarket(line))
  return /\bto score(?: a goal)? in (?:first|1st) half\b/i.test(name);
 const family=goalTotalContract(line)?'TOTAL':classify(name);
 return ['1X2','BTTS','DC','TOTAL','DNB','CORRECT_SCORE',
  'ODD_EVEN','CLEAN_SHEET','HALF_RESULT_BTTS','BANDS_EXACT'].includes(family);
}
export function gradeAtVerifiedHalfTime(line,half){
 if(isPlayerOfferMarket(line)||line?.accepted_contract?.settlementHold)return null;
 if(!firstHalfScoreOnly(line)||half?.confirmed_at==null)return null;
 // A live half-time quote taken AFTER the HT result was already archived
 // must never receive an automatic payout from that known past result.
 if(line?.placed_at!=null&&half?.first_seen_at!=null&&
    new Date(line.placed_at).getTime()>=new Date(half.first_seen_at).getTime())
  return null;
 const home=scoreValue(half.half_home_score),away=scoreValue(half.half_away_score);
 if(home===null||away===null)return null;
 line=withFrozenPeriod(line);
 // Deliberately synthetic, scoped ONLY to the vetted 1H subset above.
 // This result never enters app_match_result or a FT audit.
 const result={home_team:half.home_team,away_team:half.away_team,
  home_score:home,away_score:away,half_home_score:home,half_away_score:away};
 let status;
 if(line.live_contract?.kind==='period-goal-total')
  status=gradePeriodGoalTotal(line.live_contract,result);
 else if(line.live_contract?.kind==='half-combo')
  status=gradeHalfCombination(line.live_contract,result);
 else if(line.live_contract?.kind==='score-handicap')
  status=gradeHandicapContract(line.live_contract,result);
 else status=gradeLine(line,result);
 if(!['WON','LOST','VOID'].includes(status))return null;
 if(status==='VOID'&&!isProvenTwoWayTotalPush(line,result)&&
    !(line.live_contract?.kind==='score-handicap'&&
      gradeHandicapContract(line.live_contract,result)==='VOID')&&
    !(line.live_contract?.kind==='half-combo'&&
      gradeHalfCombination(line.live_contract,result)==='VOID')&&
    !(line.live_contract?.kind==='period-goal-total'&&
      gradePeriodGoalTotal(line.live_contract,result)==='VOID'))
  return null;
 return status;
}
export async function settleVerifiedHalftimes({
 runQuery=query,update=updatePendingLine,recalc=recalcTicket
}={}){
 const rows=await nextHalfTimeLines(runQuery,[
  'select l.*,t.placed_at,h.home_team,h.away_team,h.half_home_score,h.half_away_score,h.confirmed_at,h.first_seen_at',
  'from app_ticket_line l',
  'join app_ticket t on t.id=l.ticket_id',
  'join app_match_half_result h on h.match_id=l.match_id',
  "where l.status='PENDING' and t.status='PENDING' and h.source='ZIZOBET' and h.confirmed_at is not null and t.placed_at < h.first_seen_at",
  "and exists(select 1 from app_match_snapshot s where s.match_id=h.match_id and s.snapshot->'raw'->>'provider'='ZIZOBET' and s.snapshot->'periods_score'->0->>'t1'=h.half_home_score::text and s.snapshot->'periods_score'->0->>'t2'=h.half_away_score::text)",
  'and not exists(select 1 from app_settlement_override o where o.line_id=l.id)'
 ].join(' '),5000);
 const tickets=new Set();let graded=0,held=0;
 for(const line of rows){
  const status=gradeAtVerifiedHalfTime(line,line);
  if(!status){held++;continue;}
  const settledOdds=settledOddsFor(line,line,status);
  if(await update(line.id,status,line.ticket_id,{settledOdds})){graded++;tickets.add(line.ticket_id);}
 }
 const closed=[];
 for(const ticketId of tickets){
  const result=await recalc(ticketId);
  if(result)closed.push(result);
 }
 return {examined:rows.length,graded,held,closed};
}

/** grades every pending line of one match, then closes the affected tickets */
export async function updatePendingLine(lineId,status,ticketId,{database=pool,settledOdds=null}={}){
  const client=await database.connect();
  try{
    await client.query('begin');
    const ticket=(await client.query('select status from app_ticket where id=$1 for update',[ticketId])).rows[0];
    const changed=ticket?.status==='PENDING'?await client.query(`update app_ticket_line set status=$2,settlement_reason=null,settled_odds=$3 where id=$1 and status='PENDING' and not exists(select 1 from app_settlement_override o where o.line_id=app_ticket_line.id)`,[lineId,status,settledOdds]):{rowCount:0};
    await client.query('commit');return changed.rowCount;
  }catch(error){await client.query('rollback').catch(()=>{});throw error;}finally{client.release();}
}
/** Informational only. Never use these labels as evidence or financial decisions.
 * The codes deliberately describe unproven prerequisites, not a guessed cause.
 */
export function pendingEventReason(line,result){
 const contract=line?.live_contract;
 if(!result)return 'FINAL_RESULT_OR_LIVE_FACTS_UNVERIFIED';
 if(!contract){
  const name=String(line?.market_name??'').toLowerCase();
  if(/\b(?:next|first|last|race|interval|minute|corner|card|goal|offside|bookings|sending off|scorer|player|race to|between)\b/.test(name))
   return 'NO_LIVE_CONTRACT';
  return 'NO_SETTLEMENT_RULE';
 }
 if(contract.kind==='player-goal')return 'PLAYER_IDENTITY_OR_PARTICIPATION_UNVERIFIED';
 if(contract.kind==='half-first-event')return 'FIRST_HALF_EVENT_PHASE_OR_COVERAGE_UNVERIFIED';
 if(['sequence','race','nth-time','team-nth-time','lead-up','interval-handicap','window-first-event','window-parity'].includes(contract.kind))
   return 'EVENT_ORDER_OR_COVERAGE_UNVERIFIED';
 if(contract.kind==='interval-result'||contract.startExclusive===true)
   return 'EVENT_SECOND_OR_COVERAGE_UNVERIFIED';
 if(contract.event==='card'&&contract.cardColor)
   return 'CARD_COLOR_OR_TIMELINE_UNVERIFIED';
 return 'EVENT_TIMELINE_OR_TOTAL_UNVERIFIED';
}
async function recordPendingReasons(items,runQuery=query){
 const grouped=new Map();
 for(const {line,result} of items){
  const reason=pendingEventReason(line,result);
  if(!reason)continue;
  if(!grouped.has(reason))grouped.set(reason,[]);
  grouped.get(reason).push(line.id);
 }
 for(const [reason,ids] of grouped){
  try{
   // Skip actual row writes when the diagnostic code hasn't changed. Bounded
   // batches avoid a query per pending selection on every settlement cycle.
   await runQuery(`update app_ticket_line
     set settlement_reason=$2
     where id=any($1::uuid[]) and status='PENDING'
       and settlement_reason is distinct from $2`,[ids,reason]);
  }catch(error){
   // No diagnostic failure may block a real ticket payment or a future pass.
   console.warn('[settle] pending reason unavailable:',error.message);
  }
 }
}

export async function settleMatch(matchId) {
  const result = await getResult(matchId);
  if (!result) return { matchId: String(matchId), settled: 0, reason: 'no result stored yet' };

  if (result.home_score != null && result.away_score != null) {
    if (!result.first_team_to_score || !result.last_team_to_score) {
      try {
        const facts = (await query(`
          select team, coalesce(seconds, minute*60) as sec
          from app_match_event_fact
          where match_id = $1 and kind = 'goal' and active
          order by sec asc
        `, [Number(matchId)])).rows;
        if (facts.length) {
          result.first_team_to_score = facts[0].team;
          result.last_team_to_score = facts[facts.length - 1].team;
        } else {
          const zizo = (await query(`
            select team, minute
            from app_zizobet_match_incident
            where match_id = $1 and kind = 'goal' and active
            order by minute asc
          `, [Number(matchId)])).rows;
          if (zizo.length) {
            result.first_team_to_score = zizo[0].team;
            result.last_team_to_score = zizo[zizo.length - 1].team;
          }
        }
      } catch (_) {}
    }
  }

  const lines = (
    await query(`select l.* from app_ticket_line l where match_id = $1 and l.status = 'PENDING' and not exists(select 1 from app_settlement_override o where o.line_id=l.id)`, [Number(matchId)])
  ).rows;
  if (!lines.length) return { matchId: String(matchId), settled: 0 };

  const tickets = new Set();
  const unresolved=[];
  let graded = 0;
  for (const line of lines) {
    // Player propositions are not part of this sportsbook. Never auto-grade
    // an old or malformed player ticket through any fallback settlement path.
    if(isPlayerOfferMarket(line)){
      unresolved.push({line,result});
      continue;
    }
    let status=null;
    let settlementLine=line;
    if(line?.accepted_contract?.settlementHold&&
       gradeHeldNativeCombo(line,result)===null){
      const heldContract=recoverHeldZizobetEventContract(line,result);
      if(!heldContract){
        unresolved.push({line,result});
        continue;
      }
      settlementLine={...line,live_contract:heldContract};
      status=await gradeStoredEventContract(settlementLine,result,{execute:query});
      if(!['WON','LOST','VOID'].includes(status)){
        unresolved.push({line:settlementLine,result});
        continue;
      }
    }
    if(!['WON','LOST','VOID'].includes(status)){
      // Old Zizobet corner tickets may predate a native parser. Rebuild only
      // from the immutable accepted ZIZOBET quote; never from AAMS or display text.
      const recoveredCornerContract=!settlementLine.live_contract?
        recoverLegacyZizobetCornerContract(settlementLine):null;
      if(recoveredCornerContract)
        settlementLine={...settlementLine,live_contract:recoveredCornerContract};
      if(!settlementLine.live_contract&&!settlementLine.accepted_contract?.settlementHold){
        const NON_RELATIVE=new Set([
          'half-total','half-exact-count','half-parity','corner-comparison',
          'multi-corners','race','last-event','over','under','exact',
          'range','atLeast','team-total-goals'
        ]);
        const rederived=liveContract({
          ...settlementLine,
          outcome_name:settlementLine.accepted_contract?.nativeOutcomeName??settlementLine.outcome_name,
          period:settlementLine.period??settlementLine.accepted_contract?.providerPeriod??0,
        },{teams:{home:result?.home_team,away:result?.away_team}});
        if(rederived&&NON_RELATIVE.has(rederived.kind)&&SUPPORTED_FACT_KINDS.has(rederived.kind))
          settlementLine={...settlementLine,live_contract:rederived};
      }
      // A frozen event contract is graded against PostgreSQL provider facts,
      // never parsed from a translated/displayed name at settlement time.
      if(settlementLine.live_contract&&SUPPORTED_FACT_KINDS.has(settlementLine.live_contract.kind)){
        status=await gradeStoredEventContract(settlementLine,result,{execute:query});
      }
      if(!['WON','LOST','VOID'].includes(status)&&hasRequiredSettlementEvidence(settlementLine,result)){
        status=gradeLine(settlementLine,result);
        // Only a proved two-way integer push is refundable on the legacy path.
        // Unsupported parsing remains PENDING.
        if(status==='VOID'&&!isProvenTwoWayTotalPush(line,result)&&
           !(isHandicapMarket(line)&&legacyHandicapResult(line,result)==='VOID'))status=null;
      }
    }
    if(!['WON','LOST','VOID'].includes(status)){
      unresolved.push({line:settlementLine,result});
      continue; // incomplete feed or missing market rule => PENDING
    }
    const settledOdds=settledOddsFor(line,result,status);
    const updated=await updatePendingLine(line.id,status,line.ticket_id,{settledOdds});
    if(updated>0){graded++;tickets.add(line.ticket_id);}
  }

  await recordPendingReasons(unresolved);
  const closed = [];
  for (const ticketId of tickets) {
    const done = await recalcTicket(ticketId);
    if (done) closed.push(done);
  }

  // Keep accepting later provider corner/card/HT statistics until every
  // selection is gradeable. Premature settled_at blocked archival refreshes.
  if (graded === lines.length) {
    await query(
      `update app_match_result set settled_at = now()
        where match_id = $1 and source in ('ZIZOBET','ADMIN') and not exists
          (select 1 from app_ticket_line
            where match_id = $1 and status = 'PENDING')`,
      [Number(matchId)],
    );
  }
  return { matchId: String(matchId), settled: graded, awaitingEvidence: lines.length - graded, tickets: closed };
}

/**
 * Live PRIMARY incidents can close proven goal/corner/window contracts before
 * full-time. Unknown, contradictory or unconfirmed provider facts stay PENDING.
 * Bounded to avoid flooding the PostgreSQL server with extra reads.
 */
export async function settleVerifiedEventFacts({
  runQuery=query, grade=gradeStoredEventContract, update=updatePendingLine,
  recalc=recalcTicket, limit=120
}={}){
 const cap=Math.max(1,Math.min(300,Number(limit)||120));
 const rows=await nextPrimaryEventLines(runQuery,`select l.* from app_ticket_line l
   join app_ticket t on t.id=l.ticket_id
   where l.status='PENDING' and t.status='PENDING'
     and l.live_contract is not null
     and not exists(select 1 from app_settlement_override o where o.line_id=l.id)
     and exists(select 1 from app_match_event_coverage e
       where e.match_id=l.match_id and e.kind=l.live_contract->>'event'
         and (e.provider='zizobet' or (e.complete=true and e.provider in ('fotmob','apifootball','sportapi','goalapi','bsd','worldcup26'))))`,cap);
 if(!rows.length)return {examined:0,graded:0,closed:[]};
 const ids=[...new Set(rows.map(l=>l.match_id))];
 const finals=(await runQuery("select match_id,home_score,away_score,corners_home,corners_away,cards_home,cards_away from app_match_result where source in ('ZIZOBET','RECOVERY','ADMIN','UNVERIFIED_LEGACY') and match_id=any($1::bigint[])",[ids])).rows;
 const results=new Map(finals.map(r=>[String(r.match_id),r]));
 const tickets=new Set(),unresolved=[];let graded=0;
 for(const line of rows){
  if(isPlayerOfferMarket(line)||!SUPPORTED_FACT_KINDS.has(line.live_contract?.kind))continue;
  const status=await grade(line,results.get(String(line.match_id))??null,{execute:runQuery});
  if(!['WON','LOST','VOID'].includes(status)){
    unresolved.push({line,result:results.get(String(line.match_id))??null});
    continue;
  }
  if(await update(line.id,status,line.ticket_id)){graded++;tickets.add(line.ticket_id);}
 }
 await recordPendingReasons(unresolved,runQuery);
 const closed=[];
 for(const id of tickets){const done=await recalc(id);if(done)closed.push(done);}
 return {examined:rows.length,graded,closed};
}

/** Grade only verified, elapsed corner YES/NO windows, independently of a
 * full-time result. Every other live market remains on the existing final
 * result path; missing evidence means PENDING rather than a guessed answer.
 */
export async function settleClosedCornerWindows({runQuery=query,loadEvidence=loadEventEvidence,update=updatePendingLine,recalc=recalcTicket}={}){
 const {rows}=await runQuery(`select l.* from app_ticket_line l
   join app_ticket t on t.id=l.ticket_id
   where l.status='PENDING' and t.status='PENDING'
     and l.market_name ~* 'corner'
     and l.market_name ~* '(minute|from)'
     and l.live_contract is null
     and coalesce(l.accepted_contract->>'settlementHold','')=''
     and not exists(select 1 from app_settlement_override o where o.line_id=l.id)
   order by l.match_id,l.id`);
 const cache=new Map(),tickets=new Set();let graded=0;
 for(const line of rows){
  if(isPlayerOfferMarket(line))continue;
  const id=String(line.match_id);
  if(!cache.has(id))cache.set(id,await loadEvidence(id).catch(()=>null));
  const status=gradeClosedCornerWindow(line,cache.get(id));
  if(status!== 'WON'&&status!=='LOST')continue;
  if(await update(line.id,status,line.ticket_id)){
   graded++;tickets.add(line.ticket_id);
  }
 }
 const closed=[];
 for(const id of tickets){const ticket=await recalc(id);if(ticket)closed.push(ticket);}
 return {graded,closed};
}

/** Line grading commits before ticket payment. A crash or transient database
 * error in between must not strand an otherwise resolved ticket forever.
 * Reuse the existing locked, idempotent payment transaction for every retry.
 */
export async function recoverResolvedTickets() {
  const { rows } = await query(`select t.id from app_ticket t
    where t.status='PENDING'
      and exists(select 1 from app_ticket_line l where l.ticket_id=t.id)
      and (exists(select 1 from app_ticket_line l where l.ticket_id=t.id and l.status='LOST')
        or not exists(select 1 from app_ticket_line l where l.ticket_id=t.id and l.status='PENDING'))
    order by t.placed_at,t.id`);
  const recovered = [];
  for (const { id } of rows) {
    try {
      const ticket = await recalcTicket(id);
      if (ticket) recovered.push(ticket);
    } catch (error) { console.error('[settle] resolved ticket', id, 'retry failed:', error.message); }
  }
  return recovered;
}

/** one pass: store newly finished results, then settle everything that can be settled */
export async function settleAll() {
  // Recover contracts for already accepted team-goal tickets before reading
  // the newest Zizobet frame or proposing a wallet settlement.
  let backfilled={examined:0,filled:0};
  try{backfilled=await backfillPendingTeamGoalContracts();}
  catch(error){console.error('[settle] team-goal backfill failed:',error.message);}
  let halfTime={examined:0,recorded:0,confirmed:0};
  try{halfTime=await captureHalfTimeResults();}
  catch(error){console.warn('[settle] half-time capture failed:',error?.message);}
  let atHalfTime={examined:0,graded:0,held:0,closed:[]};
  try{atHalfTime=await settleVerifiedHalftimes();}
  catch(error){console.error('[settle] verified half-time settlement failed:',error?.message);}
  let captured = 0;
  // A malformed/unavailable catalogue must not block already stored results or
  // recovery of payments whose line grading succeeded in an earlier pass.
  try { captured = await captureFinishedMatches(); }
  catch (error) { console.error('[settle] result capture failed:', error.message); }
  const ids = await unsettledMatchIds();

  const results = [];
  for (const id of ids) {
    try { results.push(await settleMatch(id)); }
    catch (e) { console.error('[settle] match', id, 'failed:', e.message); }
  }
  let primaryFacts={examined:0,graded:0,closed:[]};
  try{primaryFacts=await settleVerifiedEventFacts();}
  catch(error){console.error('[settle] verified primary event facts failed:',error.message);}
  let windows={graded:0,closed:[]};
  try {windows=await settleClosedCornerWindows();}
  catch(error){console.error('[settle] elapsed corner windows failed:',error.message);}
  // Next/first and race thresholds can be decided safely from the frozen
  // purchase counters and TWO independently observed PRIMARY Zizobet frames.
  // The verified writer now explicitly excludes all other market families,
  // which continue to require their verified PostgreSQL incident history.
  // Keep the kill switch for operators who need to pause these payments.
  let verifiedLive={enabled:false,examined:0,graded:0,closed:[]};
  try{verifiedLive=await settleVerifiedLiveProposals({
    updateLine:updatePendingLine,closeTicket:recalcTicket,
    enabled:process.env.LIVE_VERIFIED_AUTO_SETTLEMENT_ENABLED!=='false'
  });}
  catch(error){console.error('[settle] verified live settlement failed:',error.message);}
  let preview={examined:0,proposed:0,held:0,mode:'SHADOW_ONLY'};
  try{preview=await createLiveSettlementPreviews();}
  catch(error){console.warn('[settle] live shadow preview failed:',error.message);}
  const recovered = await recoverResolvedTickets();

  return {
    captured,
    matches: ids.length,
    lines: atHalfTime.graded + results.reduce((acc, r) => acc + r.settled, 0) + windows.graded + primaryFacts.graded + verifiedLive.graded,
    closed: atHalfTime.closed.length + results.reduce((acc, r) => acc + (r.tickets?.length ?? 0), 0) + windows.closed.length + primaryFacts.closed.length + verifiedLive.closed.length + recovered.length,
    recovered: recovered.length,
    backfilled,
    halftime:{...halfTime,graded:atHalfTime.graded,held:atHalfTime.held,closed:atHalfTime.closed.length},
    primaryFacts:{examined:primaryFacts.examined,graded:primaryFacts.graded,closed:primaryFacts.closed.length},
    verifiedLive:{enabled:verifiedLive.enabled,examined:verifiedLive.examined,graded:verifiedLive.graded,closed:verifiedLive.closed.length},
    livePreview:preview,
  };
}

/**
 * A stored match can remain retrievable long after the feed removed it.
 * Retrieval by ID does not mean a finished/inactive match is still in play.
 * Never void a genuinely active game merely because its clock is delayed.
 */
export const isStillOnBoard = (match, at = Date.now()) => {
  if (!match || match.active === false ||
      ['ended', 'finished', 'cancelled'].includes(String(match.status ?? '').toLowerCase())) return false;
  const kickoff = match.start_at ?? match.startAt;
  const startedAt = kickoff ? new Date(kickoff).getTime() : NaN;
  // An old provider row can remain active forever after an abandoned socket
  // subscription. After a *full day* beyond scheduled kickoff it is not a
  // credible in-progress football match, even if the API retained LIVE status.
  // This only matters after the ticket's separate 72h timeout has elapsed.
  if (Number.isFinite(startedAt) && at - startedAt > 24 * 60 * 60 * 1000) return false;
  return true;
};

/**
 * Safety valve: a ticket older than `hours` whose match has no stored result and is no
 * longer on the board can never be judged, so its lines are voided and the stake returned.
 */
/** Unconfirmed evidence is NOT cancellation authority. A timed refund
 * would turn an unverified winner into VOID and silently move player funds.
 * The administrator's review queue owns these cases until a documented
 * decision is recorded via manualSettlement. Genuine provider cancellation
 * requires its own explicit, audited contract rule, never elapsed time alone.
 */
export async function voidUnresolved(hours = 72) {
  const cutoff=Math.max(24,Math.trunc(Number(hours)||72));
  const pending=await query(`select count(*)::int as count
    from app_ticket_line l join app_ticket t on t.id=l.ticket_id
    where l.status='PENDING' and t.status='PENDING'
      and t.placed_at<now()-make_interval(hours=>$1::int)`,[cutoff]);
  return {voided:0,closed:[],heldForManualReview:Number(pending.rows[0]?.count??0)};
}
