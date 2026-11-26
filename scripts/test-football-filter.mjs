import { query } from '../server/db.mjs';

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

async function testFilter() {
  const r = await query('select key, name from app_market_catalog');
  const all = r.rows;
  
  const football = [];
  const nonFootball = [];

  for (const m of all) {
    if (NON_FOOTBALL_PATTERN.test(m.name)) {
      nonFootball.push(m.name);
    } else {
      football.push(m.name);
    }
  }

  console.log(`Total: ${all.length}`);
  console.log(`Non-football filtered: ${nonFootball.length}`);
  console.log(`Football kept: ${football.length}`);

  // Let's check if any real football market was accidentally put into nonFootball
  const falsePositives = nonFootball.filter(name => 
    /\b(?:goal|goals|corner|corners|cards?|booking|fouls?|halftime|fulltime|half|btts|1x2|draw no bet|clean sheet|offside|handicap|penalty shootout)\b/i.test(name) &&
    !/\b(?:quarter|set|frame|innings?|map|points?|touchdown|puck|wicket|runs?|period)\b/i.test(name)
  );

  console.log(`\nPotential False Positives: ${falsePositives.length}`);
  if (falsePositives.length > 0) {
    console.log(falsePositives);
  }
}

testFilter().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
