/**
 * HT/FT compound markets — Halftime/Fulltime combined with a second condition:
 *
 *  - "Halftime/Fulltime & 1st half total goals"  — HT/FT + 1H total
 *  - "Halftime/fulltime & total goals"            — HT/FT + FT total
 *  - "Halftime/fulltime & exact goals"            — HT/FT + exact FT goal count
 *  - "Halftime/Fulltime correct score"            — HT/FT + FT correct score
 *  - "Halftime/fulltime & both teams to score"    — HT/FT + BTTS
 *  - "Corners Halftime/Fulltime"                  — corner-based HT/FT
 *
 * Both conditions must win for the bet to win.
 */
import {isHtFtMarket,parseHtFtOutcome,gradeHtFt} from './ht-ft.mjs';

const int=v=>v!=null&&v!==''&&Number.isSafeInteger(Number(v))&&
 Number(v)>=0&&Number(v)<=200?Number(v):null;

export function isHtFtComboMarket(name='') {
 const n=String(name).trim();
 if(isHtFtMarket(n)&&/\b(?:correct score|exact goals?|total goals?|both teams?|btts)\b/i.test(n))return true;
 // "Corners Halftime/Fulltime"
 if(/\bcorners?\b/i.test(n)&&isHtFtMarket(n))return true;
 return false;
}

export function isCornersHtFtMarket(name='') {
 return /\bcorners?\b/i.test(name)&&isHtFtMarket(name)&&
  !/\b(?:correct score|exact goals?|total goals?|both teams?|btts)\b/i.test(name);
}

export function gradeHtFtCombo(line,result) {
 const name=String(line?.market_name??'');

 // --- Corners Halftime/Fulltime ---
 if(isCornersHtFtMarket(name)){
  return null;
 }

 // --- HT/FT with second condition ---
 const hh=int(result?.half_home_score),ha=int(result?.half_away_score);
 const fh=int(result?.home_score),fa=int(result?.away_score);
 if(hh===null||ha===null||fh===null||fa===null)return null;
 if(hh>fh||ha>fa)return null;

 const raw=String(line?.outcome_name??line?.outcome_key??'').trim();

 const isHalf1Total=/1st\s+half\s+total/i.test(name);
 const isFtTotal=/\btotal\s+goals\b/i.test(name)&&!isHalf1Total;
 const isExact=/\bexact\s+goals?\b/i.test(name);
 const isCorrectScore=/\bcorrect\s+score\b/i.test(name);
 const isBtts=/\b(?:both\s+teams?\s+(?:to\s+)?score|btts)\b/i.test(name);

 // 1) CORRECT SCORE
 if(isCorrectScore){
  // Format 1: "1/1 2:1" (HT/FT 1X2 + FT score)
  const mHtftCs = raw.match(/^([12xX][/\\-][12xX])\s+(\d+)\s*[-:]\s*(\d+)$/);
  if(mHtftCs){
   const htftOption=parseHtFtOutcome(mHtftCs[1]);
   const htftGrade=gradeHtFt(htftOption,hh,ha,fh,fa);
   if(htftGrade!=='WON')return 'LOST';
   return fh===Number(mHtftCs[2])&&fa===Number(mHtftCs[3])?'WON':'LOST';
  }

  // Format 2: "1-0 1-0", "1-0 / 4+", "4+ / 4+", "0-3 / 4+", "0-0 0-0", "1:0 / 2:1"
  const mScores = raw.match(/^(\d+\s*[-:]\s*\d+|\d+\+)\s*(?:[/\\|&]\s*|\s+(?:and|&)\s+|\s+)(\d+\s*[-:]\s*\d+|\d+\+)$/i);
  if(mScores){
   const htPart = mScores[1].replace(/\s+/g, '');
   const ftPart = mScores[2].replace(/\s+/g, '');

   let htWon;
   if(htPart.endsWith('+')){
    const min = Number(htPart.slice(0, -1));
    htWon = (hh + ha) >= min;
   } else {
    const [h, a] = htPart.split(/[-:]/).map(Number);
    htWon = (hh === h && ha === a);
   }

   let ftWon;
   if(ftPart.endsWith('+')){
    const min = Number(ftPart.slice(0, -1));
    ftWon = (fh + fa) >= min;
   } else {
    const [h, a] = ftPart.split(/[-:]/).map(Number);
    ftWon = (fh === h && fa === a);
   }

   return (htWon && ftWon) ? 'WON' : 'LOST';
  }

  return null;
 }

 // 2) EXACT GOALS
 if(isExact){
  // Format: "1/1 - 1", "2/2 - 5+", "1/1 & 3", "1/1 and 4"
  const m = raw.match(/^([12xX][/\\-][12xX])\s*(?:and|&|-)\s*(.+)$/i);
  if(m){
   const htftOption=parseHtFtOutcome(m[1]);
   const htftGrade=gradeHtFt(htftOption,hh,ha,fh,fa);
   if(htftGrade!=='WON')return 'LOST';

   const condPart=m[2].trim();
   const targetGoals=isHalf1Total?hh+ha:fh+fa;

   if(condPart.endsWith('+')){
    const min=Number(condPart.slice(0,-1));
    return targetGoals>=min?'WON':'LOST';
   }
   const exact=Number(condPart);
   if(Number.isFinite(exact)){
    return targetGoals===exact?'WON':'LOST';
   }
   return null;
  }
  return null;
 }

 // 3) BTTS: "1/1 & Yes", "1/1 and No", "X/1 & GG"
 if(isBtts){
  const m = raw.match(/^([12xX][/\\-][12xX])\s*(?:and|&|-)\s*(.+)$/i);
  if(m){
   const htftOption=parseHtFtOutcome(m[1]);
   const htftGrade=gradeHtFt(htftOption,hh,ha,fh,fa);
   if(htftGrade!=='WON')return 'LOST';

   const condPart=m[2].trim().toLowerCase();
   const bttsActual=(fh>0&&fa>0);
   if(/^(?:yes|po|gg)$/.test(condPart))return bttsActual?'WON':'LOST';
   if(/^(?:no|jo|ng)$/.test(condPart))return !bttsActual?'WON':'LOST';
   return null;
  }
  return null;
 }

 // 4) TOTAL GOALS (OVER / UNDER)
 // Split on " and " or " & " or " - "
 const andM = raw.match(/^([12xX][/\\-][12xX])\s*(?:and|&|-)\s*(.+)$/i);
 if(!andM) return null;

 const htftPart = andM[1].trim();
 const condPart = andM[2].trim();

 const htftOption=parseHtFtOutcome(htftPart,htftPart);
 const htftGrade=gradeHtFt(htftOption,hh,ha,fh,fa);
 if(htftGrade!=='WON')return 'LOST';

 const targetGoals=isHalf1Total?hh+ha:fh+fa;

 // Check condPart for Over / Under
 const ouM = condPart.match(/^(over|under)(?:\s*(\d+(?:[.,]\d+)?))?$/i);
 if(ouM){
  const side = ouM[1].toLowerCase();
  let threshold = ouM[2] ? Number(ouM[2].replace(',', '.')) : NaN;
  if(!Number.isFinite(threshold) && line?.line != null && line.line !== ''){
   threshold = Number(line.line);
  }
  if(!Number.isFinite(threshold)){
   const mName = name.match(/\((\d+(?:\.\d+)?)\)/);
   if(mName) threshold = Number(mName[1]);
  }
  if(!Number.isFinite(threshold)) return null;
  if(targetGoals === threshold) return 'LOST';
  return (side === 'over' ? targetGoals > threshold : targetGoals < threshold) ? 'WON' : 'LOST';
 }

 return null;
}
