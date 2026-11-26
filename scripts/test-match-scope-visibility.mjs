import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {pool} from '../server/db.mjs';
import * as matches from '../server/match-store.mjs';
import * as overrides from '../server/ledger/overrides.mjs';
import {publishedBoard} from '../server/ledger/board-settings-store.mjs';

const db=new PGlite();
await db.exec(LEDGER_SQL);
const originalQuery=pool.query;
pool.query=(...args)=>db.query(...args);
const fixture=(id,country,tournamentId,name)=>({
  match_id:id,sport_id:18,sport_tag:'football',category_slug:country,category_name:country,
  tournament_id:tournamentId,tournament_name:name,home:`Home ${id}`,away:`Away ${id}`,
  service:'PREMATCH',status:'scheduled',active:true,start_at:new Date(Date.now()+3600000),raw:{},
});
try{
  matches.clear();
  matches.upsert([
    fixture(900001,'italy',301,'Serie A'),
    fixture(900002,'italy',303,'Serie C'),
    fixture(900003,'argentina',401,'Primera División'),
  ]);
  await overrides.refresh(true);
  assert.equal((await publishedBoard()).rows.length,3);

  const notifications=[];
  const unsubscribe=overrides.onVisibilityChange(event=>notifications.push(event));
  await overrides.setCompetitionHidden('italy','303',true);
  let rows=(await publishedBoard()).rows;
  assert.deepEqual(rows.map(row=>String(row.match_id)).sort(),['900001','900003']);
  assert.equal(overrides.isMatchHidden(fixture(900004,'italy',303,'Serie C')),
    true,'new fixtures in a hidden league inherit the saved policy');
  assert.equal(matches.getMatches({catalog:true}).length,3,'hiding never deletes feed rows');

  await overrides.setCompetitionHidden('argentina','',true);
  await overrides.setCompetitionHidden('argentina','401',false);
  rows=(await publishedBoard()).rows;
  assert.deepEqual(rows.map(row=>String(row.match_id)).sort(),['900001','900003'],
    'a league explicitly shown remains visible inside a hidden country');

  await overrides.setCompetitionHidden('italy','303',false);
  assert.equal((await publishedBoard()).rows.length,3);
  assert.equal(notifications.length,4);
  unsubscribe();
  console.log('PASS scoped competition visibility: league/country hide, league exception, persistence, future fixtures and feed rows retained');
}finally{
  pool.query=originalQuery;
  matches.clear();
  await db.close();
  await pool.end();
}
