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
    return /^(https?:\/\/[^\s]+|[a-z0-9_./-]+\.html(?:[#?].*)?|#[a-z0-9_-]+)$/i.test(text)?text:'';
  };
  const image=(src,alt,css='')=>src?`<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy"${css?` class="${css}"`:''}>`:'';
  const localIcons={
    'Stationhead':'assets/platform-icons/stationhead.webp',
    'TikTok':'assets/platform-icons/tiktok.webp',
    'Duck AD':'assets/platform-icons/duck-ad.webp'
  };
  const guideIcon=item=>item.icon||localIcons[item.title]||'';
  const typeDescriptions={
    '動画':'公式MV・パフォーマンス映像を視聴する方法',
    '音楽ストリーミング':'配信サービスの準備からライブラリ・プレイリスト再生まで',
    'コミュニティ':'ファンと一緒に音楽を聴くサービスの参加方法',
    'SNS':'公式音源を投稿や動画へ追加する方法',
    '応援サポート':'再生ミッションや投票券を使う応援アプリの方法'
  };
  const types=[...new Set(guides.map(item=>item.type||'その他'))];
  let active='all';
  const typeClass=value=>String(value||'other').normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'').toLowerCase()||'other';
  const groupItems=items=>types.map(type=>({type,items:items.filter(item=>(item.type||'その他')===type)})).filter(group=>group.items.length);

  function renderFilters(){
    if(!filtersHost)return;
    const buttons=[['all','すべて'],...types.map(type=>[type,type])];
    filtersHost.innerHTML=buttons.map(([value,label])=>`<button type="button" class="stream-filter${active===value?' active':''}" data-stream-filter="${escapeHtml(value)}" aria-pressed="${active===value?'true':'false'}">${escapeHtml(label)}</button>`).join('');
    filtersHost.querySelectorAll('[data-stream-filter]').forEach(button=>button.addEventListener('click',()=>{
      active=button.dataset.streamFilter||'all';
      renderFilters();
      render();
    }));
  }

  function visible(){return guides.filter(item=>active==='all'||item.type===active);}

  function action(item){
    const link=safeLink(item.link);
    if(!link)return '';
    const external=/^https?:\/\//i.test(link);
    return `<a class="btn btn-secondary stream-action" href="${escapeHtml(link)}"${external?' target="_blank" rel="noopener noreferrer"':''}>${escapeHtml(item.buttonLabel||'開く')}${external?' ↗':' →'}</a>`;
  }

  function preparation(item){
    const list=Array.isArray(item.preparation)?item.preparation.filter(Boolean):[];
    if(!list.length)return '';
    return `<div class="stream-preparation"><div><span class="stream-mini-label">BEFORE START</span><h3>最初に準備するもの</h3></div><ul>${list.map(entry=>`<li>${escapeHtml(entry)}</li>`).join('')}</ul></div>`;
  }

  function overviewCard(item,index){
    const stepCount=Array.isArray(item.steps)?item.steps.length:0;
    return `<article class="card stream-overview-card" data-type="${escapeHtml(typeClass(item.type))}"><div class="stream-overview-top"><span class="stream-guide-num">${String(index+1).padStart(2,'0')}</span><span class="stream-type">${escapeHtml(item.type||'GUIDE')}</span></div><div class="stream-title-row"><span class="stream-service-icon">${guideIcon(item)?image(guideIcon(item),item.title):escapeHtml(String(item.title||'?').slice(0,1))}</span><div><h3>${escapeHtml(item.title||'')}</h3>${item.subtitle?`<p>${escapeHtml(item.subtitle)}</p>`:''}</div></div>${Array.isArray(item.points)&&item.points.length?`<ul>${item.points.map(point=>`<li>${escapeHtml(point)}</li>`).join('')}</ul>`:''}<div class="stream-overview-footer"><span class="stream-step-count">全${stepCount}手順</span>${action(item)}</div><a class="stream-detail-link" href="#${escapeHtml(item.anchor||'')}">最初から詳しく見る ↓</a></article>`;
  }

  function detailCard(item){
    const steps=Array.isArray(item.steps)?item.steps:[];
    const stepHtml=steps.map((step,index)=>`<article class="stream-step-card${step.image?' has-image':''}">${step.image?`<div class="stream-step-image">${image(step.image,`${item.title} ${step.title||'ガイド画像'}`)}</div>`:''}<div class="stream-step-copy"><span class="stream-step-number">STEP ${String(index+1).padStart(2,'0')}</span><strong>${escapeHtml(step.title||'手順')}</strong>${step.text?`<p>${escapeHtml(step.text)}</p>`:''}</div></article>`).join('');
    return `<section class="card stream-detail" id="${escapeHtml(item.anchor||'')}"><div class="stream-detail-head"><span class="stream-service-icon large">${guideIcon(item)?image(guideIcon(item),item.title):escapeHtml(String(item.title||'?').slice(0,1))}</span><div><span class="section-kicker">${escapeHtml(item.type||'STREAMING GUIDE')}</span><h2>${escapeHtml(item.title||'')}</h2>${item.subtitle?`<p>${escapeHtml(item.subtitle)}</p>`:''}</div></div>${item.description?`<p class="stream-description">${escapeHtml(item.description)}</p>`:''}${preparation(item)}${stepHtml?`<div class="stream-steps">${stepHtml}</div>`:''}${item.note?`<p class="stream-note"><strong>確認：</strong>${escapeHtml(item.note)}</p>`:''}${action(item)}</section>`;
  }

  function groupHeader(type,count,mode){
    return `<div class="stream-group-head"><div><span class="section-kicker">${mode==='detail'?'STEP BY STEP':'CATEGORY'}</span><h2>${escapeHtml(type)}</h2><p>${escapeHtml(typeDescriptions[type]||'サービスごとの使い方を確認できます。')}</p></div><span class="stream-group-count">${count}サービス</span></div>`;
  }

  function render(){
    const items=visible();
    const groups=groupItems(items);
    if(overviewHost){
      overviewHost.innerHTML=groups.map(group=>`<section class="stream-type-section" data-stream-group="${escapeHtml(typeClass(group.type))}">${groupHeader(group.type,group.items.length,'overview')}<div class="stream-overview-grid-inner">${group.items.map((item,index)=>overviewCard(item,index)).join('')}</div></section>`).join('')||'<div class="card stream-empty">このカテゴリーのガイドはありません。</div>';
    }
    if(detailHost){
      detailHost.innerHTML=groups.map(group=>`<section class="stream-detail-group" data-stream-detail-group="${escapeHtml(typeClass(group.type))}">${groupHeader(group.type,group.items.length,'detail')}<div class="stream-detail-stack-inner">${group.items.map(detailCard).join('')}</div></section>`).join('');
    }
  }

  renderFilters();
  render();
})();
