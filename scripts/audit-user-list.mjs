import { classify, hasRequiredSettlementEvidence, gradeLine } from '../server/ledger/settler.mjs';
import { isFootballMarketName } from '../server/market-catalog.mjs';

// We can analyze the market families from the codebase and the pasted markets.
// Let's create an analyzer to categorize them precisely according to user instructions.

const EXCLUDE_REGEX = new RegExp([
  'asian',
  'foul',
  'tackle',
  'throw-in',
  'shot',
  'sub',
  'overtime',
  'over time',
  'extra time',
  'extratime',
  'penalty shootout',
  'ot only',
  'ot & pen',
  'player',
  'goalscorer',
  'scorer',
  'assist',
  'carded',
  'sent off',
  'pass completion',
  'passes'
].join('|'), 'i');

// Non-football sports:
const NON_FOOTBALL = new RegExp([
  '180', 'leg', 'snooker', 'runs', 'session', 'wicket', 'overs', 'set', 'sets', 'game', 'games', 'ace', 'aces',
  'tower', 'kills', 'map', 'maps', 'round', 'rounds', 'pitch', 'hit on', 'tries', 'try', 'dunk', 'quarter',
  'century break', 'frame'
].join('|'), 'i');

console.log('Script initialized');
