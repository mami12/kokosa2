/**
 * Resolve Zizobet card incidents without guessing from an unlabelled event.
 *
 * Some Zizobet timelines publish the second caution as a generic "card"
 * incident. It is a sending-off only when the same team/player already has
 * an earlier, explicitly yellow card in that same chronology. If player
 * identity or the earlier caution is missing, the colour stays unknown and
 * card-colour settlement remains pending.
 */
const clean = value => String(value ?? '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim();

const describe = value => {
  if (value == null) return '';
  if (typeof value !== 'object') return String(value);
  return [value.color, value.name, value.type, value.description, value.value]
    .filter(v => v != null).join(' ');
};

const cardType = row => clean(row?.type).replace(/\s+/g, '_');
export function isZizobetCardEvent(row) {
  const type = cardType(row);
  return /card|booking|yellow|red/.test(type) ||
    [row?.cardColor, row?.card_color, row?.color, row?.card,
      row?.cardType, row?.card_type].some(v => v != null && String(v).trim() !== '');
}

export function explicitZizobetCardColor(row) {
  const type = cardType(row);
  if (/second_yellow|yellow_red|yellowred/.test(type)) return 'red';
  if (/^(?:yellow_card|yellowcard|card_yellow|booking_yellow)$/.test(type)) return 'yellow';
  if (/^(?:red_card|redcard|card_red|booking_red)$/.test(type)) return 'red';
  const details = [
    row?.cardColor, row?.card_color, row?.color, row?.card,
    row?.cardType, row?.card_type, row?.detail, row?.incidentType,
    row?.incident_type, row?.description
  ].map(describe).join(' ').toLowerCase();
  if (/second[\s_-]*yellow|yellow[\s_-]*red|yellowred/.test(details)) return 'red';
  if (/\bred\b|red[\s_-]*card/.test(details)) return 'red';
  if (/\byellow\b|yellow[\s_-]*card/.test(details)) return 'yellow';
  return null;
}

function playerKey(row) {
  const side = /^(?:1|home|h)$/i.test(String(row?.team ?? '')) ? 'home' :
    /^(?:2|away|a)$/i.test(String(row?.team ?? '')) ? 'away' : null;
  if (!side) return null;
  const idValues = [
    row?.playerId, row?.player_id, row?.actorId, row?.actor_id,
    row?.player?.id, row?.player?.ID, row?.pl?.id, row?.pl?.ID,
    row?.actor?.id, row?.actor?.ID
  ];
  const id = idValues.find(v => v != null && String(v).trim() !== '');
  if (id != null) return side + ':id:' + String(id).trim();
  const names = [row?.pl, row?.player, row?.player_name, row?.playerName, row?.actor]
    .map(describe).map(clean).filter(Boolean);
  return names.length ? side + ':name:' + names[0] : null;
}

function eventMinute(row) {
  const match = String(row?.gt ?? row?.minute ?? row?.time ?? '')
    .trim().match(/^(\d{1,3})(?:\s*\+\s*(\d{1,2}))?$/);
  return match ? Number(match[1]) + Number(match[2] ?? 0) : Number.POSITIVE_INFINITY;
}

export function classifyZizobetCardEvents(rows, match={}) {
  const cardIndices = new Set();
  const colors = new Map();
  const secondYellow = new Set();
  if (!Array.isArray(rows)) return {cardIndices, colors, secondYellow};

  const ordered = rows.map((row, index) => ({row, index, minute:eventMinute(row)}))
    .filter(item => isZizobetCardEvent(item.row))
    .sort((a,b) => a.minute-b.minute || a.index-b.index);
  const cautioned = new Set();
  const dismissed = new Set();

  for (const item of ordered) {
    const {row,index} = item;
    cardIndices.add(index);
    const identity = playerKey(row);
    const explicit = explicitZizobetCardColor(row);
    let color = explicit;

    if (identity && !dismissed.has(identity)) {
      if (explicit === 'yellow') {
        if (cautioned.has(identity)) {
          // The second caution itself is the dismissal event.
          color = 'red';
          secondYellow.add(index);
        } else {
          cautioned.add(identity);
        }
      } else if (explicit == null && cautioned.has(identity)) {
        // Zizobet's generic "card" after this player's first yellow is
        // the second-yellow dismissal, not an unclassified yellow.
        color = 'red';
        secondYellow.add(index);
      }
      if (color === 'red') dismissed.add(identity);
    }
    if (color) colors.set(index, color);
  }

  // Some native timelines omit the actor on the dismissal row. If the
  // provider's separate yellow/red counters leave exactly one possible
  // colour for the unresolved incident(s), use that native reconciliation.
  // Mixed unresolved yellow+red sets remain ambiguous and are not guessed.
  for (const [side,yellowValue,redValue] of [
    ['home',match?.YellowCardsTeam1,match?.RedCardsTeam1],
    ['away',match?.YellowCardsTeam2,match?.RedCardsTeam2]
  ]) {
    const yellowTotal=yellowValue==null||yellowValue===''?null:Number(yellowValue);
    const redTotal=redValue==null||redValue===''?null:Number(redValue);
    if (![yellowTotal,redTotal].every(v=>Number.isSafeInteger(v)&&v>=0))continue;
    const sideIndices=[...cardIndices].filter(index=>
      (/^(?:1|home|h)$/i.test(String(rows[index]?.team??''))?'home':
       /^(?:2|away|a)$/i.test(String(rows[index]?.team??''))?'away':null)===side);
    const knownYellow=sideIndices.filter(index=>colors.get(index)==='yellow').length;
    const knownRed=sideIndices.filter(index=>colors.get(index)==='red').length;
    const unresolved=sideIndices.filter(index=>!colors.has(index));
    const missingYellow=yellowTotal-knownYellow;
    const missingRed=redTotal-knownRed;
    if(missingYellow<0||missingRed<0||
       unresolved.length!==missingYellow+missingRed||!unresolved.length)continue;
    let assignment=null;
    if(missingRed===0)assignment='yellow';
    else if(missingYellow===0)assignment='red';
    else if(unresolved.length===1&&missingRed===1)assignment='red';
    else if(unresolved.length===1&&missingYellow===1)assignment='yellow';
    if(assignment){
      for(const index of unresolved){
        colors.set(index,assignment);
        if(assignment==='red')secondYellow.add(index);
      }
    }
  }
  return {cardIndices, colors, secondYellow};
}
