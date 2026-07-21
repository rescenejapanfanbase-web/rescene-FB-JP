(()=>{
 const payload=window.RESCENE_CHANTS;
 const filterHost=document.getElementById('chantFilters');
 const listHost=document.getElementById('chantList');
 const statusHost=document.getElementById('chantSyncStatus');
 if(!filterHost||!listHost)return;
 let active='all';
 const escapeHtml=(value='')=>String(value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
 const safeUrl=value=>/^https?:\/\//i.test(String(value||''))?String(value):'';
 const sourceLabel=type=>type==='公式'?'公式':type==='非公式'?'非公式':'動画なし';
 const card=item=>{
  const image=escapeHtml(item.image||'');
  const video=safeUrl(item.videoUrl);
  const type=item.videoType||'なし';
  const action=video?`<div class="chant-actions"><a href="${escapeHtml(video)}" rel="noopener noreferrer" target="_blank">${escapeHtml(item.buttonLabel||(type==='公式'?'公式掛け声動画を見る':'掛け声動画を見る'))} ↗</a></div>`:`<p class="chant-no-video">動画リンクは登録されていません。</p>`;
  const favorite=window.RESCENE_FAVORITES?.button({type:'chants',id:item.slug||item.anchor||item.title,label:`${item.title||'掛け声'}をお気に入り`})||'';
  const note=item.note?`<p class="chant-source-note">${escapeHtml(item.note)}</p>`:'';
  return `<details class="chant-card card" data-chant-category="${escapeHtml(item.categoryKey||'other')}" id="${escapeHtml(item.anchor||`chant-${item.slug||'item'}`)}"><summary><span class="chant-summary-thumb"><img alt="${escapeHtml(item.title||'掛け声')} 掛け声画像" loading="lazy" src="${image}"></span><span class="chant-summary-copy"><strong class="chant-song-title">${escapeHtml(item.title||'タイトル未設定')}</strong><span class="chant-meta">${escapeHtml(item.album||item.categoryTitle||'FAN CHANT')}</span><span class="chant-source-badge is-${type==='公式'?'official':type==='非公式'?'unofficial':'none'}">${escapeHtml(sourceLabel(type))}</span><span class="chant-summary-link">掛け声を見る →</span></span></summary><div><div class="chant-gallery"><figure class="chant-figure"><img alt="${escapeHtml(item.title||'掛け声')} 掛け声画像" loading="lazy" src="${image}"></figure></div>${note}${action}<div class="card-utility-row">${favorite}</div></div></details>`;
 };
 const renderFilters=()=>{
  const categories=Array.isArray(payload?.categories)?payload.categories:[];
  filterHost.innerHTML=[{key:'all',title:'ALL'},...categories].map(category=>`<button class="chant-filter${category.key===active?' is-active':''}" data-chant-filter="${escapeHtml(category.key)}" type="button">${escapeHtml(category.title)}</button>`).join('');
  filterHost.querySelectorAll('[data-chant-filter]').forEach(button=>button.addEventListener('click',()=>{active=button.dataset.chantFilter||'all';render();}));
 };
 const render=()=>{
  if(!payload||!Array.isArray(payload.chants)){
   listHost.innerHTML='<div class="card notice"><strong>掛け声データを読み込めませんでした</strong><p>ページを再読み込みしてください。</p></div>';return;
  }
  renderFilters();
  const items=payload.chants.filter(item=>active==='all'||item.categoryKey===active);
  listHost.innerHTML=items.length?items.map(card).join(''):'<div class="card notice"><strong>公開中のガイドはありません</strong><p>Notionで「公開」にチェックすると表示されます。</p></div>';
  statusHost.textContent=`公開ガイド ${payload.chants.length}件・最終同期 ${payload.generatedAt?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(payload.generatedAt)):'未取得'}`;
  window.RESCENE_FAVORITES?.bind(listHost);document.dispatchEvent(new CustomEvent('rescene:content-rendered'));
  requestAnimationFrame(()=>{
   const id=decodeURIComponent(location.hash.slice(1));
   const target=id&&document.getElementById(id);
   if(target){target.open=true;target.scrollIntoView({block:'start'});}
  });
 };
 render();
})();
