import assert from 'node:assert/strict';
import { getLinePlacementScore,getLinePlacementLabel } from '../server/ledger/bets.mjs';

// 1. Live 1X2 bet placed when score is 1:0
const goalLine = {
  match_name: 'Arsenal vs Chelsea',
  market_name: '1X2',
  accepted_contract: {
    acceptedLiveSnapshot: {
      isLive: true,
      scoreHome: 1,
      scoreAway: 0,
      counters: {
        goal: { home: 1, away: 0 },
        corner: { home: 3, away: 2 },
        card: { home: 1, away: 0 }
      }
    }
  }
};
assert.equal(getLinePlacementScore(goalLine), '[1:0]');

// 2. Live Corner bet placed when corners are 4:0
const cornerLine = {
  match_name: 'Arsenal vs Chelsea',
  market_name: 'Total Corners Over 9.5',
  accepted_contract: {
    acceptedLiveSnapshot: {
      isLive: true,
      scoreHome: 1,
      scoreAway: 0,
      counters: {
        goal: { home: 1, away: 0 },
        corner: { home: 4, away: 0 },
        card: { home: 1, away: 0 }
      }
    }
  }
};
assert.equal(getLinePlacementScore(cornerLine), '[4:0]');

assert.equal(getLinePlacementLabel(cornerLine),'Kornerat');


// 3. Live Corner bet with 2:2 corners in Albanian (Goditje këndore)
const cornerAlbanianLine = {
  match_name: 'Real Madrid vs Barcelona',
  market_name: 'Goditje këndore - Mbi 8.5',
  accepted_contract: {
    acceptedLiveSnapshot: {
      isLive: true,
      scoreHome: 0,
      scoreAway: 1,
      counters: {
        goal: { home: 0, away: 1 },
        corner: { home: 2, away: 2 },
        card: { home: 0, away: 0 }
      }
    }
  }
};
assert.equal(getLinePlacementScore(cornerAlbanianLine), '[2:2]');

// 4. Live Card bet placed when cards are 1:2
const cardLine = {
  match_name: 'Real Madrid vs Barcelona',
  market_name: 'Total Yellow Cards Over 3.5',
  accepted_contract: {
    acceptedLiveSnapshot: {
      isLive: true,
      scoreHome: 0,
      scoreAway: 1,
      counters: {
        goal: { home: 0, away: 1 },
        corner: { home: 2, away: 2 },
        card: { home: 1, away: 2 }
      }
    }
  }
};
assert.equal(getLinePlacementScore(cardLine), '[1:2]');

assert.equal(getLinePlacementLabel(cardLine),'Kartonat');
assert.equal(getLinePlacementLabel(goalLine),'Golat');


// 5. Unstarted prematch match: should be null (no score displayed before kickoff)
const prematchLine = {
  match_name: 'Liverpool vs Man City',
  market_name: '1X2',
  accepted_contract: {
    acceptedLiveSnapshot: {
      isLive: false,
      feedPhase: 'Not Started',
      scoreHome: 0,
      scoreAway: 0
    }
  }
};
assert.equal(getLinePlacementScore(prematchLine), null);

// 6. Live match placed at 0:0
const liveZeroZero = {
  match_name: 'Liverpool vs Man City',
  market_name: 'Both Teams to Score',
  accepted_contract: {
    acceptedLiveSnapshot: {
      isLive: true,
      feedPhase: 'First Half',
      scoreHome: 0,
      scoreAway: 0,
      counters: {
        goal: { home: 0, away: 0 }
      }
    }
  }
};
assert.equal(getLinePlacementScore(liveZeroZero), '[0:0]');

// 7. Live contract with entryBaseline directly
const baselineLine = {
  match_name: 'Milan vs Inter',
  market_name: 'First Half Corners',
  live_contract: {
    event: 'corner',
    entryBaseline: { home: 3, away: 1 }
  }
};
assert.equal(getLinePlacementScore(baselineLine), '[3:1]');
assert.equal(getLinePlacementLabel(baselineLine),'Kornerat');

console.log('PASS: getLinePlacementScore handles goals, corners [4:0] / [2:2], cards, and prematch correctly');
