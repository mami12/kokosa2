/**
 * Global offer policy. Exclusions apply before publication and at acceptance.
 * Historical ticket terms remain immutable; player contracts are never auto-settled.
 */
const clean=value=>String(value??'').normalize('NFD')
 .replace(/[\u0300-\u036f]/g,'').toLowerCase()
 .replace(/[_–—]+/g,' ').replace(/\s+/g,' ').trim();
const titlesOf=market=>[
 market?.marketName,market?.market_name,market?.name,
 market?.nativeMarketName,market?.native_market_name,
 market?.accepted_contract?.providerMarketName,
 market?.accepted_contract?.nativeMarketName
].map(clean).filter(Boolean);
const nativeParams=market=>market?.nativeParameters??market?.native_parameters??
 market?.accepted_contract?.nativeParameters??market?.accepted_contract?.native_parameters??
 market?.parameters??{};
const hasPlayerParameter=market=>{
 const params=nativeParams(market);
 const direct=[market?.player,market?.pl,params?.pl,params?.player,
  market?.accepted_contract?.nativeParameters?.pl];
 if(direct.some(v=>v!=null&&String(v).trim()!==''))return true;
 // Older odds rows may have retained the native parameter only in the
 // provider-key payload. Decode that exact Zizobet identity as a final guard.
 const encoded=String(market?.market_key??market?.marketKey??market?.extId??market?.key??market?.accepted_contract?.providerMarketKey??'').match(/^zz\d+@([A-Za-z0-9_-]+)$/)?.[1];
 if(!encoded)return false;
 try{
  const base64=encoded.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(encoded.length/4)*4,'=');
  const decoded=atob(base64);
  const bytes=Uint8Array.from(decoded,char=>char.charCodeAt(0));
  return !!JSON.parse(new TextDecoder().decode(bytes))?.pl;
 }catch{return false;}
};
const PLAYER_WORDS=/\b(?:player|players|goalscorer|goal scorer|top scorer|scorer|assist|assists|goalkeeper|goal keeper|lojtar\w*|shenues\w*|asist\w*)\b|\{pl\}/i;
const NAMED_PLAYER=/^[\p{L}][\p{L}'-]{1,35},\s*[\p{L}][\p{L}'-]{1,35}/u;
const UNSUPPORTED_STATS=/\b(?:fouls?|faull\w*|shots?|tackles?|nderhyrje\w*|throw[ -]?ins?|rivenie\w*|saves?|pritje\w*|cards?|karton\w*|carded|booked|bookings?|bookingbets?|sent\s+off|sending\s+off|offsides?|scoring\s*types?)\b|\{!?scorenr\}/i;
export function isPlayerOfferMarket(market){
 if(!market)return false;
 const builder=market?.builder_legs??market?.builderLegs??
  market?.accepted_contract?.builderLegs??market?.accepted_contract?.builder_legs;
 if(Array.isArray(builder)&&builder.some(isPlayerOfferMarket))return true;
 const type=clean(market?.marketType??market?.market_type??market?.category??'');
 return /^(?:player|players|player prop|player props|scorer|lojtar\w*)$/.test(type)||
  hasPlayerParameter(market)||titlesOf(market).some(title=>PLAYER_WORDS.test(title)||NAMED_PLAYER.test(title));
}
export function isRetiredPlayerOfferMarket(market){
 const type=clean(market?.marketType??market?.market_type??market?.category??
  market?.column??market?.board_column??'');
 const unsupportedType=/^(?:fouls?|faull\w*|players?|lojtar\w*|player props?|tackles?|throw[ -]?ins?|saves?|handicap|handikap\w*)$/.test(type);
 return unsupportedType||isPlayerOfferMarket(market)||
  titlesOf(market).some(title=>UNSUPPORTED_STATS.test(title)||NAMED_PLAYER.test(title))||isHandicapOfferMarket(market);
}
export const isHandicapOfferMarket=market=>
 titlesOf(market).some(title=>/\b(?:asian\s+)?handicap\b|\bhandikap\w*\b|\bfora\b/i.test(title));
export const isEarlyPayoutOfferMarket=market=>{
 const key=String(market?.market_key??market?.marketKey??market?.extId??market?.key??'');
 const nativeId=String(market?.native_market_id??market?.nativeMarketId??
  key.match(/^zz(\d+)@/)?.[1]??key.match(/^zizobet:(?:live|prematch):(\d+)$/i)?.[1]??'');
 return titlesOf(market).some(title=>/1x2\s*\(xup\)|early\s*payout/.test(title))||nativeId==='27073';
};
export const isExcludedOfferMarket=market=>
 isHandicapOfferMarket(market)||isEarlyPayoutOfferMarket(market)||
 isRetiredPlayerOfferMarket(market);
