(()=>{
  'use strict';
  const data=window.RESCENE_STREAMING_GUIDE;
  if(!data)return;
  const filtersHost=document.getElementById('streamingFilters');
  const overviewHost=document.getElementById('streamingOverview');
  const detailHost=document.getElementById('streamingDetails');
  const guides=Array.isArray(data.guides)?[...data.guides].sort((a,b)=>(a.order??9999)-(b.order??9999)):[];
  const escapeHtml=(value='')=>String(value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const safeLink=value=>{
    const text=String(value||'').trim();
    return /^(https?:\/\/|[a-z0-9_-]+\.html(?:[#?].*)?)$/i.test(text)?text:'';
  };
  const image=(src,alt,css='')=>src?`<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy"${css?` class="${css}"`:''}>`:'';
  const localIcons={
    'Stationhead':'assets/platform-icons/stationhead.webp',
    'TikTok':'assets/platform-icons/tiktok.webp',
    'Duck AD':'assets/platform-icons/duck-ad.webp'
  };
  const guideIcon=item=>item.icon||localIcons[item.title]||'';
  const types=[...new Set(guides.map(item=>item.type).filter(Boolean))];
  let active='all';
  const typeClass=value=>String(value||'other').normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'').toLowerCase()||'other';

  function renderFilters(){
    if(!filtersHost)return;
    const buttons=[['all','すべて'],...types.map(type=>[type,type])];
    filtersHost.innerHTML=buttons.map(([value,label])=>`<button type="button" class="stream-filter${active===value?' active':''}" data-stream-filter="${escapeHtml(value)}">${escapeHtml(label)}</button>`).join('');
    filtersHost.querySelectorAll('[data-stream-filter]').forEach(button=>button.addEventListener('click',()=>{active=button.dataset.streamFilter||'all';renderFilters();render();}));
  }

  function visible(){return guides.filter(item=>active==='all'||item.type===active);}

  function action(item){
    const link=safeLink(item.link);
    if(!link)return '';
    const external=/^https?:\/\//i.test(link);
    return `<a class="btn btn-secondary stream-action" href="${escapeHtml(link)}"${external?' target="_blank" rel="noopener noreferrer"':''}>${escapeHtml(item.buttonLabel||'開く')}${external?' ↗':' →'}</a>`;
  }

  function render(){
    const items=visible();
    if(overviewHost){
      overviewHost.innerHTML=items.map((item,index)=>`<article class="card stream-overview-card" data-type="${escapeHtml(typeClass(item.type))}"><div class="stream-overview-top"><span class="stream-guide-num">${String(index+1).padStart(2,'0')}</span><span class="stream-type">${escapeHtml(item.type||'GUIDE')}</span></div><div class="stream-title-row"><span class="stream-service-icon">${guideIcon(item)?image(guideIcon(item),item.title):escapeHtml(String(item.title||'?').slice(0,1))}</span><div><h2>${escapeHtml(item.title||'')}</h2>${item.subtitle?`<p>${escapeHtml(item.subtitle)}</p>`:''}</div></div>${Array.isArray(item.points)&&item.points.length?`<ul>${item.points.map(point=>`<li>${escapeHtml(point)}</li>`).join('')}</ul>`:''}${action(item)}<a class="stream-detail-link" href="#${escapeHtml(item.anchor||'')}">詳しい手順を見る ↓</a></article>`).join('')||'<div class="card stream-empty">このカテゴリーのガイドはありません。</div>';
    }
    if(detailHost){
      detailHost.innerHTML=items.map(item=>{
        const steps=Array.isArray(item.steps)?item.steps:[];
        const stepHtml=steps.map(step=>`<article class="stream-step-card${step.image?' has-image':''}">${step.image?`<div class="stream-step-image">${image(step.image,`${item.title} ${step.title||'ガイド画像'}`)}</div>`:''}<div class="stream-step-copy"><strong>${escapeHtml(step.title||'手順')}</strong>${step.text?`<p>${escapeHtml(step.text)}</p>`:''}</div></article>`).join('');
        return `<section class="card stream-detail" id="${escapeHtml(item.anchor||'')}"><div class="stream-detail-head"><span class="stream-service-icon large">${guideIcon(item)?image(guideIcon(item),item.title):escapeHtml(String(item.title||'?').slice(0,1))}</span><div><span class="section-kicker">${escapeHtml(item.type||'STREAMING GUIDE')}</span><h2>${escapeHtml(item.title||'')}</h2>${item.subtitle?`<p>${escapeHtml(item.subtitle)}</p>`:''}</div></div>${item.description?`<p class="stream-description">${escapeHtml(item.description)}</p>`:''}${stepHtml?`<div class="stream-steps">${stepHtml}</div>`:''}${item.note?`<p class="stream-note"><strong>確認：</strong>${escapeHtml(item.note)}</p>`:''}${action(item)}</section>`;
      }).join('');
    }
  }

  renderFilters();
  render();
})();
