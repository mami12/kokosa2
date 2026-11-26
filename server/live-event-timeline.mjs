import {classifyZizobetCardEvents} from './zizobet/card-events.mjs';

/** Display only provider-timed incidents; reception time is never an event minute. */
export function providerTimeline(matchId,rows,match={}){
 if(!Array.isArray(rows))return undefined;
 const events=new Map();
 const cardEvents=classifyZizobetCardEvents(rows,match);
 for(const [index,row] of rows.entries()){
  if(row.cancelled||row.canceled||row.disabled||row.isConfirmed===false||/cancelled|canceled|voided/i.test(String(row.status??''))){
   if(row.id!=null)events.delete(String(row.id));
   continue;
  }
  const rawTime=String(row.gt??row.minute??row.time??'').trim();
  const clock=rawTime.match(/^(\d{1,3})(?:\s*\+\s*(\d{1,2}))?$/);
  if(!clock)continue;
  const minute=Number(clock[1]);
  let added=Number(clock[2]??row.injury??0);
  const eventClock=String(row.clk??row.clock??'').match(/^(\d{1,3}):([0-5]\d)$/);
  const clockMinute=eventClock?Number(eventClock[1]):null;
  if(added===0&&(minute===45||minute===90)&&clockMinute!==null&&
     clockMinute>minute&&clockMinute<=minute+15)
   added=clockMinute-minute;
  if(minute>120||!Number.isInteger(added)||added<0)continue;
  const team=/^(?:home|h|1)$/i.test(String(row.team))?'home':/^(?:away|a|2)$/i.test(String(row.team))?'away':null;
  if(!team)continue;
  const sourceType=String(row.type??'').toLowerCase();
  const color=cardEvents.colors.get(index);
  const type=sourceType==='score_change'||sourceType==='goal'?'goal':
   sourceType==='corner_kick'||sourceType==='corner'?'corner':
   /yellow/.test(sourceType)||color==='yellow'?'yellow_card':
   /red/.test(sourceType)||color==='red'?'red_card':
   cardEvents.cardIndices.has(index)?'card':
   /foul/.test(sourceType)?'foul':null;
  if(!type)continue;
  const text={goal:'Goal',corner:'Corner',yellow_card:'Yellow card',
   red_card:'Red card',card:'Card (colour unknown)',foul:'Foul'}[type];
  // Zizobet incidents may carry a player as "pl", a structured "player",
  // or an explicit actor label. Preserve only a provider-supplied name:
  // never invent an actor from the team, jersey number or scoreboard.
  const playerName=value=>typeof value==='string'?value.trim():
    value&&typeof value==='object'?String(value.name??value.fullName??value.full_name??'').trim():'';
  const player=[row.pl,row.player,row.player_name,row.playerName,row.actor]
    .map(playerName).find(Boolean)??'';
  const id=String(row.id??[type,minute,added,team,row.pl??row.player??''].join('|'));
  events.set(id,{id,matchId:String(matchId),type,minute,addedMinute:added,minuteLabel:added?minute+'+'+added:String(minute),team,text,...(player?{player}:{})});
 }
 return [...events.values()].sort((a,b)=>a.minute-b.minute||a.addedMinute-b.addedMinute||a.id.localeCompare(b.id));
}

/** Reuse only player labels for the exact same provider incident.
 * An incoming correction owns the event list: removed goals, corners, cards
 * and fouls cannot reappear just because an old snapshot contained a name.
 */
export function inheritEventPlayers(incoming,previous){
 if(!Array.isArray(incoming))return incoming;
 if(!Array.isArray(previous)||!previous.length)return incoming;
 const key=event=>{
  if(event?.id==null||String(event.id)===''||!Number.isFinite(Number(event.minute)))return null;
  return JSON.stringify([String(event.matchId??''),String(event.id),event.type,event.team,Number(event.minute)]);
 };
 const known=new Map();
 for(const event of previous){
  const id=key(event),name=typeof event?.player==='string'?event.player.trim():'';
  if(!id||!name)continue;
  if(known.has(id)&&known.get(id)!==name)known.set(id,null);
  else if(!known.has(id))known.set(id,name);
 }
 return incoming.map(event=>{
  if(typeof event?.player==='string'&&event.player.trim())return event;
  const id=key(event),name=id?known.get(id):null;
  return name?{...event,player:name}:event;
 });
}
