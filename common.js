
(()=>{
 const root=document.documentElement,menu=document.getElementById('mobileMenu'),btn=document.getElementById('hamburger'),backdrop=document.getElementById('menuBackdrop'),theme=document.getElementById('themeToggle');
 const close=()=>{menu?.classList.remove('active');backdrop?.classList.remove('active');btn?.setAttribute('aria-expanded','false');document.body.style.overflow=''};
 btn?.addEventListener('click',()=>{const open=!menu?.classList.contains('active');menu?.classList.toggle('active',open);backdrop?.classList.toggle('active',open);btn.setAttribute('aria-expanded',String(open));document.body.style.overflow=open?'hidden':''});
 backdrop?.addEventListener('click',close);menu?.querySelectorAll('a').forEach(a=>a.addEventListener('click',close));document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
 const sync=()=>{if(theme)theme.textContent=root.classList.contains('light-mode')?'☀':'☾'};sync();
 theme?.addEventListener('click',()=>{root.classList.toggle('light-mode');try{localStorage.setItem('rescene-theme',root.classList.contains('light-mode')?'light':'dark')}catch(e){}sync()});
 document.querySelectorAll('[data-year]').forEach(el=>el.textContent=new Date().getFullYear());
})();
