import {resolveMarketTitle} from '../zizobet/normalize.mjs';

// Provider identifiers and quoted parameters, not browser translations, define
// dynamic Zizobet contracts. Ordinary static titles retain their existing rules.
const dynamic=/\[[^\]]+\]|\{[^}]+\}|\brace to x\b|\bfirst value\b|\bsecond value\b|\btime range\b|\b\d{1,2}\s+minutes?\s+interval\b/i;
const unsupported=message=>Object.assign(new Error(message),{
  status:400,code:'MARKET_EVIDENCE_UNSUPPORTED'
});
const equalParams=(a,b)=>{
  const aa=Object.keys(a),bb=Object.keys(b);
  return aa.length===bb.length&&aa.every(key=>
    Object.prototype.hasOwnProperty.call(b,key)&&
    JSON.stringify(a[key])===JSON.stringify(b[key]));
};

export function nativeZizobetContractRow(row,{competitors}={}){
  if(!row||String(row.provider_id??'').toUpperCase()!=='ZIZOBET')return row;
  const raw=String(row.native_market_name??'').trim();
  if(!raw)return row;
  // Resolve competitor names from row or caller-supplied override.
  // The accepted_contract snapshot stores homeTeamName/awayTeamName for
  // tickets placed before this fix; use them as the primary source so
  // existing tickets resolve correctly even after a team rename.
  const home=row.homeTeamName??row.home_team??competitors?.competitor1??competitors?.home??null;
  const away=row.awayTeamName??row.away_team??competitors?.competitor2??competitors?.away??null;
  const resolvedCompetitors=home&&away?{competitor1:home,competitor2:away}:undefined;
  // Static market names (no dynamic tokens) can be used directly.  But we
  // must still normalise the display name so team-named rules (e.g. "Dire
  // Dawa to win") resolve with the same label stored at bet-placement.
  if(!dynamic.test(raw)){
    const staticTitle=resolveMarketTitle(raw,{},resolvedCompetitors?{competitors:resolvedCompetitors}:{})??raw;
    return {...row,market_name:staticTitle};
  }
  const key=String(row.market_key??'').match(/^zz(\d+)@([A-Za-z0-9_-]{1,8192})$/);
  if(!key||(row.native_market_id!=null&&String(Number(row.native_market_id))!==key[1]))
    throw unsupported('Identifikuesi origjinal i tregut Zizobet nuk përputhet me kuotën.');
  let params;
  try{params=JSON.parse(Buffer.from(key[2],'base64url').toString('utf8'));}
  catch{throw unsupported('Parametrat origjinalë të tregut Zizobet janë të pavlefshëm.');}
  if(!params||typeof params!=='object'||Array.isArray(params))
    throw unsupported('Parametrat origjinalë të tregut Zizobet mungojnë.');
  const declared=row.native_parameters;
  if(declared!=null&&(!declared||typeof declared!=='object'||Array.isArray(declared)||
      !equalParams(params,declared)))
    throw unsupported('Parametrat e tregut nuk përputhen me ofertën origjinale Zizobet.');
  const quote={...params};
  if(row.line!=null&&String(row.line).trim()!=='')quote.h=row.line;
  // The full-game feed uses a special score placeholder for the remaining
  // match. Its native contract is the score at purchase, never an FT score.
  // Handle both "1st half - correct score [{score}]" and the plain variant.
  const rawId=Number(key[1]);
  const isFirstHalfRest=rawId===18640||/^(?:1st|first)\s+half\s*[-–:]\s*correct\s+score\s+\[\{score\}\]$/i.test(raw);
  const isSecondHalfRest=/^(?:2nd|second)\s+half\s*[-–:]\s*correct\s+score\s+\[\{score\}\]$/i.test(raw);
  const isRestScore=isFirstHalfRest||isSecondHalfRest||rawId===18639||/^correct\s+score\s+\[\{score\}\]$/i.test(raw);
  const template=isRestScore?'Correct score [{score}]':raw;
  const resolveOpts=resolvedCompetitors?{competitors:resolvedCompetitors}:{};
  let canonical=resolveMarketTitle(template,quote,resolveOpts);
  // Preserve half scope for half rest-of-half correct score (nativeMarketId 18640).
  if(isFirstHalfRest&&canonical&&/^Correct score rest of match/i.test(canonical)){
    canonical=canonical.replace(/^Correct score rest of match/i,'1st half - Correct score rest of half');
  }else if(isSecondHalfRest&&canonical&&/^Correct score rest of match/i.test(canonical)){
    canonical=canonical.replace(/^Correct score rest of match/i,'2nd half - Correct score rest of half');
  }
  // A title that still contains unresolved {competitor…} tokens means we have
  // the team names but the template uses a different placeholder key – treat
  // as unsupported so the ticket is held rather than silently mis-graded.
  if(!canonical||/\[[^\]]+\]|\{[^}]+\}|\brace to x\b/i.test(canonical))
    throw unsupported('Mungon parametri i saktë i tregut Zizobet.');
  return {...row,market_name:canonical};
}
