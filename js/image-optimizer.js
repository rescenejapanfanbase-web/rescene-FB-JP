(()=>{
  'use strict';

  const script=document.currentScript||[...document.scripts].find(item=>/\/js\/image-optimizer\.js(?:\?|$)/.test(item.src));
  if(!script)return;
  const resolveAddress=(value,base)=>Reflect.construct(window['URL'],[value,base]);
  const siteBase=resolveAddress('../',script.src);
  const manifestUrl=resolveAddress('data/image-manifest.json',siteBase);
  const i18nUrl=resolveAddress('js/i18n.js',siteBase);
  if(!document.querySelector('script[data-rescene-i18n]')){
    const languageScript=document.createElement('script');
    languageScript.src=i18nUrl.href;
    languageScript.dataset.resceneI18n='true';
    document.head.appendChild(languageScript);
  }
  const siteBasePath=decodeURIComponent(siteBase.pathname);
  let manifest=null;
  let observer=null;
  let applying=false;

  const localKey=value=>{
    if(!value||/^(?:data:|blob:|https?:\/\/|\/\/)/i.test(value)){
      if(!value||!/^(?:https?:)?\/\//i.test(value))return null;
    }
    try{
      const url=resolveAddress(value,document.baseURI);
      if(url.origin!==siteBase.origin)return null;
      const pathname=decodeURIComponent(url.pathname);
      if(!pathname.startsWith(siteBasePath))return null;
      return pathname.slice(siteBasePath.length).replace(/^\/+/, '');
    }catch{return null;}
  };

  const absolute=value=>resolveAddress(value,siteBase).href;
  const srcset=variants=>variants.map(item=>`${absolute(item.src)} ${item.width}w`).join(', ');

  function inferSizes(element){
    if(element.getAttribute('sizes'))return element.getAttribute('sizes');
    if(element.closest('.app-logo-image,.guide-app-icon,.member-profile-avatar,.member-mini-avatar'))return '96px';
    if(element.closest('.member-detail-photo,.member-photo,.member-profile-photo'))return '(max-width:719px) 78vw, 420px';
    if(element.closest('.chant-summary-thumb,.mv-gallery-card,.mv-card,.news-card'))return '(max-width:719px) 46vw, 360px';
    if(element.closest('.guide-step,.score-image-card'))return '(max-width:719px) 92vw, 520px';
    if(element.closest('.article-hero,.debut-era-photo,.vote-summary-card,.chant-figure'))return '(max-width:719px) 92vw, (max-width:1199px) 86vw, 1120px';
    return '(max-width:719px) 92vw, (max-width:1199px) 46vw, 560px';
  }

  function applyImage(image){
    if(!manifest||image.dataset.noImageOptimize==='true')return;
    const current=image.getAttribute('src');
    if(!current)return;
    if(image.dataset.imageOptimized==='true'&&current===image.dataset.imageOriginalSrc&&image.getAttribute('srcset')===image.dataset.imageAppliedSrcset)return;
    const original=current===image.dataset.imageOriginalSrc?image.dataset.imageOriginalSrc:current;
    const key=localKey(original);
    const entry=key&&manifest.images?.[key];
    if(!entry||!Array.isArray(entry.variants)||!entry.variants.length)return;
    const applied=srcset(entry.variants);
    image.dataset.imageOriginalSrc=original;
    image.dataset.imageAppliedSrcset=applied;
    if(image.getAttribute('srcset')!==applied)image.setAttribute('srcset',applied);
    if(!image.hasAttribute('sizes'))image.setAttribute('sizes',inferSizes(image));
    if(!image.hasAttribute('decoding'))image.setAttribute('decoding','async');
    image.dataset.imageOptimized='true';
  }

  function applySource(source){
    if(!manifest||source.dataset.noImageOptimize==='true')return;
    const current=source.getAttribute('srcset');
    if(!current)return;
    if(source.dataset.imageOptimized==='true'&&current===source.dataset.imageAppliedSrcset)return;
    const original=current===source.dataset.imageAppliedSrcset?source.dataset.imageOriginalSrcset:current;
    const first=original.split(',')[0].trim().split(/\s+/)[0];
    const key=localKey(first);
    const entry=key&&manifest.images?.[key];
    if(!entry||!Array.isArray(entry.variants)||!entry.variants.length)return;
    const applied=srcset(entry.variants);
    source.dataset.imageOriginalSrcset=original;
    source.dataset.imageAppliedSrcset=applied;
    if(current!==applied)source.setAttribute('srcset',applied);
    source.setAttribute('type','image/webp');
    if(!source.hasAttribute('sizes'))source.setAttribute('sizes',inferSizes(source));
    source.dataset.imageOptimized='true';
  }

  function scan(root=document){
    if(applying)return;
    applying=true;
    try{
      if(root instanceof HTMLImageElement)applyImage(root);
      else if(root instanceof HTMLSourceElement)applySource(root);
      root.querySelectorAll?.('img[src]').forEach(applyImage);
      root.querySelectorAll?.('picture source[srcset]').forEach(applySource);
    }finally{applying=false;}
  }

  async function start(){
    try{
      const response=await fetch(`${manifestUrl.href}?v=${Date.now()}`,{cache:'no-store'});
      if(!response.ok)return;
      const data=await response.json();
      if(!data||typeof data.images!=='object')return;
      manifest=data;
      scan(document);
      observer=new MutationObserver(records=>{
        records.forEach(record=>{
          record.addedNodes.forEach(node=>{if(node.nodeType===1)scan(node);});
          if(record.type==='attributes'&&record.target?.nodeType===1)scan(record.target);
        });
      });
      observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src','srcset']});
      window.dispatchEvent(new CustomEvent('rescene:image-optimizer-ready',{detail:{count:Object.keys(data.images).length}}));
    }catch{
      // Originals remain available when the manifest has not been generated yet.
    }
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
