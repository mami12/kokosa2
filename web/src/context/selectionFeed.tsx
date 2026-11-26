import {createContext,useContext,useSyncExternalStore} from 'react';
import type {BetSelection} from '../types';
import {selectionConflictWithSlip} from '../../../server/ledger/selection-market.mjs';

type SelectionCandidate = BetSelection;

export function createSelectionStore(){
  let ids=new Set<string>(),values:BetSelection[]=[],signature='';
  const listeners=new Set<()=>void>();
  return {
    has:(id:string)=>ids.has(id),
    conflictFor:(candidate:SelectionCandidate)=>selectionConflictWithSlip(candidate as BetSelection,values)?.message??null,
    subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};},
    publish(nextValues:BetSelection[]){
      const nextSignature=JSON.stringify(nextValues.map(s=>[
        s.outcomeId,s.matchId,s.marketId,s.extId,s.marketKey,s.marketName,s.nativeMarketName,s.marketType,s.marketLine,
        s.outcomeName,s.outcomeCode,s.period,s.matchSnapshot?.status
      ]));
      if(nextSignature===signature)return;
      signature=nextSignature;
      values=nextValues;
      ids=new Set(nextValues.map(s=>s.outcomeId));
      listeners.forEach(fn=>fn());
    }
  };
}

const defaultStore=createSelectionStore();
export const SelectionFeedContext=createContext({
  store:defaultStore,
  conflictFor:(_candidate:SelectionCandidate):string|null=>null,
  addSelection:(_s:BetSelection)=>{},
  removeSelection:(_id:string)=>{}
});

export function useOutcomeSelection(id:string,candidate?:SelectionCandidate){
  const context=useContext(SelectionFeedContext);
  const selected=useSyncExternalStore(context.store.subscribe,()=>context.store.has(id),()=>false);
  const conflictMessage=useSyncExternalStore(
    context.store.subscribe,
    ()=>candidate?context.conflictFor(candidate):null,
    ()=>null
  );
  return {
    isSelected:selected,
    conflictMessage,
    addSelection:context.addSelection,
    removeSelection:context.removeSelection
  };
}
