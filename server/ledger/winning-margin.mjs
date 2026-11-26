/**
 * Winning margin market: grade by the goal-difference between teams.
 * Supports full-time and 1st half variants.
 *
 * Provider outcomes vary:
 *   "1", "2", "3" — exact margin (either team)
 *   "2+", "3+" — margin of at least N
 *   "Draw" / "0" — no margin (draw)
 *   "Home by 1", "Away by 2" — team + exact margin
 *   "Home 1-0", "1-3" — NOT correct scores, just margin notation
 *   "1 - 2 goals" — band notation
 */
const int=v=>v!=null&&v!==''&&Number.isSafeInteger(Number(v))&&
 Number(v)>=0&&Number(v)<=200?Number(v):null;
const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
 .toLowerCase().replace(/\b(home|away)team\b/g,'$1 team')
 .replace(/[^a-z0-9+]+/g,' ').trim();

export function isWinningMarginMarket(line={}) {
 const n=String(line.market_name??line.marketName??'').toLowerCase().trim();
 return /(?:^|\s)winning\s+margins?(?:\s|$)/i.test(n);
}

export function gradeWinningMargin(line,result) {
 const fh=int(result?.home_score),fa=int(result?.away_score);
 if(fh===null||fa===null)return null;
 const marketName=String(line.market_name??'');
 const isHalf=/1st\s+half/i.test(marketName);
 let h=fh,a=fa;
 if(isHalf){
  h=int(result?.half_home_score);a=int(result?.half_away_score);
  if(h===null||a===null)return null;
 }
 const margin=Math.abs(h-a);
 const winner=h>a?'home':a>h?'away':'draw';
 let raw=norm(line.outcome_name??line.outcome_key??'');
 const homeName=norm(result?.home_team);
 const awayName=norm(result?.away_team);
 if(homeName&&raw.startsWith(homeName)){
  raw=('home'+raw.slice(homeName.length)).trim();
 }else if(awayName&&raw.startsWith(awayName)){
  raw=('away'+raw.slice(awayName.length)).trim();
 }
 // "draw" / "0" / "tie" / "no win"
 if(/^(?:draw|tie|0|no win)$/.test(raw))return winner==='draw'?'WON':'LOST';
 if(/^(?:any other result|other)$/.test(raw)){
  // If margin is 0 (draw) or 1 or 2, any other result is LOST
  return margin>2?'WON':'LOST';
 }
 // "X+" — at least X (either team)
 const plusM=raw.match(/^(\d+)\s*\+$/);
 if(plusM)return winner!=='draw'&&margin>=Number(plusM[1])?'WON':'LOST';
 // "X - Y goals" — band, e.g. "1 - 2 goals" (norm replaces '-' with space: "1 2 goals")
 const bandM=raw.match(/^(\d+)\s*(?:-|to)?\s*(\d+)(?:\s*goals?)?$/);
 if(bandM){
  const lo=Number(bandM[1]),hi=Number(bandM[2]);
  return winner!=='draw'&&margin>=lo&&margin<=hi?'WON':'LOST';
 }
 // "home by X - Y" / "away by X - Y" (norm: "home by 1 2")
 const sideBandM=raw.match(/^(home|away)\s*(?:by\s*)?(\d+)\s*(?:-|to)?\s*(\d+)$/);
 if(sideBandM){
  const side=sideBandM[1],lo=Number(sideBandM[2]),hi=Number(sideBandM[3]);
  return winner===side&&margin>=lo&&margin<=hi?'WON':'LOST';
 }
 // "home by X" / "away by X" / "home X" / "away X"
 const sideM=raw.match(/^(home|away)(?:\s+(?:team\s+)?(?:(?:win(?:s)?|by)\s+)?)?(\d+)\s*(\+)?$/);
 if(sideM){
  const side=sideM[1],n=Number(sideM[2]),plus=!!sideM[3];
  if(plus)return winner===side&&margin>=n?'WON':'LOST';
  return winner===side&&margin===n?'WON':'LOST';
 }
 // reversed: "X home" / "X away"
 const revM=raw.match(/^(\d+)\s*(\+)?\s*(home|away)$/);
 if(revM){
  const n=Number(revM[1]),plus=!!revM[2],side=revM[3];
  if(plus)return winner===side&&margin>=n?'WON':'LOST';
  return winner===side&&margin===n?'WON':'LOST';
 }
 // Plain "X" — exact margin (either team)
 const plainN=raw.match(/^(\d+)$/);
 if(plainN)return margin===Number(plainN[1])?'WON':'LOST';
 return null;
}
