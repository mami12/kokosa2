/**
 * Full-time, first-half and second-half goal totals (match and named team).
 * Team identities must be explicit, HT/FT must be internally consistent.
 * Two-way integer lines push; a quoted 3-way exact selection is distinct.
 */
const norm=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
 .toLowerCase().replace(/\b(home|away)team\b/g,'$1 team').replace(/[_:—–-]/g,' ').replace(/\s+/g,' ').trim();
const real=value=>value==null||value===''?null:
 /^[0-9]+(?:[.,][0-9]+)?$/.test(String(value).trim())?
  Number(String(value).replace(',','.')):null;
const score=value=>value!==null&&value!==undefined&&value!==''&&
 Number.isSafeInteger(Number(value))&&Number(value)>=0&&Number(value)<200?Number(value):null;
const aliases=(name,known)=>[
 ['home',['home','home team','team 1',known.home,known.home_team]],
 ['away',['away','away team','team 2',known.away,known.away_team]]
].flatMap(([side,values])=>values.filter(Boolean).map(v=>[side,norm(v)]));
export function isPeriodGoalTotal(line){
 const name=norm(line?.market_name??line?.marketName??line?.name);
 // A correlated offer is never a simple goal total. Otherwise a native
 // Double Chance + Totals quote is held as "unmapped goal total" before
 // its complete two-leg settlement contract can be frozen.
 if(/\b(?:match\s*bet|double chance|result|winner|both teams?|btts|1x2|ht[\s/]*ft|half[\s-]*time|draw|win|wins)\b/.test(name)&&
    /\b(?:and|with|or)\b|&|(?<!\d)\+|\+(?=[a-z])/.test(name))return false;
 // A word-prefix like "goal" must never turn "Goalscorer" into a team
 // goal-total contract: it is an individual-player proposition.
 if(/\b(?:goals?scorers?|scorers?|player|scorer)\b/.test(name))return false;
 if(/\b(?:player|scorer|asian|handicap|minutes?|corners?|cards?|bookings?|shots?|fouls?|tackles?|throw\w*|saves?|offsides?|free\s+kicks?|goal\s+kicks?|penalt\w*|possession|woodwork|substitutions?|result|btts|both|race|next|first goal|last goal|odd|even|clean sheet|no\s+goal)\b|goal\s*\/\s*no\s*goal|gol\s*\/\s*pa\s*gol/.test(name))return false;
 return /\b(?:exact goals?|multigoals?|number of goals?)\b/.test(name)||
  /(?:^|\b)(?:total goals?|goals? total|team [12] goals?|goals?|goal line|over\s*\/\s*under)/.test(name)||
  /^(?:(?:1st|first|2nd|second) half|full time|match)(?:\s+.+)?\s+total$/.test(name)||
  /^(?:half time|halftime)(?:\s+.+)?\s+total(?:\s+\d+(?:[.,]\d+)?)?$/.test(name)||name==='total';
}
export function parsePeriodGoalTotal(line,teams={}){
 if(!isPeriodGoalTotal(line))return null;
 let name=norm(line.market_name??line.marketName??line.name).replace(/[()]/g,' ').replace(/\s+/g,' ').trim();
 // When the title contains "over/under" (e.g. "Total goals over/under (0.5)")
 // the parenthesised number is a decorative label, not the actual line.
 // The authoritative line comes from line.line. Strip the trailing number
 // only when the title does NOT contain over/under.
 const hasOverUnder=/\bover\s*\/?\s*under\b/.test(name);
 const numTitle=name.match(/\s+(\d+(?:[.,]\d+)?)$/);
 const embedded=(numTitle&&!hasOverUnder)?real(numTitle[1]):null;
 if(numTitle)name=name.slice(0,-numTitle[0].length).trim();
 let half=0;
 const pre=name.match(/^(?:1st|first|2nd|second)\s+half\b/);
 const post=name.match(/\b(?:1st|first|2nd|second)\s+half$/);
 const halftime=name.match(/^(?:half time|halftime)\b/);
 if(pre&&post)return null;
 if(pre){
  half=/^(?:1st|first)/.test(pre[0])?1:2;
  name=name.slice(pre[0].length).trim();
 }else if(halftime){
  half=1;
  name=name.slice(halftime[0].length).trim();
 }else if(post){
  half=/^(?:1st|first)/.test(post[0])?1:2;
  name=name.slice(0,-post[0].length).trim();
 }else name=name.replace(/^(?:full time|match)\b/,'').trim();
 const explicit=Number(line.period??0);
 if(![0,1,2].includes(explicit)||half&&explicit&&explicit!==half)return null;
 if(half===0)half=explicit;
 let side=null;
 const sorted=aliases(name,teams).sort((a,b)=>b[1].length-a[1].length);
 for(const [candidate,label]of sorted){
  if(!label)continue;
  if(name.startsWith(label+' ')){
   side=candidate;name=name.slice(label.length).trim();break;
  }
  if(name.endsWith(' '+label)){
   side=candidate;name=name.slice(0,-label.length).trim();break;
  }
 }
 name=name.replace(/^total\s+/,'').replace(/\s+total$/,'').trim();
 // Strip trailing "over/under" or "over under" from compound names like
 // "goals over/under" so the final gate accepts them as plain goal totals.
 name=name.replace(/\s+over\s*\/?\s*under$/,'').trim();
 // Catalogue: "1st half - exact goals", "Exact goals 6+",
 // "2nd half - exact goals 9+", "Total goals (exact)". For these exact-goal
 // menus, the numeric selection is the contract; the title suffix is the
 // provider's catalogue cap, not a minimum-goals condition.
 const exactGroup=name.match(/^(?:exact goals?|goals?\s+exact|multigoals?|number of goals?)(?:\s+\d{1,2}\+)?$/);
 if(exactGroup)name='goals';
 if(!/^(?:goals?|goal line|total|over\s*\/\s*under)$/.test(name))return null;
 const title=norm(line.market_name??line.marketName??'');
 const threeWay=/\b(?:3\s*way|three\s*way|1x2)\b/.test(title);
 // An EXACT goals menu is not an Over/Under menu, even when a stale
 // client supplies an arbitrary O/U label and numeric line.
 const exactOnly=Boolean(exactGroup);
 let label=norm(line.outcome_name??line.outcomeName??line.outcome_key??line.outcomeKey)
  .replace(/\s+goals?$/,'').trim();
 let kind=null,target=null;
 const over=label.match(/^(?:over|mbi)\s*(\d+(?:[.,]\d+)?)?$/);
 const under=label.match(/^(?:under|nen)\s*(\d+(?:[.,]\d+)?)?$/);
 const exact=label.match(/^(?:exact(?:ly)?\s*)?(\d{1,2})$/);
 const more=label.match(/^(\d{1,2})\s*(?:\+|or more)$/);
 const range=label.match(/^(\d{1,2})\s*(?:-|–|—|to|or|\s+)\s*(\d{1,2})$/);
 const stated=real(over?.[1]??under?.[1]);
 const quoted=real(line.line??line.specifier);
 const nums=[embedded,stated,quoted].filter(x=>x!==null);
 if(over||under){
  if(exactOnly||!nums.length||nums.some(n=>n!==nums[0]))return null;
  kind=over?'over':'under';target=nums[0];
 }else if(exact){kind='exact';target=Number(exact[1]);}
 else if(more){kind='atLeast';target=Number(more[1]);}
 else if(range){kind='range';target=[Number(range[1]),Number(range[2])];}
 else return null;
 if(kind==='range'){
  if(target[1]<target[0]||target[1]>100)return null;
 }else if(!Number.isFinite(target)||target<0||target>100||
     !Number.isInteger(target*2))return null;
 return {version:1,kind:'period-goal-total',event:'goal',half,side,threeWay,
  selection:kind,...(kind==='range'?{min:target[0],max:target[1]}:{target})};
}
export function gradePeriodGoalTotal(c,result){
 if(c?.kind!=='period-goal-total'||!result||
    ![0,1,2].includes(c.half)||c.side!=null&&!['home','away'].includes(c.side))return null;
 const [fh,fa,hh,ha]=[result.home_score,result.away_score,
  result.half_home_score,result.half_away_score].map(score);
 if(fh===null||fa===null||c.half&&
    (hh===null||ha===null||hh>fh||ha>fa))return null;
 const home=c.half===1?hh:c.half===2?fh-hh:fh;
 const away=c.half===1?ha:c.half===2?fa-ha:fa;
 const goals=c.side==='home'?home:c.side==='away'?away:home+away;
 if(c.selection==='range')return Number.isSafeInteger(c.min)&&Number.isSafeInteger(c.max)&&
   c.min>=0&&c.max>=c.min?(goals>=c.min&&goals<=c.max?'WON':'LOST'):null;
 if(c.selection==='atLeast')return Number.isSafeInteger(c.target)?
   (goals>=c.target?'WON':'LOST'):null;
 if(c.selection==='exact')return Number.isSafeInteger(c.target)?
   (goals===c.target?'WON':'LOST'):null;
 const target=Number(c.target);
 if(!['over','under'].includes(c.selection)||!Number.isFinite(target)||
    !Number.isInteger(target*2))return null;
 if(goals===target&&Number.isSafeInteger(target))
   return c.threeWay?'LOST':'VOID';
 return (c.selection==='over'?goals>target:goals<target)?'WON':'LOST';
}
