(()=>{
 'use strict';
 const article=document.querySelector('.article-shell');
 const shareHost=article?.querySelector('.share-actions');
 if(!article||!shareHost)return;

 const API='https://jrpshltqccrbwuikvwwj.supabase.co/functions/v1/news-engagement';
 const slug=decodeURIComponent(location.pathname.split('/').pop()||'').replace(/\.html$/i,'').trim();
 if(!/^[a-z0-9][a-z0-9-]{0,119}$/i.test(slug))return;

 const STYLE_ID='news-engagement-style';
 if(!document.getElementById(STYLE_ID)){
  const style=document.createElement('style');
  style.id=STYLE_ID;
  style.textContent=`
   .news-engagement{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:24px 0 12px;padding:14px 16px;border:1px solid var(--border,rgba(255,255,255,.12));border-radius:16px;background:var(--card,rgba(255,255,255,.04))}
   .news-engagement-stats{display:flex;gap:14px;align-items:center;flex-wrap:wrap;font-size:.93rem;font-weight:700}
   .news-engagement-stat{display:inline-flex;gap:6px;align-items:center;white-space:nowrap}
   .news-like-button{appearance:none;border:1px solid rgba(255,105,180,.42);border-radius:999px;background:rgba(255,105,180,.10);color:inherit;padding:9px 14px;font:inherit;font-weight:800;cursor:pointer;display:inline-flex;gap:7px;align-items:center}
   .news-like-button:hover,.news-like-button.is-liked{background:rgba(255,105,180,.20);border-color:rgba(255,105,180,.7)}
   .news-like-button:disabled{cursor:default;opacity:.78}
   @media(max-width:640px){.news-engagement{align-items:stretch}.news-engagement-stats{width:100%;justify-content:space-between}.news-like-button{justify-content:center;width:100%;min-height:44px}}
  `;
  document.head.appendChild(style);
 }

 let clientId='';
 try{
  const key='rescene-news-engagement-client-v1';
  clientId=localStorage.getItem(key)||'';
  if(!clientId){
   clientId=(crypto.randomUUID?.()||`${Date.now()}-${Math.random()}-${Math.random()}`).replace(/[^a-zA-Z0-9-]/g,'');
   localStorage.setItem(key,clientId);
  }
 }catch{
  clientId=`session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
 }

 const likedKey=`rescene-news-liked:${slug}`;
 const alreadyLiked=(()=>{try{return localStorage.getItem(likedKey)==='1';}catch{return false;}})();

 const panel=document.createElement('div');
 panel.className='news-engagement';
 panel.innerHTML=`<div class="news-engagement-stats" aria-live="polite"><span class="news-engagement-stat">♥ <strong data-like-count>–</strong> いいね</span><span class="news-engagement-stat">↗ <strong data-share-count>–</strong> 共有</span></div><button class="news-like-button${alreadyLiked?' is-liked':''}" type="button" data-news-like ${alreadyLiked?'disabled':''}><span aria-hidden="true">${alreadyLiked?'♥':'♡'}</span><span>${alreadyLiked?'いいね済み':'いいね'}</span></button>`;
 shareHost.parentNode.insertBefore(panel,shareHost);

 const likeCount=panel.querySelector('[data-like-count]');
 const shareCount=panel.querySelector('[data-share-count]');
 const likeButton=panel.querySelector('[data-news-like]');

 const paint=data=>{
  if(!data)return;
  likeCount.textContent=Number(data.likes||0).toLocaleString('ja-JP');
  shareCount.textContent=Number(data.shares||0).toLocaleString('ja-JP');
 };
 const api=async(method,body)=>{
  const url=method==='GET'?`${API}?slug=${encodeURIComponent(slug)}`:API;
  const response=await fetch(url,{method,headers:method==='POST'?{'Content-Type':'application/json'}:undefined,body:method==='POST'?JSON.stringify(body):undefined,cache:'no-store'});
  if(!response.ok)throw new Error(`engagement ${response.status}`);
  return response.json();
 };

 api('GET').then(paint).catch(()=>{likeCount.textContent='0';shareCount.textContent='0';});

 likeButton?.addEventListener('click',async()=>{
  if(likeButton.disabled)return;
  likeButton.disabled=true;
  try{
   const data=await api('POST',{slug,action:'like',clientId});
   paint(data);
   likeButton.classList.add('is-liked');
   likeButton.innerHTML='<span aria-hidden="true">♥</span><span>いいね済み</span>';
   try{localStorage.setItem(likedKey,'1');}catch{}
  }catch{
   likeButton.disabled=false;
  }
 });

 const original=window.RESCENE_SHARE;
 if(original&&!original.__engagementWrapped){
  const record=action=>api('POST',{slug,action}).then(paint).catch(()=>{});
  const native=original.native.bind(original);
  const x=original.x.bind(original);
  const line=original.line.bind(original);
  const copy=original.copy.bind(original);

  original.native=async options=>{
   const ok=await native(options);
   if(ok)await record('share_native');
   return ok;
  };
  original.x=options=>{
   const result=x(options);
   record('share_x');
   return result;
  };
  original.line=options=>{
   const result=line(options);
   record('share_line');
   return result;
  };
  original.copy=async options=>{
   const ok=await copy(options);
   if(ok)await record('share_copy');
   return ok;
  };
  original.__engagementWrapped=true;
 }
})();
