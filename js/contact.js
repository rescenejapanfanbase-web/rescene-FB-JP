(()=>{
 'use strict';
 const payload=window.RESCENE_CONTACT;
 if(!payload||!Array.isArray(payload.items))return;
 const byType=type=>payload.items.filter(item=>item?.type===type).sort((a,b)=>(a.order??9999)-(b.order??9999));
 const first=type=>byType(type)[0]||null;
 const escapeHtml=(value='')=>String(value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
 const safeHref=(value='')=>{
  const text=String(value||'').trim();
  if(!text)return '';
  if(/^#[0-9A-Za-z_-]*$/.test(text))return text;
  if(/^mailto:[^\s@]+@[^\s@]+$/i.test(text))return text;
  if(/^https?:\/\/[^\s<>\"']+$/i.test(text))return text;
  return /^(?:\.\/|\.\.\/|\/)?[0-9A-Za-z_./%~-]+(?:\?[0-9A-Za-z_=&%+.,~-]*)?(?:#[0-9A-Za-z_-]+)?$/i.test(text)?text:'';
 };
 const text=(id,value)=>{const node=document.getElementById(id);if(node&&value!==undefined&&value!==null&&String(value)!=='')node.textContent=String(value);};
 const rich=(id,value)=>{const node=document.getElementById(id);if(node&&value!==undefined&&value!==null&&String(value)!=='')node.innerHTML=escapeHtml(value).replace(/\r?\n/g,'<br>');};
 const page=first('ページ設定');
 if(page){text('contactPageKicker',page.englishLabel||'CONTACT');text('contactPageTitle',page.heading||page.title);text('contactPageDescription',page.description);}
 const main=first('メイン案内');
 if(main){
  text('contactMainBadge',main.englishLabel||'CONTACT');rich('contactMainTitle',main.heading||main.title);text('contactMainDescription',main.description);
  const button=document.getElementById('contactMainButton');
  if(button){
   if(main.buttonLabel)button.textContent=main.buttonLabel;
   const href=safeHref(main.linkUrl);
   if(href)button.href=href;
  }
 }
 const routes=byType('連絡経路');
 document.querySelectorAll('[data-contact-route]').forEach((card,index)=>{
  const item=routes[index];
  if(!item){card.hidden=true;return;}
  card.hidden=false;
  const number=card.querySelector('[data-contact-number]');
  const heading=card.querySelector('[data-contact-heading]');
  const description=card.querySelector('[data-contact-description]');
  if(number&&item.number)number.textContent=item.number;
  if(heading)heading.textContent=item.heading||item.title||'';
  if(description)description.textContent=item.description||'';
  if(item.anchor)card.id=item.anchor;
 });
 document.dispatchEvent(new CustomEvent('rescene:content-updated',{detail:{source:'contact'}}));
})();
