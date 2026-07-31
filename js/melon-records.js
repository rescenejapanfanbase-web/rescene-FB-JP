(()=>{
  'use strict';

  const STORAGE_KEY='rescene-melon-record-sort';
  const VALID_SORTS=new Set(['release-asc','release-desc','daily-asc','daily-desc']);

  const toDateValue=value=>{
    const timestamp=Date.parse(String(value||''));
    return Number.isFinite(timestamp)?timestamp:0;
  };
  const toRankValue=value=>{
    const rank=Number(value);
    return Number.isFinite(rank)&&rank>0?rank:null;
  };
  const originalIndex=card=>Number(card.dataset.originalIndex||0);

  function compareCards(a,b,mode){
    const releaseA=toDateValue(a.dataset.releaseDate);
    const releaseB=toDateValue(b.dataset.releaseDate);
    const rankA=toRankValue(a.dataset.dailyPeak);
    const rankB=toRankValue(b.dataset.dailyPeak);

    if(mode==='release-desc') return releaseB-releaseA || originalIndex(a)-originalIndex(b);
    if(mode==='daily-asc'){
      if(rankA===null&&rankB!==null)return 1;
      if(rankA!==null&&rankB===null)return -1;
      return (rankA??0)-(rankB??0) || releaseA-releaseB || originalIndex(a)-originalIndex(b);
    }
    if(mode==='daily-desc'){
      if(rankA===null&&rankB!==null)return 1;
      if(rankA!==null&&rankB===null)return -1;
      return (rankB??0)-(rankA??0) || releaseA-releaseB || originalIndex(a)-originalIndex(b);
    }
    return releaseA-releaseB || originalIndex(a)-originalIndex(b);
  }

  function applySort(mode,{save=true}={}){
    const list=document.getElementById('melonRecordList');
    const select=document.querySelector('[data-melon-sort]');
    if(!list||!select)return;
    const normalized=VALID_SORTS.has(mode)?mode:(list.dataset.defaultSort||'release-asc');
    const cards=[...list.querySelectorAll('.melon-record-card')];
    cards.sort((a,b)=>compareCards(a,b,normalized));
    const fragment=document.createDocumentFragment();
    cards.forEach((card,index)=>{
      const number=card.querySelector('.melon-record-index');
      if(number)number.textContent=String(index+1).padStart(2,'0');
      fragment.appendChild(card);
    });
    list.appendChild(fragment);
    select.value=normalized;
    list.dataset.currentSort=normalized;
    if(save){try{localStorage.setItem(STORAGE_KEY,normalized)}catch{}}
    document.dispatchEvent(new CustomEvent('rescene:melon-sorted',{detail:{mode:normalized,count:cards.length}}));
  }

  function initialize(){
    const select=document.querySelector('[data-melon-sort]');
    const list=document.getElementById('melonRecordList');
    if(!select||!list)return;
    let initial=list.dataset.defaultSort||'release-asc';
    try{
      const saved=localStorage.getItem(STORAGE_KEY);
      if(VALID_SORTS.has(saved))initial=saved;
    }catch{}
    select.addEventListener('change',()=>applySort(select.value));
    applySort(initial,{save:false});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});
  else initialize();
})();
