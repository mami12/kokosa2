/** Provider statistics are independent facts: absent is never the number zero. */
export const TEAM_STAT_FIELDS=Object.freeze(['possession','shots','shotsOnTarget','fouls','corners','offsides','yellow','red']);
const aliases=new Map(Object.entries({
 possession:'possession',possessionpercent:'possession',ballpossession:'possession',
 shots:'shots',totalshots:'shots',shotstotal:'shots',
 shotsontarget:'shotsOnTarget',shotsongoal:'shotsOnTarget',ontarget:'shotsOnTarget',
 fouls:'fouls',foulscommitted:'fouls',foulsconceded:'fouls',totalfouls:'fouls',
 corners:'corners',cornerkicks:'corners',cornersht:'cornersHT',cornersft:'cornersFT',corners2h:'corners2H',secondhalfcorners:'corners2H',firsthalfcorners:'cornersHT',offsides:'offsides',offside:'offsides',totaloffsides:'offsides',yellow:'yellow',yellowcards:'yellow',red:'red',redcards:'red',
}));
const stamp=value=>{const n=new Date(value).getTime();return value!=null&&Number.isFinite(n)?new Date(n).toISOString():null;};
const wholePair=value=>{
 if(Array.isArray(value)&&value.length>=2){
  const home=statisticNumber(value[0]),away=statisticNumber(value[1]);
  return home===null||away===null?null:{home,away};
 }
 if(typeof value==='string'){
  const match=value.trim().match(/^(\d+)\s*(?::|\/|\||,)\s*(\d+)$/);
  if(match)return {home:Number(match[1]),away:Number(match[2])};
 }
 if(value&&typeof value==='object'){
  const home=value.home??value.Home??value.team1??value.Team1??value.t1??value['1']??value['0'];
  const away=value.away??value.Away??value.team2??value.Team2??value.t2??value['2'];
  const h=statisticNumber(home),a=statisticNumber(away);
  if(h!==null&&a!==null)return {home:h,away:a};
 }
 return null;
};
/** Zizobet final period results can be separate paired fields rather than
 * current live counters. Keep HT and FT pairs distinct; never use HT as a
 * live cumulative count or subtract a guessed half-time value.
 */
export function providerResultPair(game,field){
 if(!game||typeof game!=='object'||typeof field!=='string'||!field)return null;
 const containers=[game,game.Results,game.results,game.Result,game.result].filter(
  value=>value&&typeof value==='object'&&!Array.isArray(value));
 const normalized=name=>String(name).toLowerCase().replace(/[^a-z0-9]/g,'');
 const wanted=normalized(field);
 for(const source of containers){
  const direct=Object.entries(source).find(([key])=>normalized(key)===wanted);
  if(direct){const pair=wholePair(direct[1]);if(pair)return pair;}
  const homeNames=[field+'Team1',field+'_Team1','Team1'+field,'Team1_'+field,
   field+'Home',field+'_HOME','HOME_'+field,field+'_HOME_SCORE'];
  const awayNames=[field+'Team2',field+'_Team2','Team2'+field,'Team2_'+field,
   field+'Away',field+'_AWAY','AWAY_'+field,field+'_AWAY_SCORE'];
  const lookup=names=>{
   for(const name of names){
    const hit=Object.entries(source).find(([key])=>normalized(key)===normalized(name));
    if(hit){const value=statisticNumber(hit[1]);if(value!==null)return value;}
   }
   return null;
  };
  const home=lookup(homeNames),away=lookup(awayNames);
  if(home!==null&&away!==null)return {home,away};
 }
 return null;
}

export function statisticNumber(value,{percentage=false}={}){
 if(value==null||typeof value==='boolean'||typeof value==='object'||String(value).trim()==='')return null;
 const n=Number(value);return Number.isFinite(n)&&n>=0&&(percentage?n<=100:Number.isInteger(n))?n:null;
}
/** Only unambiguous provider names are mapped. Off-target shots, attacks and
 * free kicks must never be counted as on-target shots or committed fouls. */
export function normalizeTeamStatistics(raw,{observedAt=null,trustTimestamps=true}={}){
 const result={};if(!raw||typeof raw!=='object'||Array.isArray(raw))return result;
 const times={};
 for(const [name,value] of Object.entries(raw)){
  const key=aliases.get(name.toLowerCase().replace(/[^a-z0-9]/g,''))??(name.startsWith('goals:')?name:null);
  if(!key)continue;const number=statisticNumber(value,{percentage:key==='possession'});if(number===null)continue;
  result[key]=number;
  const at=(trustTimestamps?stamp(raw._observedAt?.[key]):null)??stamp(observedAt);
  if(at)times[key]=at;
 }
 if(Object.keys(times).length)result._observedAt=times;
 return result;
}
/** A partial card update must not erase corners or refresh their timestamp. */
export function mergeTeamStats(previous,next,{observedAt=null}={}){
 const result={...(previous||{})};
 for(const [team,raw] of Object.entries(next||{})){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))continue;
  const stats=normalizeTeamStatistics(raw,{observedAt}),before=result[team]||{};
  result[team]={...before};
  const times={...(before._observedAt||{})};
  for(const [field,value] of Object.entries(stats)){
   if(field==='_observedAt')continue;
   const prior=new Date(times[field]).getTime(),incoming=new Date(stats._observedAt?.[field]).getTime();
   if(Number.isFinite(prior)&&Number.isFinite(incoming)&&incoming<prior)continue;
   result[team][field]=value;if(Number.isFinite(incoming))times[field]=stats._observedAt[field];
  }
  if(Object.keys(times).length)result[team]._observedAt=times;
 }
 return result;
}
export function teamStatisticsFromRow(row){
 const map=row?.stats;if(!map||typeof map!=='object')return {home:null,away:null};
 const homeId=row.raw?.homeTeam?.id??row.raw?.competitors?.[0]?.id;
 const awayId=row.raw?.awayTeam?.id??row.raw?.competitors?.[1]?.id;
 const side=(id,key)=>{const raw=(id!=null?map[String(id)]:null)??map[key];return raw?normalizeTeamStatistics(raw):null;};
 return {home:side(homeId,'home'),away:side(awayId,'away')};
}
/** New prop settlements require each fact to have been observed with the FT
 * snapshot, rather than an old live count carried forward by an FT-only frame. */
export function verifiedFinalStatistics(row,{maxAgeMs=120000}={}){
 const teams=teamStatisticsFromRow(row),phaseAt=new Date(row?.feed_status_at??row?.score_at).getTime();
 const result={};if(!Number.isFinite(phaseAt))return result;
 for(const field of ['shots','shotsOnTarget','fouls','offsides']){
  const values={};
  for(const side of ['home','away']){
   const team=teams[side],at=new Date(team?._observedAt?.[field]).getTime();
   if(team?.[field]!=null&&Number.isFinite(at)&&Math.abs(at-phaseAt)<=maxAgeMs)values[side]=team[field];
  }
  if(Object.keys(values).length)result[field]=values;
 }
 return result;
}
export function trackerTeamStatistics(row){
 const teams=teamStatisticsFromRow(row),view={};
 for(const side of ['home','away'])view[side]=Object.fromEntries(TEAM_STAT_FIELDS.map(field=>[field,teams[side]?.[field]??null]));
 return view;
}
