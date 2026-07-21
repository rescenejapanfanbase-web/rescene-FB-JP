(()=>{
  'use strict';
  const data=window.RESCENE_VOTING_GUIDE;
  if(!data)return;

  const statusHost=document.getElementById('votingStatusHost');
  const programHost=document.getElementById('votingProgramList');
  const scoreImageHost=document.getElementById('votingScoreImages');
  const scoreCardHost=document.getElementById('votingScoreCards');
  const appHost=document.getElementById('votingAppList');
  const guideHost=document.getElementById('votingGuideList');
  const escapeHtml=(value='')=>String(value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const lineBreaks=(value='')=>escapeHtml(value).replace(/\n/g,'<br>');
  const image=(src,alt,css='')=>src?`<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy"${css?` class="${css}"`:''}>`:'';
  const fav=(kind,item)=>window.RESCENE_FAVORITES?.button({type:'voting',id:`${kind}:${item.slug||item.anchor||item.title}`,label:`${item.title||'投票ガイド'}をお気に入り`})||'';
  const safeUrl=value=>/^https?:\/\//i.test(String(value||''))?String(value):'';

  if(statusHost){
    const status=data.status||{};
    statusHost.innerHTML=`<div class="vote-status-main"><span aria-hidden="true" class="status-dot"></span><div><span class="section-kicker">CURRENT STATUS</span><h2 id="current-vote-title">${escapeHtml(status.title||'現在の投票案内')}</h2><p>${lineBreaks(status.description||'')}</p></div></div><div class="status-meta">${status.type?`<span>${escapeHtml(status.type)}</span>`:''}${status.lastChecked?`<span>最終確認：${escapeHtml(status.lastChecked)}</span>`:''}</div>`;
  }

  const programs=Array.isArray(data.programs)?[...data.programs].sort((a,b)=>(a.order??9999)-(b.order??9999)):[];
  if(programHost){
    programHost.innerHTML=programs.map(item=>`<article class="card program-card" data-mark="${escapeHtml(item.mark||'')}"><div class="program-top"><div class="program-name"><span aria-hidden="true" class="program-icon">${image(item.icon,item.app||item.title)}</span><div><h3>${escapeHtml(item.title||'')}</h3><small>${escapeHtml(item.subtitle||'')}</small></div></div>${item.voteType?`<span class="vote-type">${escapeHtml(item.voteType)}</span>`:''}</div><dl class="program-data"><div><dt>使用アプリ</dt><dd>${escapeHtml(item.app||'—')}</dd></div><div><dt>準備するもの</dt><dd>${escapeHtml(item.currency||'—')}</dd></div><div><dt>投票</dt><dd>${escapeHtml(item.period||'—')}</dd></div></dl>${item.note?`<p class="program-note">${lineBreaks(item.note)}</p>`:''}<div class="card-utility-row">${fav('program',item)}</div></article>`).join('');
  }

  const scorePrograms=programs.filter(item=>item?.score&&(item.score.image||(Array.isArray(item.score.items)&&item.score.items.length)));
  if(scoreImageHost){
    scoreImageHost.innerHTML=scorePrograms.filter(item=>item.score.image).map(item=>`<article class="card score-image-card"><figure class="score-figure">${image(item.score.image,`${item.title} の最新早見表画像`)}</figure><div class="score-caption"><h3>${escapeHtml(item.title||'')}</h3><p>${escapeHtml(item.score.meta||`${item.subtitle||''} / ${item.app||''}`)}</p></div></article>`).join('');
  }
  if(scoreCardHost){
    scoreCardHost.innerHTML=scorePrograms.filter(item=>Array.isArray(item.score.items)&&item.score.items.length).map(item=>`<article class="card score-card"><h3>${escapeHtml(item.title||'')}</h3><p class="score-meta">${escapeHtml(item.score.meta||`${item.subtitle||''} / ${item.app||''}`)}</p><ul class="score-list">${item.score.items.map(row=>`<li><span>${escapeHtml(row.label||'')}</span><strong>${escapeHtml(row.value||'')}</strong></li>`).join('')}</ul>${item.score.note?`<p class="score-note">${lineBreaks(item.score.note)}</p>`:''}</article>`).join('');
  }

  const apps=Array.isArray(data.apps)?[...data.apps].sort((a,b)=>(a.order??9999)-(b.order??9999)):[];
  if(appHost){
    appHost.innerHTML=apps.map(item=>{
      const appStore=safeUrl(item.appStore);
      const googlePlay=safeUrl(item.googlePlay);
      return `<article class="card app-card"><div class="app-card-head">${item.icon?image(item.icon,item.title,'app-logo-image'):`<span class="app-logo-text">${escapeHtml(item.title||'APP')}</span>`}<div><h3>${escapeHtml(item.title||'')}</h3><p>${escapeHtml(item.subtitle||item.description||'')}</p></div></div>${Array.isArray(item.tags)&&item.tags.length?`<div class="app-tags">${item.tags.map(tag=>`<span>${escapeHtml(tag)}</span>`).join('')}</div>`:''}<div class="store-buttons">${appStore?`<a href="${escapeHtml(appStore)}" target="_blank" rel="noopener noreferrer">App Storeで開く ↗</a>`:''}${googlePlay?`<a href="${escapeHtml(googlePlay)}" target="_blank" rel="noopener noreferrer">Google Playで開く ↗</a>`:''}</div><div class="card-utility-row">${fav('app',item)}</div></article>`;
    }).join('');
  }

  if(guideHost){
    guideHost.innerHTML=apps.map((item,index)=>{
      const steps=Array.isArray(item?.guide?.steps)?item.guide.steps:[];
      const stepHtml=steps.map(step=>`<article class="guide-step">${step.image?`<div class="guide-image">${image(step.image,`${item.title} ${step.title||'投票ガイド'}`)}</div>`:`<div class="guide-placeholder"><strong>${escapeHtml(step.title||'画像なし')}</strong><code>Notionの「ガイド画像」へ追加できます</code></div>`}<div class="guide-caption"><b>${escapeHtml(step.title||'手順')}</b>${step.text?`<p>${escapeHtml(step.text)}</p>`:''}</div></article>`).join('');
      return `<details class="guide-details"${index===0?' open':''}><summary><span class="guide-summary-title"><span class="guide-app-icon">${image(item.icon,item.title)}</span><span>${escapeHtml(item.title||'')}<small>${escapeHtml(item.subtitle||'')}</small></span></span></summary><div class="guide-content"><div class="guide-steps">${stepHtml}</div>${item?.guide?.note?`<p class="guide-note">${lineBreaks(item.guide.note)}</p>`:''}</div></details>`;
    }).join('');
  }
  window.RESCENE_FAVORITES?.bind(document);document.dispatchEvent(new CustomEvent('rescene:content-rendered'));
})();
