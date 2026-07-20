(()=>{
  'use strict';

  const data=window.RESCENE_OFFICIAL_LINKS;
  const sectionsHost=document.getElementById('officialLinksSections');
  const filtersHost=document.getElementById('officialLinkFilters');
  const countHost=document.getElementById('officialLinkCount');
  if(!data||!sectionsHost)return;

  const escapeHtml=(value='')=>String(value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const safeLink=value=>{
    const text=String(value||'').trim();
    return /^(https?:\/\/\S+|[a-z0-9_-]+\.html(?:[#?].*)?)$/i.test(text)?text:'';
  };
  const links=(Array.isArray(data.links)?data.links:[])
    .filter(item=>safeLink(item.url))
    .sort((a,b)=>(a.categoryOrder??9999)-(b.categoryOrder??9999)||(a.order??9999)-(b.order??9999)||String(a.title||'').localeCompare(String(b.title||''),'ja'));
  const categories=[...new Map(links.map(item=>[item.category||'その他',{name:item.category||'その他',order:item.categoryOrder??9999}])).values()]
    .sort((a,b)=>a.order-b.order||a.name.localeCompare(b.name,'ja'));
  let active='all';

  const categorySlug=value=>String(value||'other').normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'').toLowerCase()||'other';
  const iconMarkup=item=>{
    if(item.icon)return `<img src="${escapeHtml(item.icon)}" alt="" loading="lazy">`;
    return `<span aria-hidden="true">${escapeHtml(item.iconText||String(item.title||'').slice(0,2))}</span>`;
  };
  const card=item=>{
    const url=safeLink(item.url);
    const external=/^https?:\/\//i.test(url);
    const attrs=external?' target="_blank" rel="noopener noreferrer"':'';
    return `<a class="official-link-card card card-link" id="${escapeHtml(item.anchor||'')}" href="${escapeHtml(url)}"${attrs}>
      <span class="official-link-icon">${iconMarkup(item)}</span>
      <span class="official-link-copy">
        <small>${escapeHtml(item.label||item.category||'OFFICIAL')}</small>
        <strong>${escapeHtml(item.title||'公式リンク')}</strong>
        ${item.subtitle?`<b>${escapeHtml(item.subtitle)}</b>`:''}
        ${item.description?`<p>${escapeHtml(item.description)}</p>`:''}
      </span>
      <span class="official-link-arrow" aria-hidden="true">↗</span>
    </a>`;
  };

  function renderFilters(){
    if(!filtersHost)return;
    const options=[['all','すべて'],...categories.map(category=>[category.name,category.name])];
    filtersHost.innerHTML=options.map(([value,label])=>{
      const count=value==='all'?links.length:links.filter(item=>item.category===value).length;
      return `<button class="official-link-filter${active===value?' active':''}" type="button" data-link-filter="${escapeHtml(value)}" aria-pressed="${active===value?'true':'false'}">${escapeHtml(label)} <small>${count}</small></button>`;
    }).join('');
    filtersHost.querySelectorAll('[data-link-filter]').forEach(button=>button.addEventListener('click',()=>{
      active=button.dataset.linkFilter||'all';
      renderFilters();
      renderSections();
    }));
  }

  function renderSections(){
    const visibleCategories=categories.filter(category=>active==='all'||category.name===active);
    sectionsHost.innerHTML=visibleCategories.map(category=>{
      const items=links.filter(item=>item.category===category.name);
      if(!items.length)return '';
      const slug=categorySlug(category.name);
      return `<section class="section official-link-section" data-link-category="${escapeHtml(category.name)}">
        <div class="section-head official-link-section-head">
          <div><span class="section-kicker">${escapeHtml(category.name==='公式SNS'?'SOCIAL MEDIA':category.name==='音楽配信'?'MUSIC PLATFORMS':'OFFICIAL COMMUNITY')}</span><h2 class="section-title">${escapeHtml(category.name)}</h2></div>
          <span class="official-link-category-count">${items.length} LINKS</span>
        </div>
        <div class="official-link-grid official-link-grid-${escapeHtml(slug)}">${items.map(card).join('')}</div>
      </section>`;
    }).join('');
    if(!sectionsHost.innerHTML.trim())sectionsHost.innerHTML='<div class="card official-link-empty">公開中の公式リンクはありません。</div>';
    if(countHost)countHost.textContent=`${active==='all'?links.length:links.filter(item=>item.category===active).length}件の公式リンク`;
  }

  renderFilters();
  renderSections();
})();