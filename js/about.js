(()=>{
  'use strict';
  const about=window.RESCENE_ABOUT;
  const membersPayload=window.RESCENE_MEMBERS;
  if(!about||!Array.isArray(about.items)) return;

  const escapeHtml=(value='')=>String(value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const safeUrl=(value='')=>{
    const text=String(value||'').trim();
    return /^(https?:\/\/|(?:\.\/|\.\.\/|\/)?[0-9A-Za-z_./%\-]+(?:\?[0-9A-Za-z_=&%+.-]*)?(?:#[0-9A-Za-z_-]+)?)$/i.test(text)?text:'';
  };
  const byType=type=>about.items.filter(item=>item.type===type).sort((a,b)=>(a.order??9999)-(b.order??9999));
  const first=type=>byType(type)[0]||null;
  const text=(id,value)=>{const el=document.getElementById(id);if(el&&value!==undefined&&value!==null&&String(value)!=='')el.textContent=String(value)};

  const page=first('ページ設定');
  if(page){
    text('aboutPageKicker',page.englishLabel||'ABOUT RESCENE');
    text('aboutPageTitle',page.heading||page.title);
    text('aboutPageDescription',page.description);
  }

  const debut=first('デビュー写真');
  if(debut){
    text('aboutDebutLabel',debut.englishLabel||'DEBUT ERA');
    text('aboutDebutTitle',debut.heading||debut.title);
    text('aboutDebutDescription',debut.description);
    const image=document.getElementById('aboutDebutImage');
    const src=safeUrl(debut.image);
    if(image&&src){image.src=src;image.alt=`${debut.heading||debut.title}のRESCENEメンバー全体写真`;}
  }

  const identity=first('紹介文');
  if(identity){
    text('aboutIdentityLabel',identity.englishLabel||'IDENTITY');
    const heading=document.getElementById('aboutIdentityTitle');
    if(heading){
      const words=String(identity.heading||identity.title).split(/\s+through\s+/i);
      heading.innerHTML=words.length===2?`${escapeHtml(words[0])}<br>through ${escapeHtml(words[1])}`:escapeHtml(identity.heading||identity.title);
    }
    const body=document.getElementById('aboutIdentityBody');
    if(body) body.innerHTML=String(identity.description||'').split(/\r?\n/).filter(Boolean).map(line=>`<p>${escapeHtml(line)}</p>`).join('');
  }

  const infoHost=document.getElementById('aboutBasicInfo');
  const infoItems=byType('基本情報');
  if(infoHost&&infoItems.length){
    infoHost.innerHTML=infoItems.map(item=>`<div class="card info-card"><span>${escapeHtml(item.englishLabel||item.title)}</span><strong>${escapeHtml(item.value||item.heading||item.title)}</strong>${item.description?`<p>${escapeHtml(item.description)}</p>`:''}</div>`).join('');
  }

  const conceptHost=document.getElementById('aboutConcepts');
  const concepts=byType('コンセプト');
  if(conceptHost&&concepts.length){
    conceptHost.innerHTML=concepts.map(item=>`<article class="card concept-card"><span class="route-num">${escapeHtml(item.englishLabel||item.title)}</span><h3>${escapeHtml(item.heading||item.title)}</h3>${item.description?`<p>${escapeHtml(item.description)}</p>`:''}</article>`).join('');
  }

  const memberHost=document.getElementById('aboutMembers');
  const members=Array.isArray(membersPayload?.members)?membersPayload.members:[];
  if(memberHost&&members.length){
    memberHost.innerHTML=members.map(member=>{
      const image=safeUrl(member.previewImage||member.detailImage);
      const memberHref=`members.html#${encodeURIComponent(member.anchor||`${member.slug}-profile`)}`;
      const names=[member.koreanName,member.japaneseName].filter(Boolean).join(' / ');
      const profile=member.profile||member.shortDescription||'';
      return `<details class="card member-profile-card" data-member="${escapeHtml(member.slug)}"><summary class="member-profile-toggle"><div class="member-profile-avatar">${image?`<img src="${escapeHtml(image)}" alt="${escapeHtml(member.name)}" loading="lazy">`:''}</div><div class="member-profile-head"><div><h2>${escapeHtml(member.name)}${names?` <small>${escapeHtml(names)}</small>`:''}</h2><p class="member-brief">${escapeHtml(member.shortDescription||profile)}</p></div><span class="member-role-badge">${escapeHtml(member.colorName||'MEMBER')}</span></div></summary><div class="member-profile-expand"><div class="member-profile-expand-inner"><div class="member-mini-meta"><div><span>生年月日</span><strong>${escapeHtml(member.birthDateLabel||member.birthDate||'—')}</strong></div><div><span>出身地</span><strong>${escapeHtml(member.birthPlace||'—')}</strong></div><div><span>本名</span><strong>${escapeHtml(member.realName||'—')}</strong></div><div><span>メンバーカラー</span><strong>${escapeHtml(member.colorName||'—')}</strong></div></div>${profile?`<p>${escapeHtml(profile)}</p>`:''}<div class="member-profile-actions"><a class="btn btn-secondary" href="${escapeHtml(memberHref)}">詳細プロフィールを見る</a></div></div></div></details>`;
    }).join('');
  }

  document.dispatchEvent(new CustomEvent('rescene:content-updated',{detail:{source:'about'}}));
})();
