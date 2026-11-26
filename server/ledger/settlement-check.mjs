/**
 * Only quote snapshots that are still provider-active and inside their
 * server-computed freshness window may be used by the bulk settlement test.
 * This check is deliberately independent from display visibility.
 */
export function isCurrentSettlementCheckQuote(market,outcome,now=Date.now()){
 if(!market||market.status!=='ACTIVE'||market.suspended===true)return false;
 if(!outcome||outcome.status!=='ACTIVE'||outcome.decided===true||
    outcome.quoteSuspended===true||outcome.feedSuspended===true||
    outcome.riskSuspended===true)return false;
 const odds=Number(outcome.odds);
 if(!Number.isFinite(odds)||odds<=1)return false;
 const deadline=outcome.priceValidUntil==null?NaN:Number(outcome.priceValidUntil);
 if(!Number.isFinite(deadline)||deadline<=now)return false;
 return true;
}
