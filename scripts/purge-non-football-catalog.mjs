import { query } from '../server/db.mjs';
import { isFootballMarketName } from '../server/market-catalog.mjs';

async function purge() {
  const r = await query('select key, name from app_market_catalog');
  console.log('Current rows in app_market_catalog:', r.rows.length);

  const toRemove = r.rows.filter(row => !isFootballMarketName(row.name));
  console.log(`Found ${toRemove.length} non-football markets to remove.`);

  if (toRemove.length > 0) {
    const keys = toRemove.map(row => row.key);
    // Delete in chunks of 500
    for (let i = 0; i < keys.length; i += 500) {
      const chunk = keys.slice(i, i + 500);
      await query('delete from app_market_catalog where key = any($1::text[])', [chunk]);
    }
    console.log(`Successfully deleted ${toRemove.length} non-football markets.`);
  }

  const remaining = await query('select count(*) from app_market_catalog');
  console.log('Remaining football markets in app_market_catalog:', remaining.rows[0].count);
}

purge().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
