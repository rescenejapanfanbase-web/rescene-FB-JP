(()=>{
  'use strict';
  const payload=window.RESCENE_RECORDS||{};
  const awards=Array.isArray(payload.awardRecords)?payload.awardRecords:[];
  const summary=document.getElementById('awardsSummary');
  const list=document.getElementById('awardsList');
  const controls=[...document.querySelectorAll('[data-awards-filter]')];
  const escape=(x='')=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=(x)=>/^\d{4}-\d{2}-\d{2}$/.test(String(x||'').slice(0,10))?String(x).slice(0,10).replaceAll('-','.'):'';
  const safeUrl=(x)=>/^https:\/\/[^\s<>"']+$/i.test(String(x||''))?String(x):'';
  const safeImage=(x)=>/^(?:assets\/[a-z0-9_./%-]+\.(?:jpg|jpeg|png|webp|gif))$/i.test(String(x||''))&&!String(x).includes('..')?String(x):'';
  const sorted=[...awards].filter(x=>x&&Number(x.year)>=2024&&['won','nominated'].includes(x.status)).sort((a,b)=>Number(b.year)-Number(a.year)||String(b.date||'').localeCompare(String(a.date||''))||Number(a.order??9999)-Number(b.order??9999));
  const wins=sorted.filter(x=>x.status==='won').length;
  const nominations=sorted.filter(x=>x.status==='nominated').length;
  const first=sorted.filter(x=>x.status==='won').at(-1);
  if(summary)summary.innerHTML=`<article class="card record-stat"><small>AWARDS WON</small><strong>${wins}</strong><span>授賞式の受賞数</span></article><article class="card record-stat"><small>NOMINATIONS</small><strong>${nominations}</strong><span>ノミネート数（受賞を除く）</span></article><article class="card record-stat"><small>FIRST AWARD</small><strong>${first?escape(first.year):'—'}</strong><span>${first?escape(fmt(first.date)||first.ceremony):'確認中'}</span></article>`;
  function render(filter){
    const items=sorted.filter(a=>filter==='all'||a.status===filter);
    if(!items.length){list.innerHTML='<div class="card record-empty" style="padding:24px">この条件に該当する記録はありません。</div>';return;}
    const years=[...new Set(items.map(a=>Number(a.year)))].sort((a,b)=>b-a);
    list.innerHTML=years.map(y=>{
      const rows=items.filter(a=>Number(a.year)===y).map(a=>{
        const badge=a.status==='won'?'受賞':'ノミネート';
        const image=safeImage(a.image);
        const official=safeUrl(a.officialUrl);
        const img=image?`<div class="award-photo"><img src="${escape(image)}" alt="${escape(a.ceremony||'授賞式')}の画像" loading="lazy"></div>`:'';
        return `<article class="card award-entry">${img}<div class="award-copy"><div class="award-meta"><span class="award-status ${a.status==='won'?'is-won':'is-nominated'}">${badge}</span>${fmt(a.date)?`<time datetime="${escape(String(a.date).slice(0,10))}">${escape(fmt(a.date))}</time>`:''}</div><p class="award-ceremony">${escape(a.ceremony||'授賞式')}</p><h3>${escape(a.category||a.title||'受賞部門')}</h3>${a.recipient?`<p class="award-recipient">対象：${escape(a.recipient)}</p>`:''}${a.description?`<p class="award-desc">${escape(a.description)}</p>`:''}${official?`<a class="award-source" href="${escape(official)}" target="_blank" rel="noopener noreferrer">発表・報道元を見る ↗</a>`:''}</div></article>`;
      }).join('');
      return `<section class="awards-year-group" aria-label="${y}年の受賞歴"><h2 class="awards-year">${y}<small>年</small></h2><div class="awards-grid">${rows}</div></section>`;
    }).join('');
  }
  for(const button of controls)button.addEventListener('click',()=>{controls.forEach(x=>{const active=x===button;x.classList.toggle('active',active);x.setAttribute('aria-pressed',String(active));});render(button.dataset.awardsFilter||'all');});
  render('all');
})();
