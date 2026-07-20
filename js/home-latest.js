(()=>{
  'use strict';

  const elements={
    schedule:document.getElementById('homeNextSchedule'),
    news:document.getElementById('homeLatestNews'),
    youtube:document.getElementById('homeLatestYoutube'),
    guides:document.getElementById('homeLatestGuides'),
    status:document.getElementById('homeLatestStatus'),
  };
  if(!elements.schedule||!elements.news||!elements.youtube||!elements.guides)return;

  const escapeHtml=(value='')=>String(value).replace(/[&<>"']/g,char=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  })[char]);
  const safeUrl=(value='',fallback='#')=>{
    const url=String(value||'').trim();
    if(!url)return fallback;
    if(/^(https?:\/\/|[A-Za-z0-9_.\/-]+\.html(?:[?#].*)?|#[A-Za-z0-9_-]+)$/i.test(url))return url;
    return fallback;
  };
  const safeImage=(value='')=>/^https?:\/\//i.test(String(value||''))?String(value):'';
  const pad=value=>String(value).padStart(2,'0');
  const tokyoParts=(date=new Date())=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{
    timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',
  }).formatToParts(date).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
  const now=new Date();
  const todayParts=tokyoParts(now);
  const todayKey=`${todayParts.year}-${todayParts.month}-${todayParts.day}`;
  const todayYear=Number(todayParts.year);
  const dateKey=value=>String(value||'').slice(0,10);
  const keyNumber=value=>Number(String(value||'').replaceAll('-',''))||0;
  const parseTime=value=>{
    if(!value||!String(value).includes('T'))return null;
    const parsed=new Date(value);
    return Number.isNaN(parsed.getTime())?null:parsed;
  };
  const formatDateKey=(value,withYear=false)=>{
    const match=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!match)return '';
    const date=new Date(Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3])));
    return new Intl.DateTimeFormat('ja-JP',{timeZone:'UTC',...(withYear?{year:'numeric'}:{}),month:'numeric',day:'numeric',weekday:'short'}).format(date);
  };
  const formatTime=value=>{
    const date=parseTime(value);
    if(!date)return '';
    return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}).format(date);
  };
  const formatTimestamp=value=>{
    const date=new Date(value||'');
    if(Number.isNaN(date.getTime()))return '';
    return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(date);
  };
  const formatGuideDate=value=>{
    const date=new Date(value||'');
    if(Number.isNaN(date.getTime()))return '';
    return `${new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric'}).format(date)} 更新`;
  };
  const fetchJson=async path=>{
    const response=await fetch(`${path}?v=${Date.now()}`,{cache:'no-store'});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    return response.json();
  };
  const empty=message=>`<div class="home-feed-empty">${escapeHtml(message)}</div>`;

  const recurringDefinitions=[
    {name:'WONI',month:5,day:25,type:'birthday',category:'Birthday',description:'ウォニの誕生日です。'},
    {name:'MAY',month:8,day:19,type:'birthday',category:'Birthday',description:'メイの誕生日です。'},
    {name:'LIV',month:10,day:11,type:'birthday',category:'Birthday',description:'リブの誕生日です。'},
    {name:'ZENA',month:11,day:27,type:'birthday',category:'Birthday',description:'ゼナの誕生日です。'},
    {name:'MINAMI',month:11,day:29,type:'birthday',category:'Birthday',description:'ミナミの誕生日です。'},
  ];
  const recurringEvents=years=>{
    const events=[];
    years.forEach(year=>{
      recurringDefinitions.forEach(item=>{
        const date=`${year}-${pad(item.month)}-${pad(item.day)}`;
        events.push({id:`auto-birthday-${item.name.toLowerCase()}-${year}`,title:`${item.name} 誕生日`,date,start:date,end:'',category:item.category,type:item.type,description:item.description});
      });
      if(year>=2024){
        const anniversary=year-2024;
        const date=`${year}-03-26`;
        events.push({id:`auto-debut-anniversary-${year}`,title:anniversary>0?`RESCENE デビュー${anniversary}周年`:'RESCENE デビュー記念日',date,start:date,end:'',category:'記録',type:'record',description:`2024年3月26日にデビューしたRESCENEの${anniversary>0?`${anniversary}周年`:'デビュー'}記念日です。`});
      }
    });
    return events;
  };
  const duplicateRecurring=(candidate,events)=>events.some(event=>{
    if(dateKey(event.start||event.date)!==candidate.date)return false;
    const title=String(event.title||'').toUpperCase().replace(/\s+/g,'');
    if(candidate.type==='birthday')return title.includes(candidate.title.split(' ')[0])&&(String(event.type||'').toLowerCase()==='birthday'||String(event.category||'').toLowerCase()==='birthday');
    return /デビュー|ANNIVERSARY/.test(title);
  });
  const upcomingEvents=source=>{
    const base=Array.isArray(source)?source:[];
    const recurring=recurringEvents([todayYear,todayYear+1]).filter(item=>!duplicateRecurring(item,base));
    return [...base,...recurring].filter(event=>{
      const startValue=String(event.start||event.date||'');
      if(!startValue)return false;
      if(startValue.includes('T')){
        const start=parseTime(startValue);
        const explicitEnd=parseTime(event.end);
        const end=explicitEnd||(start?new Date(start.getTime()+60*60*1000):null);
        return Boolean(end&&end>=now);
      }
      const endKey=dateKey(event.end||startValue);
      return keyNumber(endKey)>=keyNumber(todayKey);
    }).sort((a,b)=>{
      const aStart=String(a.start||a.date||'');
      const bStart=String(b.start||b.date||'');
      const aTime=parseTime(aStart)?.getTime()??keyNumber(dateKey(aStart))*86400000;
      const bTime=parseTime(bStart)?.getTime()??keyNumber(dateKey(bStart))*86400000;
      return aTime-bTime||String(a.title||'').localeCompare(String(b.title||''),'ja');
    });
  };
  const eventDateLabel=event=>{
    const startValue=String(event.start||event.date||'');
    const startKey=dateKey(startValue);
    const endKey=dateKey(event.end||startKey);
    const time=formatTime(startValue);
    const endTime=formatTime(event.end);
    const range=endKey&&endKey!==startKey?`${formatDateKey(startKey)}〜${formatDateKey(endKey)}`:formatDateKey(startKey);
    if(time)return `${range} ${time}${endTime?`〜${endTime}`:''}`;
    if(keyNumber(startKey)<=keyNumber(todayKey)&&keyNumber(endKey)>=keyNumber(todayKey)&&startKey!==endKey)return `開催中・${range}`;
    return range;
  };
  const eventBadge=event=>({birthday:'BIRTHDAY',record:'ANNIVERSARY',release:'RELEASE',vote:'VOTE'})[String(event.type||'').toLowerCase()]||String(event.category||'EVENT').toUpperCase();
  const renderSchedule=payload=>{
    const events=upcomingEvents(payload?.events).slice(0,2);
    if(!events.length){elements.schedule.innerHTML=empty('現在登録されている今後の予定はありません。');return;}
    elements.schedule.innerHTML=events.map(event=>{
      const startKey=dateKey(event.start||event.date);
      const href=`schedule.html?date=${encodeURIComponent(startKey)}&event=${encodeURIComponent(event.id||'')}`;
      return `<a class="home-feed-item" href="${href}"><div class="home-feed-item-head"><span class="home-feed-date">${escapeHtml(eventDateLabel(event))}</span><span class="home-feed-badge">${escapeHtml(eventBadge(event))}</span></div><strong>${escapeHtml(event.title||'予定')}</strong>${event.description?`<p>${escapeHtml(event.description)}</p>`:''}</a>`;
    }).join('');
  };

  const newsDateValue=value=>{
    const match=String(value||'').match(/^(\d{4})[.-](\d{1,2})[.-](\d{1,2})$/);
    return match?Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3])):0;
  };
  const renderNews=payload=>{
    const source=Array.isArray(payload?.news)?payload.news:(Array.isArray(window.RESCENE_NEWS)?window.RESCENE_NEWS:[]);
    const news=source.map((item,index)=>({item,index,value:newsDateValue(item.date)})).sort((a,b)=>b.value-a.value||a.index-b.index).map(row=>row.item).slice(0,2);
    if(!news.length){elements.news.innerHTML=empty('最新ニュースを読み込めませんでした。');return;}
    elements.news.innerHTML=news.map(item=>{
      const href=item.slug?`articles/${encodeURIComponent(item.slug)}.html`:safeUrl(item.link,'news.html');
      return `<a class="home-feed-item" href="${escapeHtml(href)}"><div class="home-feed-item-head"><span class="home-feed-date">${escapeHtml(item.date||'UPDATE')}</span><span class="home-feed-badge">${escapeHtml(item.label||item.category||'NEWS')}</span></div><strong>${escapeHtml(item.title||'ニュース')}</strong>${item.text?`<p>${escapeHtml(item.text)}</p>`:''}</a>`;
    }).join('');
  };

  const renderYoutube=payload=>{
    const channels=Array.isArray(payload?.channels)?payload.channels:[];
    const seen=new Set();
    const videos=channels.flatMap(channel=>(Array.isArray(channel.videos)?channel.videos:[]).map(video=>({...video,channelLabel:channel.label||channel.handle||'YouTube'}))).filter(video=>{
      const key=video.videoId||video.url;
      if(!key||seen.has(key))return false;
      seen.add(key);return true;
    }).sort((a,b)=>new Date(b.publishedAt||0)-new Date(a.publishedAt||0));
    const video=videos[0];
    if(!video){elements.youtube.innerHTML=empty('最新動画を読み込めませんでした。');return;}
    const type=String(video.videoType||'video');
    const typeLabel={short:'SHORTS',live:'LIVE',video:'VIDEO'}[type]||'VIDEO';
    const image=safeImage(video.thumbnail);
    elements.youtube.innerHTML=`<a class="home-feed-item home-video-link" href="${escapeHtml(safeUrl(video.url,'youtube.html'))}" target="_blank" rel="noopener noreferrer"><span class="home-video-thumb">${image?`<img src="${escapeHtml(image)}" alt="" loading="lazy" width="480" height="270">`:''}</span><span class="home-video-copy"><span class="home-feed-item-head"><span class="home-feed-badge">${typeLabel}</span><span class="home-feed-date">${escapeHtml(formatTimestamp(video.publishedAt))}</span></span><strong>${escapeHtml(video.title||'YouTube動画')}</strong><p>${escapeHtml(video.channelLabel)}</p></span></a>`;
  };

  const guideIcon=category=>({VOTING:'V',FANCHANT:'F',STREAMING:'S',YOUTUBE:'YT','MUSIC VIDEO':'MV',DISCOGRAPHY:'D'})[String(category||'').toUpperCase()]||'G';
  const renderGuides=payload=>{
    const guides=(Array.isArray(payload?.guides)?payload.guides:[]).slice().sort((a,b)=>new Date(b.updatedAt||0)-new Date(a.updatedAt||0)).slice(0,2);
    if(!guides.length){elements.guides.innerHTML=empty('ガイド更新情報を読み込めませんでした。');return;}
    elements.guides.innerHTML=guides.map(guide=>`<a class="home-feed-item home-guide-item" href="${escapeHtml(safeUrl(guide.url,'search.html'))}"><span class="home-guide-icon">${escapeHtml(guideIcon(guide.category))}</span><span class="home-guide-copy"><strong>${escapeHtml(guide.title||'ガイド')}</strong><span>${escapeHtml(formatGuideDate(guide.updatedAt)||guide.category||'GUIDE')}</span></span><span class="home-guide-arrow">→</span></a>`).join('');
  };

  const jobs=[
    {key:'schedule',path:'data/schedule.json',render:renderSchedule},
    {key:'news',path:'data/news.json',render:renderNews},
    {key:'youtube',path:'data/youtube-channels.json',render:renderYoutube},
    {key:'guides',path:'data/home-guides.json',render:renderGuides},
  ];

  Promise.allSettled(jobs.map(job=>fetchJson(job.path))).then(results=>{
    let success=0;
    results.forEach((result,index)=>{
      const job=jobs[index];
      if(result.status==='fulfilled'){
        try{job.render(result.value);success+=1;}
        catch(error){console.warn(`${job.key}の描画に失敗しました。`,error);elements[job.key].innerHTML=empty('表示中にエラーが発生しました。');}
      }else{
        console.warn(`${job.path}の取得に失敗しました。`,result.reason);
        if(job.key==='news'&&Array.isArray(window.RESCENE_NEWS)){
          renderNews({news:window.RESCENE_NEWS});success+=1;
        }else elements[job.key].innerHTML=empty('最新データを読み込めませんでした。');
      }
    });
    if(elements.status){
      elements.status.textContent=success===jobs.length?`最新データ確認・${formatTimestamp(new Date().toISOString())}`:`${success}/${jobs.length}項目を表示・一部取得エラー`;
      if(success!==jobs.length)elements.status.classList.add('home-feed-warning');
    }
  });
})();
