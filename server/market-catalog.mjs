import {isExcludedOfferMarket} from './market-policy.mjs';
const catalog=new Map(),disabled=new Set(),disabledCategories=new Set();
export const MARKET_CATEGORY_IDS=['totals','intervals','results','goals','corners','shots','combos','other'];

export const NON_FOOTBALL_PATTERN = new RegExp([
  // Cricket
  '\\b(?:innings?|boundary|wicket|wickets|batsman|bowler|sixes|fours|day\\s+session|partnership|first\\s+over|per\\s+over)\\b',
  '\\b\\d+\\s+overs\\b',
  '\\bovers\\s+\\d+\\b',
  '\\bcricket\\b',
  // Tennis / Table Tennis / Badminton / Volleyball
  '\\b(?:aces?|tie.?break|deuce|breakpoint|service\\s+fault|penta|to\\s+retire|retirements?)\\b',
  '\\{p\\d+_r\\}\\s+sets?\\b',
  '\\bsets?\\s+-',
  '\\bgame\\s+\\{p\\d+_r\\}',
  '\\b(?:1st|2nd|3rd|4th|5th)\\s+set\\b',
  '\\bset\\s+(?:1|2|3|4|5)\\b',
  // Snooker / Darts
  '\\b(?:frames?|break\\s+50\\+|break\\s+100\\+|highest\\s+break|century\\s+break|colour\\s+potted|180s|checkouts?|segment\\s+winner)\\b',
  '\\bleg\\s+(?:handicap|winner|total)\\b',
  // Basketball
  '\\b(?:quarters?|points?|rebounds?|dunks?|free\\s+throw|field\\s+goal)\\b',
  // Baseball
  '\\b(?:home\\s+run|strikeouts?|pitcher|batting|batter|base\\s+on\\s+balls|at\\s+bat|time\\s+at\\s+bat)\\b',
  // American Football / Rugby
  '\\b(?:touchdowns?|touchdown|try|conversion|quarterback|passing\\s+yards|rushing\\s+yards|drive\\s+play|first\\s+down|pass\\s+completion|sack|yards?\\s+gained)\\b',
  '(?<!goal\\s+)scoring\\s+type',
  // Ice hockey / Hockey (Hockey has 3 periods of 20 min)
  '\\b(?:puck|puck\\s+line|powerplay|empty\\s+net|period\\s+and\\s+matchbet|period\\s+result)\\b',
  '\\{p\\d+_r\\}\\s+period\\b',
  '\\bperiod\\s+-',
  // Combat sports (Boxing / MMA / UFC)
  '\\b(?:knockout|tko|submission|round\\s+\\d+|method\\s+of\\s+victory|fighter|knockdowns?|strikes?\\s+landed)\\b',
  // Esports
  '\\b(?:maps?|kills?|dragon|baron|roshan|pistol\\s+round|first\\s+blood|bomb\\s+defused|bomb\\s+planted|aegis|barracks|inhibitor)\\b',
  // Cycling / Racing / Formula 1
  '\\b(?:stage|pole\\s+position|fastest\\s+lap|lap\\s+-|pit\\s+stop)\\b'
].join('|'), 'i');

export function isFootballMarketName(name){
  return !NON_FOOTBALL_PATTERN.test(String(name??''));
}

export function marketFamily(m={}){
 let name=String(m.market_name??m.marketName??m.name??'').trim().replace(/^\*\s*/,'').split(/\s+(?:Â?·)\s+/)[0];
 if(!name)return null;
 try{const key=String(m.market_key??m.marketKey??m.key??m.extId??'');const encoded=key.match(/^zz\d+@([\w-]+)$/)?.[1];if(encoded){const bytes=Uint8Array.from(atob(encoded.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));const params=JSON.parse(new TextDecoder().decode(bytes));if(params.pl)name=name.replaceAll(String(params.pl),'Player');}}catch{/* Unknown identity keeps its original name. */}
 name=name.replace(/\bHometeam\b/gi,'Home team').replace(/\bAwayteam\b/gi,'Away team');
 name=name.replace(/in minutes \d+-\d+/gi,'in minutes {window}').replace(/\(from \d+:\d+\)/gi,'(from {score})').replace(/\bgoal \d+\b/gi,'goal {number}').replace(/\bFull Time Result\b|^Match result$/gi,'1X2');
 const key=name.toLowerCase().replace(/\s+/g,' ');
 return {key,name};
}
/** Exact Zizobet native ID policies apply even to markets that have not
 * yet been quoted on the lightweight board. This supplements, never
 * replaces, the existing name-based family policies. */
export function nativeMarketPolicyKeys(m,match){
 const quoteKey=String(m?.market_key??m?.marketKey??m?.extId??m?.key??'');
 const id=quoteKey.match(/^zz(\d+)@/)?.[1];
 if(!id)return [];
 const service=String(match?.service??match?.status??(match?.live?'LIVE':'')).toUpperCase();
 if(service==='LIVE')return ['zizobet:live:'+id];
 if(service==='PREMATCH'||service==='SCHEDULED')return ['zizobet:prematch:'+id];
 return ['zizobet:live:'+id,'zizobet:prematch:'+id];
}
export function marketCategories(name){
 const n=String(name).toLowerCase(),tags=[];
 for(const[tag,pattern]of Object.entries({totals:/total|over.?under/,intervals:/interval|minutes?|when will|time of/,corners:/corner/,cards:/card|booking/,fouls:/foul/,shots:/shot/,players:/player|scorer|\{pl\}|scoring type/,combos:/&|(?:^|[^\d])\+|bet builder|\b(?:and|both halves)\b/,results:/1x2|result|winner|double chance|correct score|draw no bet/,goals:/goal|score|clean sheet|to nil/}))if(pattern.test(n))tags.push(tag);
 return tags.length?tags:['other'];
}
export function observeMarket(m){const family=marketFamily(m);if(family&&isFootballMarketName(family.name)&&!isExcludedOfferMarket(m)&&!isExcludedOfferMarket({name:family.name})&&!catalog.has(family.key))catalog.set(family.key,{...family,categories:marketCategories(family.name)});return family;}
const scopeBlocks=[];
const normScope=v=>String(v??'').trim().toLowerCase().replace(/\s+/g,' ');
function scopeBlocked(f,match,rules=scopeBlocks){
 if(!match||!rules.length)return false;
 const category=normScope(match?.tournament?.category?.name??match?.category?.name??match?.category_name??match?.category_slug??match?.country);
 const leagueName=normScope(match?.tournament?.name??match?.tournament_name??match?.league);
 const full=normScope([category,leagueName].filter(Boolean).join(' '));
 const cats=marketCategories(f.name);
 for(const rule of rules){
  if(rule.country&&!(category.includes(rule.country)||full.includes(rule.country)))continue;
  if(rule.league&&!(leagueName.includes(rule.league)||full.includes(rule.league)))continue;
  const catHit=!rule.categories.length||rule.categories.some(c=>cats.includes(c));
  const famHit=!rule.families.length||rule.families.includes(f.key);
  if(catHit&&famHit)return true;
 }
 return false;
}
export function setScopeBlocks(rows){scopeBlocks.length=0;for(const r of rows??[]){const country=normScope(r?.country),league=normScope(r?.league);if(!country&&!league)continue;scopeBlocks.push({country,league,categories:(r?.categories??[]).map(normScope).filter(Boolean),families:(r?.families??[]).map(normScope).filter(Boolean)});}}
export const scopeBlockRows=()=>scopeBlocks.map(r=>({...r}));
export function marketScopeBlocked(m,match,rules){
 const family=marketFamily(m);if(!family)return false;
 return scopeBlocked(family,match,(rules??[]).map(r=>({country:normScope(r.country),league:normScope(r.league),categories:(r.categories??[]).map(normScope),families:(r.families??[]).map(normScope)})));
}
export function marketIsEnabled(m,match){if(isExcludedOfferMarket(m))return false;const f=observeMarket(m);if(!f)return true;return !disabled.has(f.key)&&!nativeMarketPolicyKeys(m,match).some(k=>disabled.has(k))&&!marketCategories(f.name).some(c=>disabledCategories.has(c))&&!scopeBlocked(f,match);}
export function setCatalogRows(rows){catalog.clear();disabled.clear();for(const r of rows){if(!isFootballMarketName(r.name)||isExcludedOfferMarket({name:r.name,key:r.key}))continue;catalog.set(r.key,{key:r.key,name:r.name,sortOrder:Number(r.sort_order??r.sortOrder??1000000),categories:marketCategories(r.name)});if(r.enabled===false)disabled.add(r.key);}}
export const catalogRows=()=>[...catalog.values()].filter(r=>isFootballMarketName(r.name)&&!isExcludedOfferMarket({name:r.name,key:r.key})).map(r=>{const blockedBy=r.categories.filter(c=>disabledCategories.has(c));return {...r,sortOrder:r.sortOrder??1000000,manualEnabled:!disabled.has(r.key),blockedBy,enabled:!disabled.has(r.key)&&!blockedBy.length};}).sort((a,b)=>a.sortOrder-b.sortOrder||a.name.localeCompare(b.name)).map((r,i)=>({...r,position:i+1}));
export function setCategoryPolicies(rows){disabledCategories.clear();for(const r of rows??[])if(r.enabled===false&&MARKET_CATEGORY_IDS.includes(r.category))disabledCategories.add(r.category);}
export const categoryPolicies=()=>MARKET_CATEGORY_IDS.map(category=>({category,enabled:!disabledCategories.has(category)}));
export function marketRank(m){const f=marketFamily(m);return f?catalog.get(f.key)?.sortOrder??1000000:1000000;}
export const disabledMarkets=()=>[...disabled];
export function setDisabledMarkets(keys){disabled.clear();for(const key of keys??[])if(typeof key==='string')disabled.add(key);}

