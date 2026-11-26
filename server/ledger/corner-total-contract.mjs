/** Only explicit corner OVER/UNDER totals can use aggregate corner counters.
 * Race, next corner, corner winner and interval markets require event evidence.
 * Never use the sum of both teams for a home/away contract.
 */
const norm=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
export function cornerTotalContract(line={},teams={}){
 let name=norm(line.market_name??line.marketName??line.name);
 if(!/\bcorners?\b/.test(name)||
    /\b(?:race|next|first|last|which|who|most|winner|result|1x2|chance|handicap|asian|odd|even|exact|range|between|minute|minutes|interval|period|half|card|booking|player|extra|time)\b|[&+]/.test(name))return null;
 // Preserve a threshold embedded in the provider market title before stripping it.
 const lineMatch=name.match(/\s*\(?([0-9]+(?:[.,][0-9]+)?)\)?\s*$/);
 const quotedLine=lineMatch?Number(lineMatch[1].replace(',','.')):null;
 // Strip trailing parenthesised/bare numbers and "over/under" (and repetitions)
 name=name.replace(/\s*\(?\d+(?:[.,]\d+)?\)?\s*$/,'')
          .replace(/\s+over\s*\/?\s*under$/,'')
          .replace(/\s*\(?\d+(?:[.,]\d+)?\)?\s*$/,'')
          .replace(/^[ .:-]+|[ .:-]+$/g,'').trim();
 const strip=value=>value.replace(/^\s*[.:-]+\s*|\s*[.:-]+\s*$/g,'').trim();
 const base=value=>/^(?:total corners?|corners? total|corners?|total corner kicks?|corner kicks? total)$/.test(strip(value));
 if(base(name))return {scope:'total',line:quotedLine};
 const home=norm(teams.home_team??teams.homeTeam??teams.home);
 const away=norm(teams.away_team??teams.awayTeam??teams.away);
 for(const [scope,aliases] of [['home',['home team','hometeam','home','team 1','team1','1st team',home]],['away',['away team','awayteam','away','team 2','team2','2nd team',away]]]){
  for(const alias of [...new Set(aliases.filter(Boolean))]){
   if(name.startsWith(alias+' ')&&base(strip(name.slice(alias.length))))return {scope,line:quotedLine};
   if(name.endsWith(' '+alias)&&base(strip(name.slice(0,-alias.length))))return {scope,line:quotedLine};
   if(name.startsWith('total '+alias+' ')&&base('total '+strip(name.slice(('total '+alias).length))))return {scope,line:quotedLine};
   if(name.startsWith('corners '+alias+' ')&&base(strip(name.slice(('corners '+alias).length))))return {scope,line:quotedLine};
  }
 }
 return null;
}
