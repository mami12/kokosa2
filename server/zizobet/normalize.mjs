import {isExcludedOfferMarket} from '../market-policy.mjs';
import {providerResultPair} from '../match-statistics.mjs';
import {competitionDecision,isSyntheticFootballMatch} from '../football-competitions.mjs';
export const OFFSET=8_000_000_000_000;
export const zId=id=>{if(!Number.isSafeInteger(Number(id))||Number(id)<=0||Number(id)>100000000000)throw Error('Invalid Zizobet ID');return OFFSET+Number(id);};
export const isZizoId=id=>Number(id)>OFFSET&&Number(id)<OFFSET+100000000000;
const text=v=>String(v??'').trim();
export const isAamsLogicMarket=value=>/\bAAMS[\s-]*logic\b/i.test(String(value??''));
const flagTrue=v=>v===true||v===1||/^(?:1|true|yes|on)$/i.test(text(v));
const flagFalse=v=>v===false||v===0||/^(?:0|false|no|off)$/i.test(text(v));
const booleanFlag=v=>flagTrue(v)?true:flagFalse(v)?false:undefined;
// Prematch `s` is a suspension bit in numeric API snapshots (0=open,
// 1=suspended), while older snapshots also send a boolean open flag.
const prematchOpenFlag=v=>{
 if(typeof v==='boolean')return v;
 const raw=text(v).toLowerCase();if(!raw)return undefined;
 if(raw==='0')return true;if(raw==='1')return false;
 return booleanFlag(v);
};
const resolvedQuote=v=>{
 const raw=text(v).toLowerCase();if(!raw||/^(?:false|no|off)$/.test(raw))return false;
 if(/^(?:true|yes|on)$/.test(raw))return true;
 const n=Number(raw);return Number.isFinite(n)?n!==0:true;
};
const slug=s=>text(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const pair=s=>{const m=text(s).match(/^(\d+):(\d+)$/);return m?m.slice(1).map(Number):null;};
const stamp=s=>{if(!s)return null;const n=Date.parse(/[zZ]|[+]\d\d:\d\d$/.test(s)?s:s+'Z');return Number.isFinite(n)?new Date(n):null;};
/** Full live dictionaries contain display placeholders different from prematch
 * templates. Read their actual quote parameters; never infer a time window
 * from the current clock or from its advertised five/ten/fifteen-minute size. */
export function resolveMarketTitle(raw,q,{intervalWidth,competitors}={}){
 let name=text(raw).replace(/^\*\s*/,'');
 // Race-to-X is a quote parameter, NOT the literal letter X. Refuse an
 // ambiguous offer instead of showing a misleading threshold on the ticket.
 const race=name.match(/^((?:(?:1st|first|2nd|second) half\s*[-–.:]\s*)?)(?:(?:which team wins (?:the )?)?race to x (corners?|goals?|cards?)\??)$/i);
 if(race){
  const kind=/goals?/i.test(race[2])?'goals':/cards?/i.test(race[2])?'cards':'corners';
  const rawVals=[q.h,q.p3,q.p1,q.p2,q.total,q.handicap,q.line];
  const validVals=rawVals
    .filter(v=>v!==null&&v!==undefined&&String(v).trim()!=='')
    .map(v=>Number(v))
    .filter(v=>Number.isSafeInteger(v)&&v>=1&&v<=100);
  if(validVals.length){
    name=race[1]+'Which team wins race to '+validVals[0]+' '+kind;
  }
 }
 // The provider catalog exposes parameterized minute windows as readable
 // placeholders rather than bracket tokens. Resolve them only from the native
 // p1/p2/h/p3 quote parameters; never infer the interval from the live clock.
 const oneMinuteWindow=name.match(/^1 minute\s*[-–]\s*total\s+(corners?|goals?|offsides?)\s+from first value:00 to value min$/i);
 if(oneMinuteWindow){
  const from=Number(q.p1),to=Number(q.p2),value=Number(q.h);
  if(!Number.isSafeInteger(from)||from<0||from>130||to!==from||
     q.h==null||!Number.isFinite(value)||value<0||!Number.isInteger(value*2))return null;
  return 'Total '+value+' '+oneMinuteWindow[1].toLowerCase()+
    ' in minutes '+from+'-'+to+' (1-minute interval)';
 }
 const oneMinuteClock=name.match(/^1 minute\s*[-–]\s*total(?:\s+(corners?|goals?|offsides?))?\s+from\s+\{from\}\s+to\s+\{to\}(?:\s*\((\d+(?:[.,]\d+)?|\{total\}|\{h\}|total)\))?$/i);
 if(oneMinuteClock){
  const rawKind=(oneMinuteClock[1]||'goals').toLowerCase();
  const kind=rawKind.startsWith('corner')?'corners':rawKind.startsWith('offside')?'offsides':'goals';
  const fromRaw=text(q.p1).match(/^(\d{1,3})(?::[0-5]\d)?$/)?.[1];
  const from=fromRaw!=null?Number(fromRaw):NaN;
  const embedded=oneMinuteClock[2]&&/^\d+(?:[.,]\d+)?$/.test(oneMinuteClock[2])?Number(oneMinuteClock[2].replace(',','.')):null;
  const rawVal=q.h??q.total??q.line??embedded;
  const value=Number(rawVal);
  const endClock=text(q.p3);
  if(!Number.isSafeInteger(from)||from<0||from>130||
     rawVal==null||!Number.isFinite(value)||value<0||!Number.isInteger(value*2))return null;
  const endMatch=endClock.match(/^(\d{1,3}):59$/);
  if(endMatch&&Number(endMatch[1])===from)
   return 'Total '+value+' '+kind+' from '+from+':00 to '+endClock+' min';
  const toRaw=text(q.p2).match(/^(\d{1,3})(?::[0-5]\d)?$/)?.[1];
  const to=toRaw!=null?Number(toRaw):NaN;
  if(q.p2!=null&&Number.isSafeInteger(to)&&to===from)
   return 'Total '+value+' '+kind+' in minutes '+from+'-'+from+' (1-minute interval)';
  if(q.p2==null&&!endClock)
   return 'Total '+value+' '+kind+' in minutes '+from+'-'+from+' (1-minute interval)';
  return null;
 }
 const teamToScoreClock=name.match(/^team to score\s+from\s+\{from\}\s+to\s+\{to\}$/i);
 if(teamToScoreClock){
  const from=Number(q.p1),endClock=text(q.p3);
  const endMatch=endClock.match(/^(\d{1,3}):([0-5]\d)$/);
  if(q.p1==null||!Number.isSafeInteger(from)||from<0||from>130)return null;
  if(endMatch&&Number(endMatch[1])>=from)return 'Team to score from '+from+':00 to '+endClock;
  const to=Number(q.p2);
  if(q.p2!=null&&Number.isSafeInteger(to)&&to>=from&&to<=130)return 'Team to score from '+from+':00 to '+to+':59';
  return null;
 }
 const joinedTeamProviderWindow=name.match(/^(\d{1,2})\s+minutes?\s*[-–]\s*(home|away)team\s+total\s+(corners?|cards?|bookings?|goals?|offsides?)\s+from\s+first value(?::00)?\s*(?:to|[-–])\s*second value(?::00)?\s*min\.?$/i);
 if(joinedTeamProviderWindow){
  const width=Number(joinedTeamProviderWindow[1]),side=joinedTeamProviderWindow[2].toLowerCase();
  const event=/bookings?/i.test(joinedTeamProviderWindow[3])?'cards':joinedTeamProviderWindow[3].toLowerCase();
  const from=Number(q.p1),to=Number(q.p2),value=Number(q.h);
  if(!Number.isSafeInteger(width)||width<1||width>30||
     q.p1==null||q.p2==null||q.h==null||
     !Number.isSafeInteger(from)||!Number.isSafeInteger(to)||
     from<0||to<from||to>130||to-from+1!==width||
     !Number.isFinite(value)||value<0||value>300||!Number.isInteger(value*2))return null;
  return 'Total '+value+' '+side+' team '+event+
   ' in minutes '+from+'-'+to+' ('+width+'-minute interval)';
 }
 const providerWindow=name.match(/^(\d{1,2})\s+minutes?\s*[-–]\s*(.+?)\s+from\s+first value(?::00)?\s*(?:to|[-–])\s*second value(?::00)?\s*min\.?$/i);
 const timeRange=name.match(/^(.+?)\s+in\s+(?:(\d{1,2})\s+)?minutes?\s+time range(?:\s*\((\d{1,2})-minute interval\))?$/i);
 const fixedRange=name.match(/^(.+?)\s+in\s+(\d{1,2})\s+minutes?\s+interval\s+(?:(\d{1,3})\s*[-–]\s*(\d{1,3})|\[from\]\s*[-–]\s*\[to\]|\{from\}\s*[-–]\s*\{to\})$/i);
 const firstCorner=name.match(/^(\d{1,2})\s+minutes?\s*[-–]\s*1st corner\s+from\s+first value(?::00)?\s*[-–]\s*second value\s*min$/i);
 const intervalMatch=providerWindow??timeRange??fixedRange??firstCorner;
 if(intervalMatch){
  const needsQuoteBounds=Boolean(providerWindow||firstCorner||timeRange||(fixedRange&&!intervalMatch[3]));
  if(needsQuoteBounds&&(q.p1==null||q.p2==null))return null;
  const width=Number(providerWindow||firstCorner?intervalMatch[1]:timeRange?(timeRange[2]??timeRange[3]):intervalMatch[2]);
  const from=Number(providerWindow||firstCorner?q.p1:timeRange?q.p1:fixedRange?(intervalMatch[3]??q.p1):q.p1);
  const to=Number(providerWindow||firstCorner?q.p2:timeRange?q.p2:fixedRange?(intervalMatch[4]??q.p2):q.p2);
  if(!Number.isSafeInteger(width)||width<1||width>30||
     !Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<0||to<from||to>130||to-from+1!==width)return null;
  let descriptor=String(providerWindow?providerWindow[2]:timeRange?timeRange[1]:fixedRange?fixedRange[1]:'1st corner').trim();
  descriptor=descriptor.replace(/\s+/g,' ').toLowerCase();
  const band=' in minutes '+from+'-'+to+' ('+width+'-minute interval)';
  if(/^result(?:\s+first value)?$/.test(descriptor))return 'Result from '+from+':00 to '+(to+1)+':00 min';
  if(/^corner result$/.test(descriptor))return 'Who takes most corners'+band;
  if(/^odd\/even corners?$/.test(descriptor))return 'Odd/Even corners'+band;
  if(/^card result$/.test(descriptor))return 'Who receives most cards'+band;
  if(/^corner handicap$/.test(descriptor))return 'Corner handicap'+band;
  if(/^1st corner$/.test(descriptor))return 'Who takes first corner'+band;
  if(/^who takes 1st corner$/.test(descriptor))return 'Who takes first corner'+band;
  if(/^who takes most corners$/.test(descriptor))return 'Who takes most corners'+band;
  if(/^who receives most bookings$/.test(descriptor))return 'Who receives most cards'+band;
  if(/^who scores most goals$/.test(descriptor))return 'Who scores most goals'+band;
  if(/^who scores goal number$/.test(descriptor)||/^№ value goal$/.test(descriptor)){
   if(!/^\d+$/.test(text(q.p3)))return null;
   return 'Who scores goal '+q.p3+band;
  }
  const teamFirst=descriptor.match(/^(home|away)team\s+total\s+(corners?|cards?|bookings?|goals?|offsides?)$/);
  if(teamFirst){
   const value=q.h,event=/bookings?/i.test(teamFirst[2])?'cards':teamFirst[2].toLowerCase();
   if(value==null||!Number.isFinite(Number(value))||Number(value)<0||!Number.isInteger(Number(value)*2))return null;
   return 'Total '+value+' '+teamFirst[1]+' team '+event+band;
  }
  const teamTotal=descriptor.match(/^total(?:\s+(\d+(?:[.,]\d+)?))?\s+(?:(home|away)\s*team\s+)?(corners?|cards?|bookings?|goals?|offsides?)(?:\s+(home|away)\s*team)?$/);
  if(teamTotal){
   const value=teamTotal[1]??q.h;
   if(value==null||!Number.isFinite(Number(value))||Number(value)<0||!Number.isInteger(Number(value)*2))return null;
   const side=teamTotal[2]??teamTotal[4];
   if(teamTotal[2]&&teamTotal[4])return null;
   const event=/bookings?/i.test(teamTotal[3])?'cards':teamTotal[3].toLowerCase();
   return 'Total '+value+(side?' '+side+' team':'')+' '+event+band;
  }
  const red=descriptor.match(/^(?:(home|away)team\s+)?red card$/);
  if(red)return (red[1]?red[1]+' team ':'')+'red card'+band;
 }
 // One legacy alias in the catalog uses the ordinal word instead of 1UP.
 if(/^full time first valueup$/i.test(name))return 'Full Time 1UP';
 if(/^When will next goal be scored/i.test(name)&&/^\d+$/.test(text(q.p3))){
  const explicit=name.match(/in (\d+) minutes interval/i)?.[1];
  const width=explicit??intervalWidth;
  return 'When will goal '+q.p3+' be scored'+(width?' ('+width+'-minute intervals)':'');
 }
 // Zizobet publishes the same fixed-minute totals for BOTH teams and for
 // a single home/away team. Preserve the subject explicitly; otherwise a
 // home-only Over bet could be incorrectly paid from both teams' corners.
 const teamInterval=name.match(/^Total\s+\[total\]\s+(?:(home\s*team|away\s*team)\s+)?(corners?|goals?|cards?)\s*(?:(home\s*team|away\s*team))?\s+in\s+(\d+)\s+minutes?\s+interval\s+\[from\]-\[to\]$/i);
 if(teamInterval&&(teamInterval[1]||teamInterval[3])){
  const side=teamInterval[1]??teamInterval[3];
  const from=Number(q.p1),to=Number(q.p2),width=Number(teamInterval[4]),value=Number(q.h);
  if((teamInterval[1]&&teamInterval[3])||q.p1==null||q.p2==null||
     q.h==null||!Number.isFinite(value)||value<0||value>300||
     !Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<0||to<from||
     to>130||to-from+1!==width)return null;
  const kind=teamInterval[2].toLowerCase();
  const canonicalSide=/^home/i.test(side)?'home team':'away team';
  return 'Total '+value+' '+canonicalSide+' '+kind+' in minutes '+from+'-'+to+
    ' ('+width+'-minute interval)';
 }
 const interval=name.match(/^(Who scores most goals|Who takes most Corners|Total \[total\](?: Corners)?|Who scores the \[goal!\] goal) in (\d+) minutes interval \[from\]-\[to\]$/i);
 if(interval){
  const from=Number(q.p1),to=Number(q.p2);
  if(q.p1==null||q.p2==null||!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<from)return null;
  let subject=/^Who scores most/i.test(interval[1])?'Who scores most goals':/^Who takes/i.test(interval[1])?'Who takes most corners':/Corners$/i.test(interval[1])?'Total corners':'Total goals';
  if(/^Who scores the/i.test(interval[1])){if(!/^\d+$/.test(text(q.p3)))return null;subject='Who scores goal '+q.p3;}
  return subject+' in minutes '+from+'-'+to+' ('+interval[2]+'-minute interval)';
 }
 if(/^(?:(?:1st|first|2nd|second)\s+half\s*[-–:]\s*)?Correct score \[\{score\}\]$/i.test(name)){
  if(!pair(q.p3))return null;
  if(/^(?:1st|first)\s+half/i.test(name))return '1st half - Correct score rest of half (from '+q.p3+')';
  if(/^(?:2nd|second)\s+half/i.test(name))return '2nd half - Correct score rest of half (from '+q.p3+')';
  return 'Correct score rest of match (from '+q.p3+')';
 }
 const cornerOrd=[q.p3,q.p1,q.p2,q.seq].find(v=>v!=null&&/^\d{1,3}$/.test(text(v))&&Number(v)>=1);
 if(/^who takes (?:the )?\[corner!\] corner\??$/i.test(name)){
  return cornerOrd!=null?'Who takes corner '+text(cornerOrd):null;
 }
 const values=Object.fromEntries(Object.entries({...q,from:q.p1,to:q.p2,total:q.h,handicap:q.h,player:q.pl,score:q.p3,'goal!':q.p3,'corner!':cornerOrd??q.p3,'!scorenr':q.p3??q.p1,
  competitor1:competitors?.competitor1??competitors?.home,
  competitor2:competitors?.competitor2??competitors?.away
 }).map(([k,v])=>[k.toLowerCase(),v]));
 name=name.replace(/\{([^{}]+)\}|\[([^\[\]]+)\]/g,(token,a,b)=>{const field=String(a??b).trim().toLowerCase().replace(/^\$/,'').replace(/_r$/,'');return values[field]!=null?String(values[field]):token;});
 // An unresolved token describes an unknown contract, not a display label.
 // Keep numeric score/range notation, but never offer guessed minutes/players.
 if(/[{}]|\[[^\[\]]*[a-z!_][^\[\]]*\]/i.test(name))return null;
 return name;
}
export function rowOf(game,meta,live){
 game={...game,ID:game.ID??game.GameID??game.id};
 const home=meta.teams.get(Number(game.Team1??game.t1))?.Name,away=meta.teams.get(Number(game.Team2??game.t2))?.Name;
 if(!home||!away)return null;
 const country=meta.regions.get(Number(game.Region??game.region)),champ=meta.champs.get(Number(game.Champ??game.ch));
 if(isSyntheticFootballMatch({home,away,tournament_name:champ?.Name,category_name:country?.Name,category_slug:slug(country?.Name),isEsport:game.IsEsport??game.isEsport,isSimulated:game.IsSimulated??game.isSimulated,isVirtual:game.IsVirtual??game.isVirtual}))return null;
 if(!live&&!competitionDecision({name:champ?.Name},{slug:slug(country?.Name)}).allowed)return null;
 return{match_id:zId(game.ID??game.id),sport_id:18,sport_tag:'football',category_id:Number(country?.ID??game.Region??game.region),category_name:country?.Name,category_slug:slug(country?.Name),tournament_id:Number(champ?.ID??game.Champ??game.ch),tournament_name:champ?.Name,tournament_slug:slug(champ?.Name),home,away,service:live?'LIVE':'PREMATCH',start_at:stamp(game.StartTime??game.st),status:'scheduled',phase:null,is_real:true,is_hot:false,raw:{provider:'ZIZOBET',nativeId:game.ID??game.id,homeTeam:{id:'home'},awayTeam:{id:'away'}}};
}
export function infoOf(row,game,meta){
 const status=Number(game.EventStatus??game.MatchStatusID),phase=meta.statuses.get('1_'+status),score=pair(game.Score);
 const liveOpen=booleanFlag(game.LiveBetStatus),prematchOpen=prematchOpenFlag(game.s);
 const hasOpenOdds=row.service==='LIVE'
  ? liveOpen===undefined?undefined:liveOpen&&status!==40
  : prematchOpen;
 const info={matchId:row.match_id,feedStatus:status===40&&score?'Finished':status===40?'Result Pending':phase==='1st half'?'First Half':phase==='2nd half'?'Second Half':phase??(row.service==='LIVE'?'Live':'Not Started'),...(hasOpenOdds===undefined?{}:{hasOpenOdds})};
 if(score){info.homeScore=score[0];info.awayScore=score[1];}
 try{
  const periods=typeof game.SetScores==='string'?JSON.parse(game.SetScores):game.SetScores;
  if(Array.isArray(periods)&&periods.length){
   const values=periods.map(pair);
   if(values[0]&&values[1]){
    info.periodsScore=values.slice(0,2).map(p=>({t1:p[0],t2:p[1]}));
    if(periods.length>2){
     info.homeScore=values[0][0]+values[1][0];
     info.awayScore=values[0][1]+values[1][1];
    }
   }else if(values[0]&&/^(?:ht|half.?time|break time|interval|break|2h|h2|second half|2nd half)$/i.test(
      String(info.feedStatus??'').trim())){
    // A single completed first-period score is real HT evidence. It is
    // NOT a final result and must never populate FT settlement directly.
    info.periodsScore=[{t1:values[0][0],t2:values[0][1]}];
   }else if(status===40&&periods.length>2){
    delete info.homeScore;delete info.awayScore;info.feedStatus='Result Pending';
   }
  }
 }catch{
  if(status===40&&/extra|penalt/i.test(phase??''))info.feedStatus='Result Pending';
 }
 const clock=text(game.MatchTimeExtended).match(/^(\d+):(\d{2})$/),minute=Number(game.MatchTime);
 if(clock)info.matchTimeMs=(Number(clock[1])*60+Number(clock[2]))*1000;else if(game.MatchTime!=null&&text(game.MatchTime)!==''&&Number.isFinite(minute))info.matchTimeMs=minute*60000;
 const stats={home:{},away:{}};
 const runningCorners=providerResultPair(game,'Corners')??{
  home:Number.isSafeInteger(Number(game.CornersTeam1))&&game.CornersTeam1!=null?Number(game.CornersTeam1):null,
  away:Number.isSafeInteger(Number(game.CornersTeam2))&&game.CornersTeam2!=null?Number(game.CornersTeam2):null
 };
 const htCorners=providerResultPair(game,'RESULT_CORNERHT');
 const ftCorners=providerResultPair(game,'RESULT_CORNERFT');
 const isFinished=Number(game.EventStatus??game.MatchStatusID)===40;
 const currentCorners=isFinished?(ftCorners??runningCorners):runningCorners;
 for(const [name,field]of[['YellowCards','yellow'],['RedCards','red'],['Fouls','fouls'],['Offsides','offsides'],['Offside','offsides'],['Shots','shots'],['ShotsOnTarget','shotsOnTarget']])for(const [i,side]of[[1,'home'],[2,'away']]){const v=game[name+'Team'+i];if(v!=null&&Number.isInteger(Number(v))&&Number(v)>=0)stats[side][field]=Number(v);}
 for(const [side,key]of[['home','Team1'],['away','Team2']]){
  if(currentCorners?.[side]!=null)stats[side].corners=currentCorners[side];
  if(htCorners)stats[side].cornersHT=htCorners[side];
  if(ftCorners)stats[side].cornersFT=ftCorners[side];
  if(htCorners&&ftCorners&&ftCorners[side]>=htCorners[side])
   stats[side].corners2H=ftCorners[side]-htCorners[side];
 }
 if(Object.keys(stats.home).length||Object.keys(stats.away).length)info.stats=stats;
 return info;
}
export function oddsOf(row,quotes,meta,live,open=true,diagnostics){
 const rows=[];
 const note=key=>{if(diagnostics)diagnostics[key]=(diagnostics[key]??0)+1;};
 const marketIdOfQuote=q=>Number(q.mid??q.marketId??q.market_id);
 const quoteMarketName=q=>{
  const nested=q.market&&typeof q.market==='object'?q.market:{};
  const value=q.marketName??q.market_name??q.marketTitle??q.market_title??
   q.mn??nested.Name??nested.name??nested.nm??(typeof q.market==='string'?q.market:null);
  return typeof value==='string'?text(value):'';
 };
 const quotePosition=q=>{
  const nested=q.position&&typeof q.position==='object'?q.position:{};
  const value=q.pn??q.pname??q.positionName??q.position_name??
   q.outcomeName??q.outcome_name??q.label??nested.Name??nested.name??nested.nm??
   (typeof q.position==='string'?q.position:null)??(typeof q.outcome==='string'?q.outcome:null);
  return typeof value==='string'?text(value):'';
 };
 const widths=new Map();
 for(const q of quotes??[]){
  const id=marketIdOfQuote(q),position=meta.positions?.get(String(q.pid??q.pos))??q.pn??q.pname??q.positionName;
  const p=text(position).match(/^min\s+(\d+)-(\d+)$/i);if(!p)continue;
  const width=Number(p[2])-Number(p[1])+1;if(width<=0)continue;
  const counts=widths.get(id)??new Map();counts.set(width,(counts.get(width)??0)+1);widths.set(id,counts);
 }
 if(diagnostics)diagnostics.rawQuotes=(quotes??[]).length;
 for(const q of quotes??[]){
  const id=marketIdOfQuote(q);
  if(!Number.isSafeInteger(id)||id<=0){note('missingMarketId');continue;}
  const dictionary=(live?meta.liveMarkets:meta.preMarkets).get(id);
  // Some provider snapshots omit an entry from the dictionary even though
  // the quote itself includes its untouched market title. Preserve that
  // native offer rather than silently losing it before delivery.
  const rawName=[dictionary?.Name,dictionary?.name,dictionary?.nm,quoteMarketName(q)].map(text).find(Boolean)??'';
  const def=dictionary??(rawName?{ID:id,Name:rawName}:null);
  if(!def){note('missingMarketDefinition');continue;}
  if(!rawName){note('missingMarketName');continue;}
  // AAMS-logic correct-score grids are not part of this sportsbook's offer.
  // Exclude the native offer before it can be cached, accepted or settled.
  if(isAamsLogicMarket(rawName)){note('excludedAamsLogic');continue;}
  // Apply the same explicit exclusion policy before key generation and again
  // after native parameters have expanded the provider's title.
  if(isExcludedOfferMarket({name:rawName,nativeMarketId:String(id)})){note('excluded');continue;}
  // Keep every quoted total line, including quarter thresholds (0.25/0.75).
  // Unsupported split-settlement contracts are held for review after placement;
  // they must not disappear from the native Zizobet offer at ingestion.
  // Preserve every numbered native parameter. Zizobet can add p4/p5/etc. to
  // market templates; dropping them aliases distinct offers to one market key.
  const params=Object.fromEntries(Object.entries(q).filter(([k,v])=>v!=null&&
    (/^p\d+$/i.test(k)||/^(?:pl|comp|seq)$/i.test(k))).sort(([a],[b])=>a.localeCompare(b)));
  const key='zz'+id+'@'+Buffer.from(JSON.stringify(params)).toString('base64url'),
   line=q.h!=null?String(q.h):q.total!=null?String(q.total):q.line!=null?String(q.line):'';
  // Some dictionary snapshots omit a position entry even though the quote
  // itself carries its native label. Prefer the dictionary, then the quote's
  // own label; do not silently drop a valid provider selection.
  const positionId=q.pos??q.positionId??q.position_id??q.pid;
  const dictionaryPosition=def.pos?.find(p=>Number(p.id)===Number(positionId))?.nm;
  const position=text(dictionaryPosition)||text(meta.positions.get(String(q.pid??q.pos??q.positionId??q.position_id)))||quotePosition(q);
  if(position==null||String(position).trim()===''){note('missingOutcomeLabel');continue;}
  const nativeOutcomeId=q.id??q.oid??q.outcomeId??q.outcome_id??q.selectionId??q.selection_id;
  if(nativeOutcomeId==null||String(nativeOutcomeId).trim()===''){note('missingOutcomeId');continue;}
  const measuredWidth=[...(widths.get(id)??[])].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0]?.[0];
  // Keep the exact provider title if a dynamic placeholder cannot be expanded.
  // Its native parameters are still frozen and the ticket is held for review
  // rather than making the quoted offer vanish from the market list.
  const competitors={competitor1:row.home,competitor2:row.away};
  const expandedTitle=resolveMarketTitle((live&&id===18639)?'Correct score [{score}]':(live&&id===18640)?'1st half - Correct score [{score}]':rawName,q,{intervalWidth:measuredWidth,competitors});
  if(expandedTitle===null&&/(?:\{from\}|\{to\}|\[corner!\]|\[goal!\]|\{!?scorenr\})/i.test(rawName)){note('unresolvedTemplate');continue;}
  let name=expandedTitle??rawName;
  if(live&&id===602)name='1X2';
  name=name.replace(/\bHometeam\b/gi,'Home team').replace(/\bAwayteam\b/gi,'Away team');
  if(isExcludedOfferMarket({name,pl:q.pl,nativeMarketId:String(id),marketKey:key}))continue;
  if(q.pl&&!name.includes(String(q.pl)))name+=' · '+q.pl;
  const fullResult=(live&&id===602)||(!live&&id===448);
  const fullTotal=(live&&id===603)||(!live&&id===537);
  const label=resolveMarketTitle(position,q,{competitors})??String(position);
  const canonical=/^(?:1|x|2|1x|12|x2)$/i.test(label)?label.toUpperCase():/^(?:over|o)$/i.test(label)?'Over':/^(?:under|u)$/i.test(label)?'Under':/^(?:yes|no)$/i.test(label)?label[0].toUpperCase()+label.slice(1).toLowerCase():null;
  const priceCandidates=live?[q.v,q.coef,q.price,q.odds]:[q.coef,q.v,q.price,q.odds];
  const rawPrice=priceCandidates.find(value=>value!=null&&String(value).trim()!=='');
  const price=Number(rawPrice),suspended=!open||flagFalse(q.visible)||flagTrue(q.lock)||resolvedQuote(q.res)||!Number.isFinite(price)||price<=1;
  // Preserve the untouched public API name/selection and quote parameters
  // for the durable PostgreSQL archive. Browser labels are a separate layer.
  // Keep the complete raw quote so the provider's original fields survive
  // storage, ticket freezing, and later contract-rule work.
  const nativeQuote=Object.fromEntries(Object.entries(q).filter(([,v])=>v!==undefined));
  rows.push({matchId:row.match_id,marketKey:key,marketName:name,line,outcomeKey:'z'+String(nativeOutcomeId),
   outcomeName:label,price:Number.isFinite(price)&&price>1?price:null,suspended,
   providerId:'ZIZOBET',nativeMarketId:String(id),nativeOutcomeId:String(nativeOutcomeId),
   nativeMarketName:String(rawName),nativeOutcomeName:String(position),
   nativeParameters:params,nativeQuote,isBase:fullResult||fullTotal,
   column:fullResult?'result':fullTotal?'total':'other',order:Number(def.N??def.n??0),
   period:/\b(?:1st|first) half\b/i.test(name)?1:/\b(?:2nd|second) half\b/i.test(name)?2:0});
  // Canonical result/total keys are needed by existing builder and settlement rules.
  if(canonical)rows.at(-1).outcomeKey=canonical;
 }
 if(diagnostics)diagnostics.normalizedRows=rows.length;
 return dedupeMarketRows(rows);
}

/** Keep one complete provider contract, never mix its component prices with
 * another quote family. Different periods, subjects, lines and goal ranges
 * remain separate even if a translation happens to look similar. */
export function dedupeMarketRows(rows){
 const groups=new Map();for(const r of rows){const key=r.marketKey+'|'+r.line;const group=groups.get(key)??[];group.push(r);groups.set(key,group);}
 const accepted=[],signatures=new Set(),correctScores=new Map(),nativeContracts=new Set();
 const norm=s=>String(s).trim().toLowerCase().replace(/\s+/g,' ');
 const appendNativeContract=group=>{
  const first=group[0];
  const complete=group.length>=2&&group.every(r=>r.nativeMarketId!=null&&
   String(r.nativeMarketName??'').trim()!==''&&r.nativeParameters&&
   typeof r.nativeParameters==='object'&&String(r.nativeOutcomeName??'').trim()!==''&&
   r.price!==null&&r.price!==undefined&&Number.isFinite(Number(r.price)));
  if(complete){
   const outcomeNames=group.map(r=>norm(r.nativeOutcomeName));
   if(new Set(outcomeNames).size===outcomeNames.length){
    const params=Object.fromEntries(Object.entries(first.nativeParameters).sort(([a],[b])=>a.localeCompare(b)));
    const outcomes=group.map(r=>[norm(r.nativeOutcomeName),Number(r.price),r.suspended===true])
     .sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const signature=JSON.stringify([first.matchId??null,norm(first.nativeMarketName),
     first.period??0,String(first.line??''),params,outcomes]);
    if(nativeContracts.has(signature))return;
    nativeContracts.add(signature);
   }
  }
  accepted.push(...group);
 };
 for(const group of [...groups.values()].sort((a,b)=>a[0].marketKey.localeCompare(b[0].marketKey,undefined,{numeric:true}))){
  const r=group[0];
  // Native market IDs are separate provider contracts even when their
  // translated titles, line and outcome labels happen to be identical.
  // Keep IDs distinct while still merging duplicate grids within one ID.
  const nativeId=String(r.marketKey).match(/^zz(\d+)@/)?.[1]??String(r.marketKey);
  const base=[norm(r.marketName),r.period,r.line,nativeId].join('|');
  const labels=[...new Set(group.map(q=>norm(q.outcomeName)))].sort();
  if(/^(?:(?:1st|2nd) half - )?correct score$/i.test(r.marketName)){
   const existing=correctScores.get(base);
   // These variants quote the same score contract with different grids.
   // Prefer the most complete grid, including its own "other score" quote.
   if(!existing||group.length>existing.length)correctScores.set(base,group);
   continue;
  }
  const signature=base+'|'+r.marketKey.split('@')[1]+'|'+JSON.stringify(labels);
  if(!signatures.has(signature)){signatures.add(signature);appendNativeContract(group);}
 }
 for(const group of correctScores.values())appendNativeContract(group);
 return accepted;
}
