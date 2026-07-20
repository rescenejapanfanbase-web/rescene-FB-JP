(()=>{
 'use strict';
 const filterHost=document.getElementById('discographyFilters');
 const contentHost=document.getElementById('discographyContent');
 const statusHost=document.getElementById('discographyStatus');
 let payload=window.RESCENE_DISCOGRAPHY||null;
 let active='all';
 const escapeHtml=(value='')=>String(value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
 const safeUrl=(value='')=>{
  const text=String(value||'').trim();
  if(!text)return '';
  if(/^https?:\/\/[^\s<>\"']+$/i.test(text))return text;
  return /^(?:\.\/|\.\.\/|\/)?[0-9A-Za-z_./%~-]+(?:\?[0-9A-Za-z_=&%+.,~-]*)?(?:#[0-9A-Za-z_-]+)?$/i.test(text)?text:'';
 };
 const formatDate=value=>String(value||'').slice(0,10).replaceAll('-','.');
 const releaseCard=release=>{
  const cover=safeUrl(release.cover);
  const coverHtml=cover?`<div class="release-cover"><img src="${escapeHtml(cover)}" alt="${escapeHtml(release.title)} ジャケット" loading="lazy"></div>`:'';
  const tracks=(Array.isArray(release.tracks)?release.tracks:[]).map((track,index)=>{
   const video=safeUrl(track.video);
   const action=video?`<a aria-label="${escapeHtml(track.title)} YouTube" class="track-video" href="${escapeHtml(video)}" rel="noopener noreferrer" target="_blank">▶</a>`:(track.note?`<span class="track-note">${escapeHtml(track.note)}</span>`:'');
   return `<li><span class="track-no">${escapeHtml(track.no||String(index+1).padStart(2,'0'))}</span><span class="track-title">${escapeHtml(track.title||'曲名未設定')}</span>${action}</li>`;
  }).join('');
  const actions=[];
  const apple=safeUrl(release.appleMusic); const spotify=safeUrl(release.spotify);
  if(apple)actions.push(`<a class="release-link" href="${escapeHtml(apple)}" rel="noopener noreferrer" target="_blank"><img alt="" src="assets/platform-icons/apple-music.png">Apple Music ↗</a>`);
  if(spotify)actions.push(`<a class="release-link" href="${escapeHtml(spotify)}" rel="noopener noreferrer" target="_blank"><img alt="" src="assets/platform-icons/spotify.png">Spotify ↗</a>`);
  return `<article class="card release-card${cover?' has-cover':''}" id="${escapeHtml(release.anchor||`release-${release.slug||'item'}`)}">${coverHtml}<div class="release-card-body"><div class="release-mark">${escapeHtml(release.mark||'RS')}</div><div class="release-meta"><span class="badge">${escapeHtml(release.badge||release.categoryName||'RELEASE')}</span><time datetime="${escapeHtml(release.releaseDate||'')}">${escapeHtml(formatDate(release.releaseDate))}</time></div><span class="release-type">${escapeHtml(release.type||release.categoryName||'RELEASE')}</span><div class="release-headline"><div><h2>${escapeHtml(release.title||'タイトル未設定')}</h2></div></div>${release.description?`<p class="release-desc">${escapeHtml(release.description)}</p>`:''}${tracks?`<ul class="track-list">${tracks}</ul>`:''}${actions.length?`<div class="release-actions">${actions.join('')}</div>`:''}</div></article>`;
 };
 const categorySection=category=>{
  const releases=(payload.releases||[]).filter(item=>item.category===category.key);
  const cards=releases.length?`<div class="release-grid">${releases.map(releaseCard).join('')}</div>`:`<div class="card release-empty"><span class="section-kicker">COMING SOON</span><h3>公開作品はまだありません</h3><p>Notionで作品を追加し「公開」にチェックすると、ここへ自動表示されます。</p></div>`;
  return `<section class="discography-category${active==='all'||active===category.key?' is-filtered-in':''}" data-disc-category="${escapeHtml(category.key)}" id="${escapeHtml(category.key==='special'?'special-single':category.key==='mini'?'mini-album':category.key==='full'?'full-album':category.key==='single'?'single-album':'ost')}"${active!=='all'&&active!==category.key?' hidden':''}><div class="category-head"><div><span class="section-kicker">${escapeHtml(category.kicker)}</span><h2>${escapeHtml(category.title)}</h2><p>${escapeHtml(category.description)}</p></div><span class="category-count">${releases.length} RELEASE${releases.length===1?'':'S'}</span></div>${cards}</section>`;
 };
 const renderFilters=()=>{
  const categories=Array.isArray(payload?.categories)?payload.categories:[];
  filterHost.innerHTML=[{key:'all',title:'すべて'},...categories.map(category=>({key:category.key,title:category.title}))].map(item=>`<button aria-pressed="${item.key===active}" class="filter${item.key===active?' active':''}" data-disc-filter="${escapeHtml(item.key)}" type="button">${escapeHtml(item.title)}</button>`).join('');
  filterHost.querySelectorAll('[data-disc-filter]').forEach(button=>button.addEventListener('click',()=>{active=button.dataset.discFilter||'all';render();}));
 };
 const render=()=>{
  if(!payload||!Array.isArray(payload.categories)||!Array.isArray(payload.releases)){
   contentHost.innerHTML='<div class="card release-empty"><span class="section-kicker">LOAD ERROR</span><h3>作品データを読み込めませんでした</h3><p>ページを再読み込みしてください。</p></div>';return;
  }
  renderFilters();
  contentHost.innerHTML=payload.categories.map(categorySection).join('');
  statusHost.textContent=`公開作品 ${payload.releases.length}件・最終同期 ${payload.generatedAt?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(payload.generatedAt)):'未取得'}`;
  requestAnimationFrame(()=>{
   const id=decodeURIComponent(location.hash.slice(1));
   const target=id&&document.getElementById(id);
   if(target){target.classList.add('is-linked-release');target.scrollIntoView({block:'center'});}
  });
 };
 render();
})();
