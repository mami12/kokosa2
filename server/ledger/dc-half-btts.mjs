/**
 * Double Chance & 1st/2nd Half Both Teams to Score.
 * Both conditions must win for the bet to win.
 *
 * "Double chance & 1st half both teams score"
 * "Double chance & 2nd half both teams score"
 *
 * Outcomes like "1X & Yes", "12 & No", "X2 & Yes" etc.
 */
const fold=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
 .toLowerCase().replace(/[^a-z0-9&/]+/g,' ').trim();
const int=v=>v!=null&&v!==''&&Number.isSafeInteger(Number(v))&&
 Number(v)>=0&&Number(v)<=200?Number(v):null;

export function isDcHalfBttsMarket(name='') {
 return /^double\s*chance(?:\s*\([^)]*\))?\s*(?:&|and)\s*(?:1st|first|2nd|second)\s+half\s+both\s+teams?\s+(?:to\s+)?score/i.test(
  String(name).trim());
}

export function gradeDcHalfBtts(line,result) {
 const name=String(line?.market_name??'');
 if(!isDcHalfBttsMarket(name))return null;
 const isFirst=/(?:1st|first)\s+half/i.test(name);
 const isSecond=/(?:2nd|second)\s+half/i.test(name);
 if(!isFirst&&!isSecond)return null;
 const fh=int(result?.home_score),fa=int(result?.away_score);
 const hh=int(result?.half_home_score),ha=int(result?.half_away_score);
 if(fh===null||fa===null||hh===null||ha===null)return null;
 if(hh>fh||ha>fa)return null;
 const h2=fh-hh,a2=fa-ha;
 const halfH=isFirst?hh:h2,halfA=isFirst?ha:a2;
 const btts=halfH>0&&halfA>0;

 // Parse outcome: "1X & Yes", "12 and No", "X2 & Yes"
 const raw=fold(line.outcome_name??line.outcome_key??'');
 // Split on " & " or " and "
 const parts=raw.split(/\s*(?:&|and)\s*/);
 if(parts.length!==2)return null;
 const dcPart=parts[0].replace(/\s+/g,''),bttsPart=parts[1];
 let dcWon;
 if(dcPart==='1x'||dcPart==='x1')dcWon=fh>=fa;
 else if(dcPart==='12'||dcPart==='21')dcWon=fh!==fa;
 else if(dcPart==='x2'||dcPart==='2x')dcWon=fa>=fh;
 else if(/home.*draw|draw.*home/.test(dcPart))dcWon=fh>=fa;
 else if(/home.*away|away.*home/.test(dcPart))dcWon=fh!==fa;
 else if(/away.*draw|draw.*away/.test(dcPart))dcWon=fa>=fh;
 else return null;
 let bttsWon;
 if(/^(?:yes|po|gg)$/.test(bttsPart))bttsWon=btts;
 else if(/^(?:no|jo|ng)$/.test(bttsPart))bttsWon=!btts;
 else return null;
 return dcWon&&bttsWon?'WON':'LOST';
}
