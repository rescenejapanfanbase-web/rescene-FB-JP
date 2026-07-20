(()=>{
 const input=document.getElementById('siteSearchInput');
 const form=document.getElementById('siteSearchForm');
 const clear=document.getElementById('siteSearchClear');
 const resultsHost=document.getElementById('searchResults');
 const summaryTitle=document.getElementById('searchSummaryTitle');
 const summaryDetail=document.getElementById('searchSummaryDetail');
 const filters=[...document.querySelectorAll('[data-search-filter]')];
 const loadMoreWrap=document.getElementById('searchLoadMore');
 const loadMoreButton=document.getElementById('searchLoadMoreButton');
 const sourceNote=document.getElementById('searchSourceNote');
 const chips=[...document.querySelectorAll('[data-search-chip]')];
 const PAGE_SIZE=16;
 let allEntries=[];
 let activeFilter='all';
 let shown=PAGE_SIZE;
 let query='';
 let loadErrors=[];

 const escapeHtml=(value='')=>String(value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
 const katakanaToHiragana=(value='')=>value.replace(/[ァ-ヶ]/g,char=>String.fromCharCode(char.charCodeAt(0)-0x60));
 const normalized=(value='')=>katakanaToHiragana(String(value).normalize('NFKC').toLocaleLowerCase('ja-JP'))
  .replace(/[\u3000\s]+/g,' ')
  .replace(/[!-/:-@\[-`{-~。、・「」『』【】（）［］｛｝〈〉《》！？：；〜～…]/g,' ')
  .replace(/\s+/g,' ').trim();
 const compact=(value='')=>normalized(value).replace(/\s+/g,'');
 const aliasGroups=[
  ['RESCENE','リセンヌ','리센느'],
  ['WONI','ウォニ','원이'],
  ['LIV','リブ','리브'],
  ['MINAMI','ミナミ','미나미'],
  ['MAY','メイ','메이'],
  ['ZENA','ゼナ','제나'],
  ['REMINE','リマイン','리마인'],
  ['掛け声','掛声','応援法','fan chant'],
  ['MV','ミュージックビデオ','music video'],
  ['THE SHOW','ザショー','더쇼'],
  ['SHOW CHAMPION','ショーチャンピオン','쇼챔피언','ショーチャン'],
  ['M COUNTDOWN','エムカウントダウン','엠카운트다운','エムカ'],
  ['Music Bank','ミュージックバンク','뮤직뱅크','ミューバン'],
  ['Show! Music Core','ショー音楽中心','쇼 음악중심','ウマチュン'],
  ['Inkigayo','人気歌謡','인기가요'],
 ];
 const normalizedAliasGroups=aliasGroups.map(group=>group.map(compact));
 const tokenAlternatives=token=>{
  const key=compact(token);
  const group=normalizedAliasGroups.find(items=>items.includes(key));
  return group||[key];
 };
 const enrichSearchText=entry=>{
  let text=[entry.title,entry.summary,entry.keywords,entry.categoryLabel].filter(Boolean).join(' ');
  const base=compact(text);
  aliasGroups.forEach((group,index)=>{
   if(normalizedAliasGroups[index].some(alias=>base.includes(alias)))text+=` ${group.join(' ')}`;
  });
  return {spaced:normalized(text),compact:compact(text),title:compact(entry.title)};
 };
 const formatDate=value=>{
  if(!value)return '';
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return String(value).slice(0,10).replaceAll('-','.');
  return new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
 };
 const categoryGroup=category=>({discography:'music',mv:'music',streaming:'guides',voting:'guides',officiallinks:'guides',about:'guides',site:'guides'}[category]||category);
 const typeLabel=type=>({short:'SHORT',live:'LIVE',video:'VIDEO'}[type]||'VIDEO');
 const normalizeEntry=(entry,index)=>{
  const safe={
   id:String(entry.id||`entry-${index}`),category:String(entry.category||'site'),categoryLabel:String(entry.categoryLabel||'SITE'),
   title:String(entry.title||'名称未設定'),summary:String(entry.summary||''),url:String(entry.url||'#'),keywords:String(entry.keywords||''),
   image:String(entry.image||''),date:String(entry.date||''),external:Boolean(entry.external),priority:Number(entry.priority)||0,
  };
  safe.search=enrichSearchText(safe);
  safe.group=categoryGroup(safe.category);
  return safe;
 };

 const newsEntries=data=>(Array.isArray(data?.news)?data.news:[]).map((item,index)=>({
  id:`news-${item.slug||index}`,category:'news',categoryLabel:item.label||'NEWS',title:item.title||'ニュース',summary:item.text||'',
  url:`articles/${encodeURIComponent(item.slug||'')}.html`,keywords:`${item.category||''} ${item.label||''} ニュース 記事`,image:item.image||'',date:item.date||'',priority:86,
 }));
 const scheduleEntries=data=>(Array.isArray(data?.events)?data.events:[]).map((item,index)=>{
  const date=String(item.date||item.start||'').slice(0,10);
  const id=String(item.id||index);
  const anchor=`event-${id.replace(/[^a-zA-Z0-9_-]/g,'-')}`;
  const params=new URLSearchParams();
  if(date)params.set('date',date);
  params.set('event',id);
  const scheduleUrl='schedule.html?'+params.toString()+'#'+anchor;
  return {id:`schedule-${id}`,category:'schedule',categoryLabel:String(item.category||'SCHEDULE').toUpperCase(),title:item.title||'予定',summary:item.description||'公開スケジュールの予定です。',url:scheduleUrl,keywords:`${item.type||''} ${item.category||''} 予定 日程 カレンダー`,image:item.image||'',date,priority:82};
 });
 const discographyEntries=data=>(Array.isArray(data?.releases)?data.releases:[]).map((item,index)=>({
  id:`discography-${item.slug||index}`,category:'discography',categoryLabel:item.badge||item.categoryName||'DISCOGRAPHY',title:item.title||'作品',summary:item.description||'',
  url:`discography.html#${item.anchor||`release-${item.slug||index}`}`,keywords:`${item.categoryName||''} ${item.type||''} ${(Array.isArray(item.tracks)?item.tracks.map(track=>track.title).join(' '):'')} アルバム シングル OST 収録曲`,image:item.cover||'',date:item.releaseDate||'',priority:80,
 }));


 const chantEntries=data=>(Array.isArray(data?.chants)?data.chants:[]).map((item,index)=>({
  id:`fanchant-${item.slug||index}`,category:'chants',categoryLabel:item.videoType||'FAN CHANT',title:item.title||'掛け声ガイド',summary:`${item.album||item.categoryTitle||''}の掛け声ガイドです。${item.note||''}`,
  url:`chants.html#${item.anchor||`chant-${item.slug||index}`}`,keywords:`${item.categoryTitle||''} ${item.album||''} ${item.videoType||''} 掛け声 掛声 応援法 fan chant`,image:item.image||'',priority:76,
 }));

 const youtubeEntries=data=>(Array.isArray(data?.channels)?data.channels:[]).flatMap(channel=>(Array.isArray(channel.videos)?channel.videos:[]).map((video,index)=>({
  id:`youtube-${channel.key||'channel'}-${video.videoId||index}`,category:'youtube',categoryLabel:typeLabel(video.videoType),title:video.title||'YouTube動画',
  summary:`${channel.label||channel.handle||'YouTube'}で公開された${typeLabel(video.videoType).toLowerCase()}動画です。`,url:video.url||channel.url||'youtube.html',
  keywords:`${channel.label||''} ${channel.handle||''} ${video.videoType||'video'} YouTube 動画 ショート ライブ`,image:video.thumbnail||'',date:video.publishedAt||'',external:/^https?:\/\//i.test(video.url||''),priority:55,
 })));

 const mvEntries=data=>(Array.isArray(data?.items)?data.items:[]).map((item,index)=>({
  id:`mv-${item.videoId||index}`,category:'mv',categoryLabel:item.badge||item.kind||'MUSIC VIDEO',title:item.title||'Music Video',
  summary:`RESCENEの${item.badge||item.kind||'公式映像'}です。${item.note||''}`,url:`mv.html#${item.anchor||`mv-${item.videoId||index}`}`,
  keywords:`${item.kind||''} ${item.type||''} MV ミュージックビデオ music video special clip performance OST`,image:item.thumbnail||'',date:item.date||item.publishedAt||'',priority:78,
 }));


 const streamingEntries=data=>(Array.isArray(data?.guides)?data.guides:[]).map((item,index)=>({
  id:`streaming-${index}`,category:'streaming',categoryLabel:item.type||'STREAMING GUIDE',title:item.title||'ストリーミングガイド',summary:`${item.subtitle||''}。${item.description||''}`,
  url:`streaming.html#${item.anchor||''}`,keywords:`${item.type||''} ${(Array.isArray(item.points)?item.points.join(' '):'')} ${item.note||''} ストリーミング 再生 ガイド`,image:item.icon||(Array.isArray(item.steps)?item.steps.find(step=>step?.image)?.image:'')||'',priority:75,
 }));

 const memberEntries=data=>(Array.isArray(data?.members)?data.members:[]).map((item,index)=>({
  id:`member-${item.slug||index}`,category:'members',categoryLabel:'MEMBER',title:item.name||'メンバー',summary:`${item.koreanName||''} / ${item.japaneseName||''}。${item.shortDescription||item.profile||''}`,
  url:`members.html#${item.anchor||`${item.slug||index}-profile`}`,keywords:`${item.koreanName||''} ${item.japaneseName||''} ${item.realName||''} ${item.birthPlace||''} ${item.keywords||''} ${item.colorName||''} メンバー プロフィール`,image:item.previewImage||item.detailImage||'',date:item.birthDate||'',priority:79,
 }));

 const officialLinkEntries=data=>(Array.isArray(data?.links)?data.links:[]).map((item,index)=>({
  id:`official-link-${item.anchor||index}`,category:'officiallinks',categoryLabel:item.category||'OFFICIAL LINKS',title:item.title||'公式リンク',
  summary:`${item.subtitle||''}。${item.description||''}`,url:item.url||'links.html',keywords:`${item.category||''} ${item.label||''} ${item.subtitle||''} 公式リンク SNS コミュニティ 音楽配信`,
  image:item.icon||'',external:/^https?:\/\//i.test(item.url||''),priority:70,
 }));

 const aboutEntries=data=>(Array.isArray(data?.items)?data.items:[]).filter(item=>item?.type!=='ページ設定').map((item,index)=>({
  id:`about-${item.slug||index}`,category:'about',categoryLabel:item.englishLabel||item.type||'ABOUT RESCENE',title:item.heading||item.value||item.title||'RESCENEについて',
  summary:item.description||item.note||'',url:`about.html${item.anchor?`#${item.anchor}`:''}`,keywords:`${item.type||''} ${item.englishLabel||''} ${item.value||''} RESCENE グループ 紹介 コンセプト デビュー REMINE`,
  image:item.image||'',date:item.date||'',priority:77,
 }));

 const votingEntries=data=>{
  const programs=(Array.isArray(data?.programs)?data.programs:[]).map((item,index)=>({
   id:`voting-program-${index}`,category:'voting',categoryLabel:'VOTING PROGRAM',title:item.title||'音楽番組',summary:`${item.subtitle||''} ${item.voteType||''}。使用アプリ：${item.app||'未設定'}。${item.note||''}`,
   url:'voting.html#quick-table',keywords:`${item.subtitle||''} ${item.voteType||''} ${item.app||''} ${item.currency||''} ${item.period||''} 投票 音楽番組`,image:item.icon||'',priority:74,
  }));
  const apps=(Array.isArray(data?.apps)?data.apps:[]).map((item,index)=>({
   id:`voting-app-${index}`,category:'voting',categoryLabel:'VOTING APP',title:item.title||'投票アプリ',summary:`${item.subtitle||item.description||''}の投票アプリです。`,
   url:'voting.html#apps',keywords:`${(Array.isArray(item.tags)?item.tags.join(' '):'')} 投票アプリ 画像ガイド 貯め方 投票方法`,image:item.icon||'',priority:73,
  }));
  return [...programs,...apps];
 };

 const fetchJson=async url=>{
  const response=await fetch(`${url}?v=${Date.now()}`,{cache:'no-store'});
  if(!response.ok)throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
 };
 const loadIndex=async()=>{
  const requests=[
   ['固定ページ',()=>fetchJson('data/search-index.json')],
   ['ニュース',()=>fetchJson('data/news.json')],
   ['スケジュール',()=>fetchJson('data/schedule.json')],
   ['YouTube',()=>fetchJson('data/youtube-channels.json')],
   ['MV一覧',()=>fetchJson('data/mv.json')],
   ['ディスコグラフィ',()=>fetchJson('data/discography.json')],
   ['掛け声ガイド',()=>fetchJson('data/chants.json')],
   ['投票ガイド',()=>fetchJson('data/voting-guide.json')],
   ['ストリーミングガイド',()=>fetchJson('data/streaming-guide.json')],
   ['メンバー',()=>fetchJson('data/members.json')],
   ['公式リンク',()=>fetchJson('data/official-links.json')],
   ['About',()=>fetchJson('data/about.json')],
  ];
  const settled=await Promise.allSettled(requests.map(([,loader])=>loader()));
  let entries=[];
  settled.forEach((result,index)=>{
   const label=requests[index][0];
   if(result.status==='rejected'){loadErrors.push(label);console.error(result.reason);return;}
   if(index===0)entries.push(...(Array.isArray(result.value?.entries)?result.value.entries:[]));
   if(index===1)entries.push(...newsEntries(result.value));
   if(index===2)entries.push(...scheduleEntries(result.value));
   if(index===3)entries.push(...youtubeEntries(result.value));
   if(index===4){entries=entries.filter(entry=>entry.category!=='mv'||entry.url==='mv.html');entries.push(...mvEntries(result.value));}
   if(index===5){entries=entries.filter(entry=>entry.category!=='discography');entries.push(...discographyEntries(result.value));}
   if(index===6){entries=entries.filter(entry=>entry.category!=='chants'||entry.url==='chants.html');entries.push(...chantEntries(result.value));}
   if(index===7){entries=entries.filter(entry=>entry.category!=='voting'||entry.url==='voting.html');entries.push(...votingEntries(result.value));}
   if(index===8){entries=entries.filter(entry=>entry.category!=='streaming'||entry.url==='streaming.html');entries.push(...streamingEntries(result.value));}
   if(index===9){entries=entries.filter(entry=>entry.category!=='members'||entry.url==='members.html');entries.push(...memberEntries(result.value));}
   if(index===10){entries=entries.filter(entry=>entry.category!=='officiallinks');entries.push(...officialLinkEntries(result.value));}
   if(index===11)entries.push(...aboutEntries(result.value));
  });
  const seen=new Set();
  allEntries=entries.map(normalizeEntry).filter(entry=>{
   const key=`${entry.category}|${entry.title}|${entry.url}`;
   if(seen.has(key))return false;
   seen.add(key);return true;
  });
  updateFilterCounts();
  sourceNote.textContent=loadErrors.length?`一部のデータ（${loadErrors.join('・')}）を読み込めませんでした。読み込めた範囲で検索しています。`:`固定ページと最新の同期データ、合計${allEntries.length.toLocaleString('ja-JP')}件を検索できます。`;
  applyUrlState();
 };

 const scoreEntry=(entry,tokens,whole)=>{
  let score=entry.priority;
  const wholeCompact=compact(whole);
  if(entry.search.title===wholeCompact)score+=220;
  else if(entry.search.title.startsWith(wholeCompact))score+=145;
  else if(entry.search.title.includes(wholeCompact))score+=105;
  if(entry.search.compact.includes(wholeCompact))score+=45;
  tokens.forEach(token=>{
   const alternatives=tokenAlternatives(token);
   if(alternatives.some(value=>entry.search.title===value))score+=100;
   else if(alternatives.some(value=>entry.search.title.includes(value)))score+=58;
   else if(alternatives.some(value=>entry.search.compact.includes(value)))score+=22;
  });
  if(entry.category==='news')score+=5;
  return score;
 };
 const filteredResults=()=>{
  const whole=normalized(query);
  if(!whole)return [];
  const tokens=whole.split(' ').filter(Boolean);
  return allEntries.filter(entry=>{
   if(activeFilter!=='all'&&entry.group!==activeFilter&&entry.category!==activeFilter)return false;
   return tokens.every(token=>tokenAlternatives(token).some(value=>entry.search.compact.includes(value)));
  }).map(entry=>({...entry,score:scoreEntry(entry,tokens,whole)}))
   .sort((a,b)=>b.score-a.score||String(b.date).localeCompare(String(a.date))||a.title.localeCompare(b.title,'ja'));
 };
 const renderState=(icon,title,text,loading=false)=>{
  resultsHost.innerHTML=`<div class="card search-state"><div class="search-state-icon">${escapeHtml(icon)}</div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(text)}</p>${loading?'<div class="search-loading-lines"><span></span><span></span><span></span></div>':''}</div>`;
  loadMoreWrap.hidden=true;
 };
 const resultCard=entry=>{
  const image=entry.image?`<div class="search-result-thumb"><img src="${escapeHtml(entry.image)}" alt="" loading="lazy" onerror="this.parentElement.remove();this.closest('.search-result').classList.remove('has-image')"></div>`:'';
  return `<a class="card search-result${entry.image?' has-image':''}" href="${escapeHtml(entry.url)}"${entry.external?' target="_blank" rel="noopener noreferrer"':''}>${image}<div class="search-result-body"><div class="search-result-top"><span class="search-result-category">${escapeHtml(entry.categoryLabel)}</span>${entry.date?`<time class="search-result-date">${escapeHtml(formatDate(entry.date))}</time>`:''}</div><h2>${escapeHtml(entry.title)}</h2>${entry.summary?`<p>${escapeHtml(entry.summary)}</p>`:''}<span class="search-result-open">${entry.external?'外部サイトで見る ↗':'ページを見る →'}${entry.external?'<small class="search-result-external">YouTubeなど</small>':''}</span></div></a>`;
 };
 const render=()=>{
  clear.hidden=!input.value;
  if(!allEntries.length){renderState('⌕','検索データを読み込み中','固定ページと同期データを準備しています。',true);return;}
  if(!query){
   summaryTitle.textContent='サイト内検索';summaryDetail.textContent=`${allEntries.length.toLocaleString('ja-JP')}件を検索可能`;
   renderState('⌕','キーワードを入力してください','楽曲名、メンバー名、ニュース、予定、投票アプリなどを横断して探せます。');return;
  }
  const results=filteredResults();
  const visible=results.slice(0,shown);
  summaryTitle.textContent=`「${query}」の検索結果`;
  summaryDetail.textContent=`${results.length.toLocaleString('ja-JP')}件見つかりました`;
  if(!results.length){renderState('？','検索結果がありません','表記を短くするか、別の言語・キーワードでもお試しください。');return;}
  resultsHost.innerHTML=visible.map(resultCard).join('');
  loadMoreWrap.hidden=visible.length>=results.length;
  loadMoreButton.textContent=`さらに${Math.min(PAGE_SIZE,results.length-visible.length)}件表示`;
 };
 const updateFilterCounts=()=>{
  filters.forEach(button=>{
   const filter=button.dataset.searchFilter;
   const count=filter==='all'?allEntries.length:allEntries.filter(entry=>entry.group===filter||entry.category===filter).length;
   const target=button.querySelector('small');if(target)target.textContent=count.toLocaleString('ja-JP');
   button.disabled=count===0;
  });
 };
 const syncUrl=()=>{
  const params=new URLSearchParams(location.search);
  if(query)params.set('q',query);else params.delete('q');
  if(activeFilter!=='all')params.set('category',activeFilter);else params.delete('category');
  const url=`${location.pathname}${params.toString()?`?${params}`:''}`;
  history.replaceState(null,'',url);
 };
 const setQuery=(value,{focus=true}={})=>{
  query=String(value||'').trim();input.value=query;shown=PAGE_SIZE;syncUrl();render();if(focus)input.focus();
 };
 const setFilter=value=>{
  activeFilter=value||'all';shown=PAGE_SIZE;filters.forEach(button=>button.classList.toggle('active',button.dataset.searchFilter===activeFilter));syncUrl();render();
 };
 const applyUrlState=()=>{
  const params=new URLSearchParams(location.search);
  const requestedFilter=params.get('category')||'all';
  activeFilter=filters.some(button=>button.dataset.searchFilter===requestedFilter)?requestedFilter:'all';
  query=(params.get('q')||'').trim();input.value=query;
  filters.forEach(button=>button.classList.toggle('active',button.dataset.searchFilter===activeFilter));
  render();
  if(!query)input.focus();
 };

 form.addEventListener('submit',event=>{event.preventDefault();setQuery(input.value)});
 input.addEventListener('input',()=>{query=input.value.trim();shown=PAGE_SIZE;clear.hidden=!input.value;syncUrl();render()});
 clear.addEventListener('click',()=>setQuery(''));
 filters.forEach(button=>button.addEventListener('click',()=>setFilter(button.dataset.searchFilter)));
 chips.forEach(button=>button.addEventListener('click',()=>setQuery(button.dataset.searchChip)));
 loadMoreButton.addEventListener('click',()=>{shown+=PAGE_SIZE;render()});
 document.addEventListener('keydown',event=>{
  if(event.key==='/'&&!['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)){event.preventDefault();input.focus()}
  if(event.key==='Escape'&&document.activeElement===input)setQuery('');
 });
 renderState('⌕','検索データを読み込み中','固定ページと同期データを準備しています。',true);
 loadIndex();
})();
