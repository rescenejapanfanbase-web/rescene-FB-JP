(()=>{
  'use strict';
  const data=window.RESCENE_MEMBERS||{};
  const members=Array.isArray(data.members)?data.members:[];
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const attr=esc;
  const dateLabel=value=>{const match=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);return match?`${match[1]}.${match[2]}.${match[3]}`:String(value||'');};
  const displayColor=value=>{const hex=String(value||'').replace('#','');if(!/^[0-9a-f]{6}$/i.test(hex))return value||'var(--pink)';const r=parseInt(hex.slice(0,2),16),g=parseInt(hex.slice(2,4),16),b=parseInt(hex.slice(4,6),16);return (r*299+g*587+b*114)/1000<82?'#d7d7d7':`#${hex}`;};
  const orderLabel=index=>String(index+1).padStart(2,'0');
  const picture=(member,context='detail')=>{
    const image=context==='preview'?(member.previewImage||member.detailImage):(member.detailImage||member.previewImage);
    if(!image)return '<div class="member-image-placeholder" aria-hidden="true"></div>';
    const img=`<img src="${attr(image)}" alt="${attr(member.name)} ${context==='detail'?'detailed profile photo':'photo'}" loading="lazy" decoding="async">`;
    if(context==='detail'&&member.desktopImage&&member.desktopImage!==image)return `<picture class="member-detail-picture"><source media="(min-width:901px)" srcset="${attr(member.desktopImage)}">${img}</picture>`;
    return img;
  };
  const ambassador=member=>{
    const item=member.ambassador;
    if(!item||!item.title)return '';
    const link=item.articleUrl?`<a href="${attr(item.articleUrl)}">ニュースを見る →</a>`:'';
    return `<div class="member-ambassador"><div class="member-ambassador-head"><h3>PROMOTIONAL AMBASSADOR</h3>${item.date?`<time datetime="${attr(item.date)}">${esc(dateLabel(item.date))}</time>`:''}</div><p><strong>${esc(item.title)}</strong>${item.description?`<br>${esc(item.description)}`:''}</p>${link}</div>`;
  };
  const favoriteButton=(member)=>window.RESCENE_FAVORITES?.button({type:'members',id:member.slug,label:`${member.name}をお気に入り`})||'';
  const previewCard=member=>`<article class="card member-preview-card member-${attr(member.slug)}" style="--member-color:${attr(member.colorCode||'#ff6fae')}"><a class="member-preview-link" href="#${attr(member.anchor)}"><div class="member-preview-photo">${picture(member,'preview')}</div><div class="member-preview-copy"><h2>${esc(member.name)} <small>${esc(member.koreanName)}</small></h2><p>${esc(member.japaneseName)}</p><span class="member-color-chip" style="--chip:${attr(member.colorCode||'#ff6fae')}">MEMBER COLOR · ${esc(member.colorName)}</span></div></a><div class="card-utility-row">${favoriteButton(member)}</div></article>`;
  const detailCard=member=>`<article class="card member-detail-card member-${attr(member.slug)}" id="${attr(member.anchor)}" style="--member-color:${attr(member.colorCode||'#ff6fae')}"><div class="member-detail-photo-wrap"><div class="member-detail-photo">${picture(member,'detail')}</div></div><div class="member-detail-main"><div class="member-detail-head"><div><span class="badge" style="--chip:${attr(member.colorCode||'#ff6fae')}">${esc(member.name)}</span><h2>${esc(member.name)} <small>${esc(member.koreanName)} / ${esc(member.japaneseName)}</small></h2></div><span class="member-color-chip large" style="--chip:${attr(member.colorCode||'#ff6fae')}">MEMBER COLOR · ${esc(member.colorName)}</span></div><p class="member-description">${esc(member.shortDescription)}</p><div class="member-profile-meta"><div><span>生年月日</span><strong>${esc(member.birthDateLabel||dateLabel(member.birthDate))}</strong></div><div><span>出身地</span><strong>${esc(member.birthPlace)}</strong></div><div><span>本名</span><strong>${esc(member.realName)}</strong></div><div><span>KEYWORDS</span><strong>${esc(member.keywords)}</strong></div></div><div class="member-profile-note"><h3>PROFILE</h3><p>${esc(member.profile)}${member.colorName?` メンバーカラーは <b style="color:${attr(displayColor(member.colorCode))}">${esc(member.colorName)}</b> です。`:''}</p></div>${member.personalUrl?`<a class="btn btn-secondary member-personal-link" href="${attr(member.personalUrl)}" target="_blank" rel="noopener noreferrer">個人リンクを開く ↗</a>`:''}${ambassador(member)}<div class="card-utility-row">${favoriteButton(member)}</div></div></article>`;
  const homeCard=(member,index)=>`<a class="member-showcase card card-link member-${attr(member.slug)}" href="members.html#${attr(member.anchor)}"><div class="member-showcase-photo">${picture(member,'preview')}</div><div class="member-showcase-copy"><div class="member-showcase-meta"><span class="member-order">${orderLabel(index)}</span><span class="member-color-chip" style="--chip:${attr(member.colorCode||'#ff6fae')}">${esc(member.colorName)}</span></div><h3>${esc(member.name)}</h3><p>${esc(member.koreanName)} / ${esc(member.japaneseName)}</p></div></a>`;
  const preview=document.getElementById('membersPreview');
  const details=document.getElementById('membersDetails');
  const home=document.querySelector('[data-members-home]');
  if(preview)preview.innerHTML=members.map(previewCard).join('');
  if(details)details.innerHTML=members.map(detailCard).join('');
  if(home)home.innerHTML=members.map(homeCard).join('');
  window.RESCENE_FAVORITES?.bind(document);document.dispatchEvent(new CustomEvent('rescene:content-rendered'));
  document.querySelectorAll('[data-member-count]').forEach(node=>node.textContent=String(members.length));
  const names=members.map(item=>item.name).join(' · ');
  document.querySelectorAll('[data-member-names]').forEach(node=>node.textContent=names);
})();
