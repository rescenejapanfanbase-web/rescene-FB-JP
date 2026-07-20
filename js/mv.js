(()=>{
  'use strict';
  const data=window.RESCENE_MV||{};
  const items=Array.isArray(data.items)?data.items:[];
  const filterHost=document.getElementById('mvFilters');
  const gallery=document.getElementById('mvGallery');
  const status=document.getElementById('mvStatus');
  const escapeHtml=(value='')=>String(value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const formatDate=value=>String(value||'').replaceAll('-','.');
  let active='all';

  const filterDefinitions=()=>[
    {key:'all',label:'すべて'},
    ...((Array.isArray(data.years)?data.years:[...new Set(items.map(item=>item.year).filter(Boolean))].sort().reverse()).map(year=>({key:String(year),label:String(year)}))),
    {key:'official',label:'OFFICIAL MV'},
    {key:'special',label:'SPECIAL / OST'},
  ];

  function renderFilters(){
    if(!filterHost)return;
    filterHost.innerHTML=filterDefinitions().map(item=>`<button aria-pressed="${item.key===active}" class="filter${item.key===active?' active':''}" data-mv-filter="${escapeHtml(item.key)}" type="button">${escapeHtml(item.label)}</button>`).join('');
    filterHost.querySelectorAll('[data-mv-filter]').forEach(button=>button.addEventListener('click',()=>{
      active=button.dataset.mvFilter||'all';
      renderFilters();
      renderItems();
    }));
  }

  function visibleItems(){
    return items.filter(item=>active==='all'||item.year===active||item.type===active);
  }

  function card(item){
    const note=item.note?`<p class="mv-gallery-note">${escapeHtml(item.note)}</p>`:'';
    return `<a class="card mv-gallery-card" data-mv-year="${escapeHtml(item.year||'')}" data-type="${escapeHtml(item.type||'official')}" href="${escapeHtml(item.url||`https://www.youtube.com/watch?v=${item.videoId||''}`)}" rel="noopener noreferrer" target="_blank" id="${escapeHtml(item.anchor||`mv-${item.videoId||'item'}`)}">
      <div class="mv-gallery-thumb"><img alt="${escapeHtml(item.title||'RESCENE')} thumbnail" loading="lazy" src="${escapeHtml(item.thumbnail||`https://i.ytimg.com/vi/${item.videoId||''}/hqdefault.jpg`)}"/></div>
      <div class="mv-gallery-body"><div class="mv-gallery-meta"><span class="badge">${escapeHtml(item.badge||item.kind||'OFFICIAL MV')}</span></div><h2>${escapeHtml(item.title||'Music Video')}</h2><p>${escapeHtml(formatDate(item.date))}</p>${note}<span class="mv-gallery-link">公式動画を見る ↗</span></div>
    </a>`;
  }

  function renderItems(){
    if(!gallery)return;
    const visible=visibleItems();
    gallery.innerHTML=visible.length?visible.map(card).join(''):'<div class="card mv-empty-state"><h2>該当するMVはありません</h2><p>別のカテゴリーを選択してください。</p></div>';
    if(status){
      const auto=items.filter(item=>item.autoDetected).length;
      status.textContent=`${visible.length}件を表示中 / 全${items.length}件${auto?`（自動検出 ${auto}件）`:''}`;
    }
    window.RESCENE_IMAGE_OPTIMIZER?.refresh?.();
  }

  renderFilters();
  renderItems();
})();
