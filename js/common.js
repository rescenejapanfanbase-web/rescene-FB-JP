(()=>{
  'use strict';
  const root=document.documentElement;
  const menu=document.getElementById('mobileMenu');
  const menuButton=document.getElementById('hamburger');
  const backdrop=document.getElementById('menuBackdrop');
  const themeButton=document.getElementById('themeToggle');
  const THEME_KEY='rescene-theme-mode';
  const LEGACY_THEME_KEY='rescene-theme';
  const FAVORITES_KEY='rescene-favorites-v1';
  const media=window.matchMedia?.('(prefers-color-scheme: light)');

  const closeMenu=()=>{
    menu?.classList.remove('active');
    backdrop?.classList.remove('active');
    menuButton?.setAttribute('aria-expanded','false');
    document.body.style.overflow='';
  };
  menuButton?.addEventListener('click',()=>{
    const open=!menu?.classList.contains('active');
    menu?.classList.toggle('active',open);
    backdrop?.classList.toggle('active',open);
    menuButton.setAttribute('aria-expanded',String(open));
    document.body.style.overflow=open?'hidden':'';
  });
  backdrop?.addEventListener('click',closeMenu);
  menu?.querySelectorAll('a').forEach(link=>link.addEventListener('click',closeMenu));
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMenu();});

  const readTheme=()=>{
    try{
      const saved=localStorage.getItem(THEME_KEY);
      if(['system','light','dark'].includes(saved))return saved;
      const legacy=localStorage.getItem(LEGACY_THEME_KEY);
      if(legacy==='light'||legacy==='dark')return legacy;
    }catch{}
    return 'system';
  };
  let themeMode=readTheme();
  const resolvedTheme=mode=>mode==='system'?(media?.matches?'light':'dark'):mode;
  const themeMeta=()=>document.querySelector('meta[name="theme-color"]');
  const syncTheme=()=>{
    const resolved=resolvedTheme(themeMode);
    root.classList.toggle('light-mode',resolved==='light');
    root.dataset.theme=resolved;
    root.dataset.themePreference=themeMode;
    const labels={system:'端末設定',light:'ライト',dark:'ダーク'};
    const icons={system:'◐',light:'☀',dark:'☾'};
    if(themeButton){
      themeButton.textContent=icons[themeMode];
      themeButton.setAttribute('aria-label',`テーマ: ${labels[themeMode]}。クリックで切り替え`);
      themeButton.title=`テーマ: ${labels[themeMode]}（端末設定 → ライト → ダーク）`;
    }
    const meta=themeMeta();
    if(meta)meta.content=resolved==='light'?'#fff7fb':'#2a1727';
  };
  const setTheme=mode=>{
    themeMode=['system','light','dark'].includes(mode)?mode:'system';
    try{
      localStorage.setItem(THEME_KEY,themeMode);
      localStorage.removeItem(LEGACY_THEME_KEY);
    }catch{}
    syncTheme();
    window.RESCENE_ANALYTICS?.track?.('theme_change',{theme_mode:themeMode});
  };
  themeButton?.addEventListener('click',()=>{
    const modes=['system','light','dark'];
    setTheme(modes[(modes.indexOf(themeMode)+1)%modes.length]);
  });
  media?.addEventListener?.('change',()=>{if(themeMode==='system')syncTheme();});
  syncTheme();
  window.RESCENE_THEME={get:()=>themeMode,set:setTheme};

  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const readFavorites=()=>{
    try{
      const parsed=JSON.parse(localStorage.getItem(FAVORITES_KEY)||'{}');
      return {
        members:Array.isArray(parsed.members)?parsed.members:[],
        chants:Array.isArray(parsed.chants)?parsed.chants:[],
        voting:Array.isArray(parsed.voting)?parsed.voting:[],
      };
    }catch{return {members:[],chants:[],voting:[]};}
  };
  const writeFavorites=value=>{
    try{localStorage.setItem(FAVORITES_KEY,JSON.stringify(value));}catch{}
    document.dispatchEvent(new CustomEvent('rescene:favorites-change',{detail:value}));
  };
  const favoriteApi={
    get:readFavorites,
    has(type,id){return readFavorites()[type]?.includes(String(id))||false;},
    toggle(type,id,metadata={}){
      const value=readFavorites();
      if(!Array.isArray(value[type]))value[type]=[];
      const key=String(id);
      const exists=value[type].includes(key);
      value[type]=exists?value[type].filter(item=>item!==key):[...value[type],key];
      writeFavorites(value);
      window.RESCENE_ANALYTICS?.track?.(exists?'favorite_remove':'favorite_add',{favorite_type:type,favorite_id:key,...metadata});
      return !exists;
    },
    button({type,id,label='お気に入り'}){
      const active=this.has(type,id);
      return `<button class="favorite-button${active?' is-active':''}" type="button" data-favorite-type="${escapeHtml(type)}" data-favorite-id="${escapeHtml(id)}" aria-pressed="${active}" aria-label="${escapeHtml(label)}"><span aria-hidden="true">${active?'♥':'♡'}</span><span>${active?'保存済み':'お気に入り'}</span></button>`;
    },
    bind(container=document){
      container.querySelectorAll('[data-favorite-type][data-favorite-id]').forEach(button=>{
        if(button.dataset.favoriteBound)return;
        button.dataset.favoriteBound='1';
        button.addEventListener('click',event=>{
          event.preventDefault();event.stopPropagation();
          const active=this.toggle(button.dataset.favoriteType,button.dataset.favoriteId,{page_type:document.body.className});
          button.classList.toggle('is-active',active);
          button.setAttribute('aria-pressed',String(active));
          const parts=button.querySelectorAll('span');
          if(parts[0])parts[0].textContent=active?'♥':'♡';
          if(parts[1])parts[1].textContent=active?'保存済み':'お気に入り';
        });
      });
    },
  };
  window.RESCENE_FAVORITES=favoriteApi;

  const copyText=async text=>{
    try{await navigator.clipboard.writeText(text);return true;}catch{}
    const textarea=document.createElement('textarea');
    textarea.value=text;textarea.style.position='fixed';textarea.style.opacity='0';
    document.body.appendChild(textarea);textarea.select();
    const result=document.execCommand('copy');textarea.remove();return result;
  };
  const shareApi={
    async native({title=document.title,text='',url=location.href}={}){
      if(navigator.share){
        try{await navigator.share({title,text,url});window.RESCENE_ANALYTICS?.track?.('share',{method:'native',content_title:title});return true;}catch(error){if(error?.name==='AbortError')return false;}
      }
      const result=await copyText(url);
      if(result)window.RESCENE_ANALYTICS?.track?.('share',{method:'copy',content_title:title});
      return result;
    },
    x({title=document.title,text='',url=location.href}={}){
      const message=[text||title,url].filter(Boolean).join('\n');
      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(message)}`,'_blank','noopener,noreferrer');
      window.RESCENE_ANALYTICS?.track?.('share',{method:'x',content_title:title});
    },
    line({title=document.title,text='',url=location.href}={}){
      const message=[text||title,url].filter(Boolean).join('\n');
      window.open(`https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}&text=${encodeURIComponent(message)}`,'_blank','noopener,noreferrer');
      window.RESCENE_ANALYTICS?.track?.('share',{method:'line',content_title:title});
    },
    async copy({title=document.title,url=location.href}={}){
      const result=await copyText(url);
      if(result)window.RESCENE_ANALYTICS?.track?.('share',{method:'copy',content_title:title});
      return result;
    },
    bind(container=document){
      container.querySelectorAll('[data-share-action]').forEach(button=>{
        if(button.dataset.shareBound)return;
        button.dataset.shareBound='1';
        button.addEventListener('click',async event=>{
          event.preventDefault();
          const options={title:button.dataset.shareTitle||document.title,text:button.dataset.shareText||'',url:button.dataset.shareUrl||location.href};
          const action=button.dataset.shareAction;
          const result=action==='x'?this.x(options):action==='line'?this.line(options):action==='copy'?await this.copy(options):await this.native(options);
          if(action==='copy'&&result){
            const original=button.textContent;button.textContent='コピーしました';
            setTimeout(()=>{button.textContent=original;},1600);
          }
        });
      });
    },
  };
  window.RESCENE_SHARE=shareApi;

  const analytics={
    enabled:false,measurementId:'',
    track(name,params={}){if(this.enabled&&typeof window.gtag==='function')window.gtag('event',name,params);},
  };
  window.RESCENE_ANALYTICS=analytics;
  fetch(new URL('data/analytics-config.json',document.baseURI),{cache:'no-store'})
    .then(response=>response.ok?response.json():null)
    .then(config=>{
      const id=String(config?.measurementId||'').trim();
      if(!/^G-[A-Z0-9]+$/i.test(id))return;
      analytics.enabled=true;analytics.measurementId=id;
      window.dataLayer=window.dataLayer||[];
      window.gtag=function(){window.dataLayer.push(arguments);};
      window.gtag('js',new Date());
      window.gtag('config',id,{anonymize_ip:true,send_page_view:true});
      const script=document.createElement('script');script.async=true;script.src=`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;document.head.appendChild(script);
    }).catch(()=>{});

  const registerPwa=()=>{
    if(!('serviceWorker'in navigator)||location.protocol==='file:')return;
    window.addEventListener('load',()=>navigator.serviceWorker.register(new URL('service-worker.js',document.baseURI)).catch(()=>{}));
    let deferredPrompt=null;
    window.addEventListener('beforeinstallprompt',event=>{
      event.preventDefault();deferredPrompt=event;
      if(document.querySelector('.pwa-install-banner'))return;
      const banner=document.createElement('aside');
      banner.className='pwa-install-banner';
      banner.innerHTML='<div><strong>ホーム画面へ追加</strong><span>RESCENEサイトをアプリのように開けます。</span></div><button type="button" data-pwa-install>追加</button><button type="button" class="pwa-dismiss" aria-label="閉じる">×</button>';
      document.body.appendChild(banner);
      banner.querySelector('[data-pwa-install]')?.addEventListener('click',async()=>{
        if(!deferredPrompt)return;deferredPrompt.prompt();const choice=await deferredPrompt.userChoice;
        analytics.track('pwa_install_prompt',{outcome:choice.outcome});deferredPrompt=null;banner.remove();
      });
      banner.querySelector('.pwa-dismiss')?.addEventListener('click',()=>banner.remove());
    });
  };
  registerPwa();

  document.querySelectorAll('[data-year]').forEach(element=>element.textContent=new Date().getFullYear());
  favoriteApi.bind();shareApi.bind();
  document.addEventListener('rescene:content-rendered',()=>{favoriteApi.bind();shareApi.bind();});
})();
