(()=>{
  'use strict';

  const script=document.currentScript||[...document.scripts].find(item=>/\/js\/site-content\.js(?:\?|$)/.test(item.src));
  if(!script)return;
  const siteBase=new URL('../',script.src);
  const dataUrl=new URL('data/homepage.json',siteBase);
  const officialLinksUrl=new URL('data/official-links.json',siteBase);
  const externalPattern=/^(?:https?:\/\/|mailto:|tel:)/i;

  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const safeUrl=(value,fallback='#')=>{
    const text=String(value||'').trim();
    if(!text)return fallback;
    if(externalPattern.test(text)||/^(?:#|\.\.?\/|[A-Za-z0-9_-]+(?:\/|\.html|\.xml|\?))/.test(text))return text;
    return fallback;
  };
  const byAnchor=(items,anchor)=>items.find(item=>item.anchor===anchor);
  const itemsOf=(items,type)=>items.filter(item=>item.type===type).sort((a,b)=>(a.order??9999)-(b.order??9999));
  const setText=(selector,value,root=document)=>{const el=typeof selector==='string'?root.querySelector(selector):selector;if(el&&value)el.textContent=value;};
  const setLink=(el,label,url)=>{if(!el)return;if(label)el.textContent=label;if(url)el.setAttribute('href',safeUrl(url,el.getAttribute('href')||'#'));};
  const titleLines=(element,value,highlightLast=false)=>{
    if(!element||!value)return;
    const lines=String(value).split(/\r?\n/).filter(Boolean);
    element.textContent='';
    lines.forEach((line,index)=>{
      if(index)element.append(document.createElement('br'));
      const node=highlightLast&&index===lines.length-1?document.createElement('span'):document.createTextNode(line);
      if(node.nodeType===1)node.textContent=line;
      element.append(node);
    });
  };
  const iconSvg=key=>({
    news:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V3zm3 4v2h10V7H7zm0 4v2h10v-2H7zm0 4v2h7v-2H7z"/></svg>',
    calendar:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h2v2h6V2h2v2h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2V2zm12 8H5v10h14V10zM5 6v2h14V6H5z"/></svg>',
    play:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-2 6 7 4-7 4V8z"/></svg>',
    vote:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.2 15.4-3.6-3.6 1.4-1.4 2.2 2.2 5.8-5.8 1.4 1.4-7.2 7.2zM4 20a2 2 0 0 1-2-2V6h4V2h12v4h4v12a2 2 0 0 1-2 2H4zm4-14h8V4H8v2zm-4 2v10h16V8h-2v2H6V8H4z"/></svg>',
  }[key]||'<span aria-hidden="true">R</span>');

  function applySectionHeading(container,item){
    if(!container||!item)return;
    const kicker=container.querySelector('.section-kicker');
    const heading=container.querySelector('.section-title');
    const link=container.querySelector('.section-link');
    if(kicker&&item.englishLabel)kicker.textContent=item.englishLabel;
    if(heading&&item.heading)heading.textContent=item.heading;
    setLink(link,item.buttonLabel,item.linkUrl);
  }

  function applyFooter(items){
    const main=byAnchor(items,'footer-main');
    const note=byAnchor(items,'footer-note');
    document.querySelectorAll('.site-footer').forEach(footer=>{
      const brand=footer.querySelector('.footer-inner > div:first-child strong');
      const description=footer.querySelector('.footer-inner > div:first-child p');
      if(main?.heading&&brand)brand.textContent=main.heading;
      if(main?.description&&description)description.textContent=main.description;
      const noteElement=footer.querySelector('.footer-note');
      if(note?.description&&noteElement){
        noteElement.textContent='';
        noteElement.append(document.createTextNode(`${note.description} © `));
        const year=document.createElement('span');year.dataset.year='';year.textContent=String(new Date().getFullYear());
        noteElement.append(year,document.createTextNode(` ${main?.heading||'RESCENE JAPAN FANBASE'}`));
      }
    });
  }

  function apply404(items){
    const item=byAnchor(items,'not-found');
    const root=document.querySelector('[data-site-404]');
    if(!item||!root)return;
    setText(root.querySelector('.error-code'),item.englishLabel||'404');
    setText(root.querySelector('h1'),item.heading);
    setText(root.querySelector('p'),item.description);
    setLink(root.querySelector('a.btn'),item.buttonLabel,item.linkUrl);
  }

  function renderQuick(items){
    const container=document.querySelector('[data-home-quick]');
    if(!container||!items.length)return;
    container.innerHTML=items.map(item=>`<a class="card card-link quick-card" href="${esc(safeUrl(item.linkUrl))}"><span class="quick-icon">${iconSvg(item.icon)}</span><h3>${esc(item.heading||item.title)}</h3><p>${esc(item.description)}</p></a>`).join('');
  }

  function renderRoutes(items){
    const container=document.querySelector('[data-home-routes]');
    if(!container||!items.length)return;
    container.innerHTML=items.map(item=>`<a class="card card-link" href="${esc(safeUrl(item.linkUrl))}"><span class="route-num">${esc(item.number)}</span><h3>${esc(item.heading||item.title)}</h3><p class="subtle">${esc(item.description)}</p></a>`).join('');
  }

  function applyFocus(items){
    const item=byAnchor(items,'about-focus');
    const root=document.querySelector('[data-home-focus]');
    if(item&&root){
      setText(root.querySelector('.badge'),item.englishLabel);
      titleLines(root.querySelector('.focus-copy h2'),item.heading,true);
      setText(root.querySelector('.focus-copy p'),item.description);
      const links=root.querySelectorAll('.hero-actions a');
      setLink(links[0],item.buttonLabel,item.linkUrl);
      setLink(links[1],item.secondaryButtonLabel,item.secondaryLinkUrl);
    }
    const stats=itemsOf(items,'統計');
    const statRoot=document.querySelector('[data-home-stats]');
    if(statRoot&&stats.length)statRoot.innerHTML=stats.map(stat=>`<div><strong>${esc(stat.value)}</strong><span>${esc(stat.subLabel)}</span></div>`).join('');
  }

  const socialSvg=anchor=>({
    'official-x':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.3 2H22l-8.1 9.3L23.4 22H16l-5.8-7.6L3.6 22H0l8.5-9.7L-.6 2H7l5.2 6.9L18.3 2zm-1.3 18h2L5.9 3.9H3.8L17 20z"/></svg>',
    instagram:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7zm11.5 1.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5zM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>',
    tiktok:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2h3a5 5 0 0 0 5 5v3a8 8 0 0 1-5-1.7V16a6 6 0 1 1-6-6h1v3a3 3 0 1 0 2 2.8V2z"/></svg>',
    youtube:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M23 7.2a3 3 0 0 0-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 0 0 1 7.2C.5 9.1.5 12 .5 12s0 2.9.5 4.8a3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1c.5-1.9.5-4.8.5-4.8s0-2.9-.5-4.8zM9.6 15.4V8.6L15.5 12l-5.9 3.4z"/></svg>',
  }[anchor]||'');

  function officialCard(item){
    const content=item.icon?`<span class="social-icon-wrap"><img src="${esc(item.icon)}" alt="" width="23" height="23"></span>`:`<span class="social-icon-wrap">${socialSvg(item.anchor)||esc(item.iconText||item.title.slice(0,2))}</span>`;
    return `<a class="link-card" href="${esc(safeUrl(item.url))}" target="_blank" rel="noopener noreferrer">${content}<span>${esc(item.title)}</span></a>`;
  }
  function musicCard(item){
    const icon=item.icon?`<img src="${esc(item.icon)}" alt="${esc(item.title)}">`:esc(item.iconText||item.title.slice(0,2));
    return `<a class="link-card" href="${esc(safeUrl(item.url))}" target="_blank" rel="noopener noreferrer"><b class="link-logo">${icon}</b><span>${esc(item.title)}</span></a>`;
  }
  async function renderOfficialLinks(){
    const root=document.querySelector('[data-home-official-links]');
    if(!root)return;
    try{
      let payload=window.RESCENE_OFFICIAL_LINKS;
      if(!payload){
        const response=await fetch(`${officialLinksUrl.href}?v=${Date.now()}`,{cache:'no-store'});
        if(!response.ok)return;
        payload=await response.json();
      }
      const links=Array.isArray(payload?.links)?payload.links:[];
      const desired=['official-x','instagram','tiktok','youtube'];
      const social=desired.map(anchor=>links.find(item=>item.anchor===anchor)).filter(Boolean);
      const music=['spotify','apple-music'].map(anchor=>links.find(item=>item.anchor===anchor)).filter(Boolean);
      if(!social.length&&!music.length)return;
      root.innerHTML=`<div class="card link-group"><h3>RESCENE Official</h3><div class="link-items">${social.map(officialCard).join('')}</div></div><div class="card link-group"><h3>Music</h3><div class="link-items">${music.map(musicCard).join('')}<a class="link-card" href="discography.html"><b class="link-logo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l5 5v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm8 2v4h4M8 13h8M8 17h8"/></svg></b><span>Discography</span></a><a class="link-card" href="mv.html"><b class="link-logo"><img src="assets/platform-icons/youtube.png" alt="Music Video"></b><span>Music Video</span></a></div></div>`;
    }catch{}
  }

  function applyHome(items){
    const hero=byAnchor(items,'hero');
    if(hero&&document.querySelector('[data-home-hero-title]')){
      setText('[data-home-hero-kicker]',hero.englishLabel);
      titleLines(document.querySelector('[data-home-hero-title]'),hero.heading,true);
      setText('[data-home-hero-description]',hero.description);
      const actions=document.querySelectorAll('[data-home-hero-actions] a');
      setLink(actions[0],hero.buttonLabel,hero.linkUrl);
      setLink(actions[1],hero.secondaryButtonLabel,hero.secondaryLinkUrl);
      setLink(actions[2],hero.thirdButtonLabel,hero.thirdLinkUrl);
      const image=document.querySelector('[data-home-hero-image]');if(image&&hero.image)image.src=safeUrl(hero.image,image.src);
      setText('[data-home-hero-note]',hero.note);
    }
    document.querySelectorAll('[data-home-section-heading]').forEach(container=>applySectionHeading(container,byAnchor(items,container.dataset.homeSectionHeading)));
    const routeHeading=byAnchor(items,'routes-heading');if(routeHeading?.heading)setText('[data-home-routes-heading]',routeHeading.heading);
    renderQuick(itemsOf(items,'クイックアクセス'));
    renderRoutes(itemsOf(items,'初めてガイド'));
    applyFocus(items);
    renderOfficialLinks();
  }

  async function load(){
    let payload=window.RESCENE_HOMEPAGE;
    if(!payload){
      try{const response=await fetch(`${dataUrl.href}?v=${Date.now()}`,{cache:'no-store'});if(response.ok)payload=await response.json();}catch{}
    }
    const items=Array.isArray(payload?.items)?payload.items:[];
    if(!items.length)return;
    applyFooter(items);
    apply404(items);
    applyHome(items);
    window.dispatchEvent(new CustomEvent('rescene:site-content-ready',{detail:{count:items.length}}));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',load,{once:true});else load();
})();
