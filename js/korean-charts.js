(()=>{
  'use strict';

  const data=window.RESCENE_KOREAN_CHARTS||{};
  const charts=(Array.isArray(data.charts)?data.charts:[])
    .filter(item=>item?.published!==false)
    .sort((a,b)=>(a.order||9999)-(b.order||9999));
  const songs=(Array.isArray(data.songs)?data.songs:[])
    .filter(item=>item?.published!==false)
    .sort((a,b)=>(a.order||9999)-(b.order||9999));
  const rawEntries=Array.isArray(data.entries)?data.entries:[];
  const sourceStatus=data.sourceStatus||{};
  const byId=(id)=>document.getElementById(id);
  const chartMap=Object.fromEntries(charts.map(item=>[item.id,item]));
  const songMap=Object.fromEntries(songs.map(item=>[item.id,item]));
  const entryKey=(songId,chartId)=>`${songId}--${chartId}`;
  const existingEntries=new Map(rawEntries.map(item=>[entryKey(item.songId,item.chartId),item]));

  let view='chart';
  let selectedEntry=null;
  let selectedHistory={points:[],sources:[],outOfChartHistory:[],summary:{}};
  let selectedHistoryChart={maxRank:100,cadence:'daily'};
  let historyRequestId=0;
  let historyController=null;
  const historyCache=new Map();

  const isRank=(value)=>{
    if(value===null||value===undefined||value==='')return false;
    const number=Number(value);
    return Number.isFinite(number)&&number>=1;
  };
  const esc=(value)=>String(value??'').replace(/[&<>"]/g,char=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'
  }[char]));
  const parseDate=(value)=>{
    const date=new Date(value);
    return Number.isNaN(date.getTime())?null:date;
  };
  const dateTime=(value,short=false)=>{
    const date=parseDate(value);
    if(!date)return value?String(value):'—';
    const options=short
      ?{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Asia/Tokyo'}
      :{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Tokyo'};
    return new Intl.DateTimeFormat('ja-JP',options).format(date);
  };
  const timeLabel=(value)=>{
    const date=parseDate(value);
    return date
      ?new Intl.DateTimeFormat('ja-JP',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Tokyo'}).format(date)
      :'—';
  };
  const pointTooltipLabel=(value,hourly=false)=>{
    const date=parseDate(value);
    if(!date)return value?String(value):'—';
    const options=hourly
      ?{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Tokyo'}
      :{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Asia/Tokyo'};
    return new Intl.DateTimeFormat('ja-JP',options).format(date);
  };
  const dayKey=(value)=>{
    const date=parseDate(value);
    return date
      ?new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(date)
      :'';
  };
  const rankLabel=(value)=>isRank(value)?`#${Number(value)}`:'圏外';
  const statusOf=(chartId)=>sourceStatus[chartId]||{};

  function movement(entry){
    const type=entry?.movementType||'';
    if(type==='up')return {text:`▲${Math.abs(Number(entry.movement)||0)}`,className:'is-up'};
    if(type==='down')return {text:`▼${Math.abs(Number(entry.movement)||0)}`,className:'is-down'};
    if(type==='same')return {text:'－',className:'is-same'};
    if(type==='new')return {text:'NEW',className:'is-new'};
    if(type==='reentry')return {text:'RE',className:'is-new'};
    if(type==='out')return {text:'OUT',className:'is-down'};
    return {text:'—',className:'is-same'};
  }

  function makeDisplayEntry(song,chart){
    const found=existingEntries.get(entryKey(song.id,chart.id));
    if(found)return found;
    return {
      songId:song.id,
      songTitle:song.title,
      chartId:chart.id,
      chartName:chart.name,
      currentRank:null,
      previousRank:null,
      movement:null,
      movementType:'untracked',
      status:'untracked',
      peakRank:null,
      firstChartedAt:'',
      lastChartedAt:'',
      chartDays:0,
      outOfChartHistory:[],
      historyPath:`data/korean-chart-history/${song.id}--${chart.id}.json`
    };
  }

  function completeEntries(){
    const matrix=[];
    charts.forEach(chart=>{
      songs.forEach(song=>{
        if(Array.isArray(song.charts)&&song.charts.includes(chart.id)){
          matrix.push(makeDisplayEntry(song,chart));
        }
      });
    });
    return matrix;
  }

  const entries=completeEntries();

  function installDisplayFixStyles(){
    if(document.getElementById('koreanChartDisplayFixStyles'))return;
    const style=document.createElement('style');
    style.id='koreanChartDisplayFixStyles';
    style.textContent=`
      .chart-rank-card{
        display:grid!important;
        grid-template-columns:minmax(92px,auto) minmax(150px,1fr) repeat(4,minmax(82px,auto)) auto!important;
        align-items:center!important;
        gap:14px!important;
      }
      .chart-rank-main{
        display:flex!important;
        align-items:center!important;
        justify-content:flex-start!important;
        flex-wrap:wrap!important;
        gap:5px 8px!important;
        min-width:0!important;
      }
      .chart-rank-number{white-space:nowrap!important}
      .chart-movement{
        position:static!important;
        flex:0 0 auto!important;
        white-space:nowrap!important;
        line-height:1.2!important;
      }
      .chart-rank-copy{min-width:0!important}
      .chart-rank-copy h3{
        min-width:0!important;
        overflow-wrap:anywhere!important;
        word-break:break-word!important;
        margin-top:3px!important;
      }
      .chart-rank-stat{min-width:0!important}
      .chart-svg-wrap{position:relative}
      .chart-point-detail{
        margin-top:10px;
        min-height:44px;
        display:flex;
        align-items:center;
        justify-content:center;
        gap:10px;
        border:1px solid var(--border-color,rgba(255,255,255,.14));
        border-radius:12px;
        padding:9px 12px;
        font-size:.9rem;
        text-align:center;
      }
      .chart-point-detail strong{font-size:1.05rem}
      .chart-rank-point{
        cursor:pointer;
        outline:none;
        transition:r .15s ease,stroke-width .15s ease,opacity .15s ease;
      }
      .chart-rank-point:hover,
      .chart-rank-point:focus,
      .chart-rank-point.is-selected{
        r:7;
        stroke-width:4px!important;
        opacity:1!important;
      }
      .chart-point-popover{
        opacity:0;
        pointer-events:none;
        visibility:hidden;
        transition:opacity .15s ease;
      }
      .chart-point-popover.is-visible{
        opacity:1;
        visibility:visible;
      }
      .chart-point-popover rect{
        fill:var(--card2);
        stroke:var(--pink-soft);
        stroke-width:1.5;
      }
      .chart-point-popover-date{
        fill:var(--muted);
        font-size:11px;
        font-weight:700;
      }
      .chart-point-popover-rank{
        fill:var(--text);
        font-size:15px;
        font-weight:900;
      }
      .chart-point-live{
        clip:rect(0 0 0 0);
        clip-path:inset(50%);
        height:1px;
        overflow:hidden;
        position:absolute;
        white-space:nowrap;
        width:1px;
      }
      @media(max-width:900px){
        .chart-rank-card{
          grid-template-columns:minmax(82px,auto) minmax(0,1fr) repeat(2,minmax(80px,1fr))!important;
        }
        .chart-history-button{grid-column:1/-1!important;width:100%!important}
      }
      @media(max-width:640px){
        .chart-rank-card{
          grid-template-columns:78px minmax(0,1fr)!important;
          gap:10px 12px!important;
        }
        .chart-rank-main{align-self:start!important}
        .chart-rank-copy{align-self:start!important}
        .chart-rank-stat{
          display:grid!important;
          grid-template-columns:minmax(0,1fr) auto!important;
          grid-column:1/-1!important;
          gap:8px!important;
          width:100%!important;
        }
        .chart-rank-stat span,.chart-rank-stat strong{white-space:normal!important}
        .chart-history-button{grid-column:1/-1!important}
        .chart-history-tools{align-items:flex-start!important}
        .chart-svg{min-height:250px}
        .chart-axis-label{font-size:12px!important}
      }
    `;
    document.head.appendChild(style);
  }

  function renderOverview(){
    if(byId('trackedSongCount'))byId('trackedSongCount').textContent=String(data.summary?.publishedSongs??songs.length);
    if(byId('trackedChartCount'))byId('trackedChartCount').textContent=String(data.summary?.chartCount??charts.length);
    if(byId('chartingNowCount'))byId('chartingNowCount').textContent=String(
      data.summary?.inChartCount??rawEntries.filter(item=>item.status==='in').length
    );
    if(byId('lastSyncAt'))byId('lastSyncAt').textContent=data.generatedAt?dateTime(data.generatedAt):'初回同期前';
  }

  function renderSourceStatus(){
    const root=byId('chartSourceStatus');
    if(!root)return;
    root.innerHTML=charts.map(chart=>{
      const status=statusOf(chart.id);
      const state=status.ok===true?'fresh':status.ok===false?'stale':'waiting';
      const pill=state==='fresh'?'正常':state==='stale'?'前回値を維持':'未実行';
      const detail=status.ok===false
        ?`取得失敗：${status.lastSuccessAt?`前回成功 ${dateTime(status.lastSuccessAt)}`:'正常取得待ち'}`
        :status.lastSuccessAt
          ?`${dateTime(status.lastSuccessAt)}／${status.itemCount||0}件取得`
          :`${chart.cadence||'hourly'}更新を待っています`;
      return `<article class="chart-source-card"><strong>${esc(chart.shortName||chart.name)}</strong><span class="source-pill is-${state}">${pill}</span><small>${esc(detail)}</small></article>`;
    }).join('')||'<p class="chart-empty card">公開対象チャートが設定されていません。</p>';
  }

  function configureRangeSelector(){
    const selector=byId('historyRangeSelector');
    if(!selector)return;
    const current=['all','7d','30d'].includes(selector.value)?selector.value:'all';
    selector.innerHTML=[
      ['all','全期間'],
      ['7d','直近1週間'],
      ['30d','直近30日']
    ].map(([value,label])=>`<option value="${value}">${label}</option>`).join('');
    selector.value=current;
  }

  function fillSelectors(){
    const chartSelector=byId('chartSelector');
    const songSelector=byId('songSelector');
    if(chartSelector){
      chartSelector.innerHTML=charts.map(item=>`<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');
      const first=charts.find(chart=>entries.some(entry=>entry.chartId===chart.id));
      if(first)chartSelector.value=first.id;
    }
    if(songSelector){
      songSelector.innerHTML=songs.map(item=>`<option value="${esc(item.id)}">${esc(item.title)}</option>`).join('');
      const first=songs.find(song=>entries.some(entry=>entry.songId===song.id));
      if(first)songSelector.value=first.id;
    }
  }

  function filteredEntries(){
    const statusFilter=byId('statusSelector')?.value||'all';
    let rows=view==='chart'
      ?entries.filter(item=>item.chartId===byId('chartSelector')?.value)
      :entries.filter(item=>item.songId===byId('songSelector')?.value);
    if(statusFilter==='in')rows=rows.filter(item=>item.status==='in'&&isRank(item.currentRank));
    if(statusFilter==='out')rows=rows.filter(item=>item.status!=='in'||!isRank(item.currentRank));
    const chartOrder=Object.fromEntries(charts.map((item,index)=>[item.id,index]));
    const songOrder=Object.fromEntries(songs.map((item,index)=>[item.id,index]));
    return rows.sort((a,b)=>view==='chart'
      ?((isRank(a.currentRank)?Number(a.currentRank):99999)-(isRank(b.currentRank)?Number(b.currentRank):99999)
        ||((songOrder[a.songId]??9999)-(songOrder[b.songId]??9999)))
      :((chartOrder[a.chartId]??9999)-(chartOrder[b.chartId]??9999)));
  }

  function rankCard(entry){
    const chart=chartMap[entry.chartId]||{name:entry.chartName||entry.chartId};
    const song=songMap[entry.songId]||{title:entry.songTitle||entry.songId};
    const move=movement(entry);
    const current=isRank(entry.currentRank);
    const stale=statusOf(entry.chartId).ok===false;
    return `<article class="card chart-rank-card" data-entry="${esc(entryKey(entry.songId,entry.chartId))}">
      <div class="chart-rank-main">
        <strong class="chart-rank-number${current?'':' is-out'}">${current?`#${Number(entry.currentRank)}`:'圏外'}</strong>
        <span class="chart-movement ${move.className}">${esc(move.text)}</span>
      </div>
      <div class="chart-rank-copy">
        <small>${esc(view==='chart'?chart.shortName||chart.name:song.title)}${stale?' · STALE':''}</small>
        <h3>${esc(view==='chart'?song.title:chart.name)}</h3>
      </div>
      <div class="chart-rank-stat"><span>前回順位</span><strong>${rankLabel(entry.previousRank)}</strong></div>
      <div class="chart-rank-stat"><span>最高順位</span><strong>${rankLabel(entry.peakRank)}</strong></div>
      <div class="chart-rank-stat"><span>初登場日</span><strong>${dateTime(entry.firstChartedAt,true)}</strong></div>
      <div class="chart-rank-stat"><span>チャートイン日数</span><strong>${Number(entry.chartDays)||0}日</strong></div>
      <button class="chart-history-button" type="button" data-history-song="${esc(entry.songId)}" data-history-chart="${esc(entry.chartId)}">推移を見る</button>
    </article>`;
  }

  function renderRankList(){
    const rows=filteredEntries();
    const message=byId('chartDataMessage');
    const list=byId('chartRankList');
    if(!list)return;
    if(!rows.length){
      if(message){
        message.hidden=false;
        message.textContent='選択した条件に該当するデータはありません。';
      }
      list.innerHTML='';
      renderEmptyHistory();
      return;
    }
    if(message)message.hidden=true;
    list.innerHTML=rows.map(rankCard).join('');
    list.querySelectorAll('[data-history-song]').forEach(button=>{
      button.addEventListener('click',()=>selectHistory(button.dataset.historySong,button.dataset.historyChart));
    });
    const selectedStillVisible=selectedEntry&&rows.some(item=>entryKey(item.songId,item.chartId)===entryKey(selectedEntry.songId,selectedEntry.chartId));
    if(!selectedStillVisible)selectHistory(rows[0].songId,rows[0].chartId);
  }

  function setView(next){
    view=next;
    document.querySelectorAll('[data-chart-view]').forEach(button=>{
      const active=button.dataset.chartView===view;
      button.classList.toggle('is-active',active);
      button.setAttribute('aria-selected',String(active));
    });
    byId('chartSelectorWrap')?.classList.toggle('is-hidden',view!=='chart');
    byId('songSelectorWrap')?.classList.toggle('is-hidden',view!=='song');
    renderRankList();
  }

  function renderEmptyHistory(message='順位履歴はまだありません。'){
    if(byId('chartSvgWrap'))byId('chartSvgWrap').innerHTML=`<p class="chart-empty">${esc(message)}</p>`;
    if(byId('chartHistoryStats'))byId('chartHistoryStats').innerHTML='';
    if(byId('chartHistorySource'))byId('chartHistorySource').innerHTML='';
    if(byId('chartOutHistory'))byId('chartOutHistory').innerHTML='';
  }

  function sortedPoints(points){
    return (Array.isArray(points)?points:[])
      .filter(point=>point&&point.chartAt)
      .slice()
      .sort((a,b)=>(parseDate(a.chartAt)?.getTime()||0)-(parseDate(b.chartAt)?.getTime()||0));
  }

  function latestRankedPoint(points){
    for(let index=points.length-1;index>=0;index-=1){
      if(isRank(points[index]?.rank))return {point:points[index],index};
    }
    return null;
  }

  function latestRankedDay(points){
    const latest=latestRankedPoint(points)?.point;
    return latest?dayKey(latest.chartAt):'';
  }

  function pointsForRange(points,range,chart){
    const sorted=sortedPoints(points);
    if(!sorted.length)return [];

    if(chart?.cadence==='hourly'){
      // Real-time charts always show one calendar day. For a currently
      // out-of-chart song, use the latest day that actually contains a rank.
      const displayDay=latestRankedDay(sorted)||dayKey(sorted[sorted.length-1].chartAt);
      return sorted.filter(point=>dayKey(point.chartAt)===displayDay);
    }

    // Daily/weekly files may contain later null observations. They must not
    // extend the graph beyond the last date on which an actual rank exists.
    const latestRanked=latestRankedPoint(sorted);
    const bounded=latestRanked?sorted.slice(0,latestRanked.index+1):sorted;
    if(range==='all')return bounded;

    const latest=parseDate(latestRanked?.point?.chartAt||bounded[bounded.length-1]?.chartAt)?.getTime();
    if(!Number.isFinite(latest))return bounded;
    const days=range==='7d'?7:range==='30d'?30:null;
    return days
      ?bounded.filter(point=>(parseDate(point.chartAt)?.getTime()||0)>=latest-(days-1)*86400000)
      :bounded;
  }

  function historySummary(history,entry){
    const points=sortedPoints(history?.points);
    const ranked=points.filter(point=>isRank(point.rank));
    const dates=new Set(ranked.map(point=>dayKey(point.chartAt)).filter(Boolean));
    const calculated={
      peakRank:ranked.length?Math.min(...ranked.map(point=>Number(point.rank))):null,
      firstChartedAt:ranked[0]?.chartAt||'',
      lastChartedAt:ranked[ranked.length-1]?.chartAt||'',
      chartDays:dates.size
    };
    const stored=history?.summary||{};
    return {
      currentRank:entry?.currentRank,
      peakRank:isRank(stored.peakRank)?stored.peakRank:calculated.peakRank,
      firstChartedAt:stored.firstChartedAt||calculated.firstChartedAt,
      lastChartedAt:stored.lastChartedAt||calculated.lastChartedAt,
      chartDays:Number(stored.chartDays)||calculated.chartDays
    };
  }

  function historySvg(points,maxRank,{cadence='daily'}={}){
    const hourly=cadence==='hourly';
    const mobile=window.matchMedia('(max-width:640px)').matches;
    const ranked=points.filter(point=>isRank(point.rank));
    if(!ranked.length)return '';

    // On a phone, preserve readable spacing and allow horizontal swiping instead
    // of shrinking every point and label into the same narrow screen width.
    const width=mobile
      ?Math.max(360,Math.min(1500,150+ranked.length*26))
      :900;
    const height=mobile?320:340;
    const pad={top:58,right:26,bottom:52,left:54};
    const usableW=width-pad.left-pad.right;
    const usableH=height-pad.top-pad.bottom;

    const maxConfigured=Math.max(10,Number(maxRank)||100);
    const yMax=Math.max(maxConfigured,...ranked.map(point=>Number(point.rank)));
    const timestamps=points
      .map(point=>parseDate(point.chartAt)?.getTime())
      .filter(Number.isFinite);
    const minTime=Math.min(...timestamps);
    const maxTime=Math.max(...timestamps);
    const xForTime=(value)=>{
      const stamp=parseDate(value)?.getTime();
      if(!Number.isFinite(stamp)||minTime===maxTime)return pad.left+usableW/2;
      return pad.left+(stamp-minTime)*usableW/(maxTime-minTime);
    };
    const y=(rankValue)=>pad.top+(Number(rankValue)-1)*usableH/(yMax-1);
    const gridRanks=[1,Math.round(yMax*.25),Math.round(yMax*.5),Math.round(yMax*.75),yMax]
      .map(value=>Math.max(1,value))
      .filter((value,index,array)=>array.indexOf(value)===index);

    // Draw through all available ranked observations. Only an explicit null
    // observation breaks the line. This prevents isolated dots caused merely by
    // a sparse historical source while still respecting known out-of-chart gaps.
    const segments=[];
    let current=[];
    points.forEach(point=>{
      const stamp=parseDate(point.chartAt)?.getTime();
      if(isRank(point.rank)&&Number.isFinite(stamp)){
        current.push({
          x:xForTime(point.chartAt),
          y:y(point.rank),
          point
        });
      }else if(current.length){
        segments.push(current);
        current=[];
      }
    });
    if(current.length)segments.push(current);

    const lineMarkup=segments.map(segment=>{
      if(segment.length>1){
        const coordinates=segment
          .map(item=>`${item.x.toFixed(1)},${item.y.toFixed(1)}`)
          .join(' ');
        return `<polyline class="chart-rank-line" points="${coordinates}"></polyline>`;
      }
      const item=segment[0];
      const x1=Math.max(pad.left,item.x-10);
      const x2=Math.min(width-pad.right,item.x+10);
      return `<line class="chart-single-guide" x1="${x1.toFixed(1)}" x2="${x2.toFixed(1)}" y1="${item.y.toFixed(1)}" y2="${item.y.toFixed(1)}"></line>`;
    }).join('');

    const pointViews=ranked.map((point,index)=>{
      const cx=xForTime(point.chartAt);
      const cy=y(point.rank);
      const label=pointTooltipLabel(point.chartAt,hourly);
      const boxWidth=hourly?148:126;
      const boxHeight=48;
      let boxX=cx+10;
      if(boxX+boxWidth>width-pad.right)boxX=cx-boxWidth-10;
      boxX=Math.max(6,Math.min(width-boxWidth-6,boxX));
      let boxY=cy-boxHeight-12;
      if(boxY<6)boxY=cy+12;
      boxY=Math.max(6,Math.min(height-boxHeight-6,boxY));
      return {
        point,index,cx,cy,label,boxWidth,boxHeight,boxX,boxY
      };
    });

    const labelIndexes=[0,Math.floor((ranked.length-1)/2),ranked.length-1]
      .filter((value,index,array)=>value>=0&&array.indexOf(value)===index);
    const mobileStyle=mobile?` style="width:${width}px;max-width:none"`:'';

    return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}"${mobileStyle} role="img" aria-label="順位推移グラフ">
      ${gridRanks.map(value=>`<line class="chart-grid-line" x1="${pad.left}" x2="${width-pad.right}" y1="${y(value)}" y2="${y(value)}"></line><text class="chart-axis-label" x="${pad.left-10}" y="${y(value)+4}" text-anchor="end">#${value}</text>`).join('')}
      ${lineMarkup}
      ${pointViews.map(item=>`<circle class="chart-rank-point" cx="${item.cx}" cy="${item.cy}" r="4" tabindex="0" role="button" data-point-index="${item.index}" data-chart-at="${esc(item.point.chartAt)}" data-point-label="${esc(item.label)}" data-rank="${Number(item.point.rank)}" aria-label="${esc(item.label)}、${Number(item.point.rank)}位"><title>${esc(item.label)} #${Number(item.point.rank)}</title></circle>`).join('')}
      ${pointViews.map(item=>`<g class="chart-point-popover" data-point-index="${item.index}" aria-hidden="true" transform="translate(${item.boxX.toFixed(1)} ${item.boxY.toFixed(1)})"><rect width="${item.boxWidth}" height="${item.boxHeight}" rx="10"></rect><text class="chart-point-popover-date" x="10" y="18">${esc(item.label)}</text><text class="chart-point-popover-rank" x="10" y="38">#${Number(item.point.rank)}</text></g>`).join('')}
      ${labelIndexes.map(index=>`<text class="chart-axis-label" x="${xForTime(ranked[index]?.chartAt)}" y="${height-17}" text-anchor="${index===0?'start':index===ranked.length-1?'end':'middle'}">${esc(hourly?timeLabel(ranked[index]?.chartAt):dateTime(ranked[index]?.chartAt,true))}</text>`).join('')}
    </svg>`;
  }

  function bindPointInteraction(){
    const wrap=byId('chartSvgWrap');
    const live=byId('chartPointLive');
    if(!wrap)return;
    const activate=(point)=>{
      const selectedIndex=String(point.dataset.pointIndex||'');
      wrap.querySelectorAll('.chart-rank-point').forEach(node=>{
        node.classList.toggle('is-selected',node===point);
      });
      wrap.querySelectorAll('.chart-point-popover').forEach(popover=>{
        const active=popover.dataset.pointIndex===selectedIndex;
        popover.classList.toggle('is-visible',active);
        popover.setAttribute('aria-hidden',String(!active));
      });
      if(live){
        live.textContent=`${point.dataset.pointLabel||''} ${point.dataset.rank||''}位`;
      }
    };
    wrap.querySelectorAll('.chart-rank-point').forEach(point=>{
      point.addEventListener('click',()=>activate(point));
      point.addEventListener('keydown',event=>{
        if(event.key==='Enter'||event.key===' '){
          event.preventDefault();
          activate(point);
        }
      });
    });
  }

  function renderSelectedHistory(){
    const allPoints=sortedPoints(selectedHistory.points);
    const range=byId('historyRangeSelector')?.value||'all';
    const hourly=selectedHistoryChart?.cadence==='hourly';
    const rangeWrap=byId('historyRangeSelector')?.closest('.chart-history-range');
    if(rangeWrap)rangeWrap.hidden=hourly;

    const visible=pointsForRange(allPoints,range,selectedHistoryChart);
    const svg=historySvg(visible,selectedHistoryChart.maxRank,{cadence:selectedHistoryChart?.cadence||'daily'});
    const wrap=byId('chartSvgWrap');
    const mobileSwipe=window.matchMedia('(max-width:640px)').matches
      &&visible.filter(point=>isRank(point.rank)).length>8;
    if(wrap){
      wrap.innerHTML=svg
        ?`${mobileSwipe?'<p class="chart-mobile-scroll-hint">横にスワイプして推移を確認できます</p>':''}${svg}<span class="chart-point-live" id="chartPointLive" aria-live="polite"></span>`
        :'<p class="chart-empty">この組み合わせの順位履歴はまだありません。</p>';
    }
    if(svg)bindPointInteraction();

    const summary=historySummary(selectedHistory,selectedEntry);
    if(byId('chartHistoryStats')){
      byId('chartHistoryStats').innerHTML=[
        ['現在順位',rankLabel(summary.currentRank)],
        ['最高順位',rankLabel(summary.peakRank)],
        ['初登場日',dateTime(summary.firstChartedAt,true)],
        ['最終チャートイン',dateTime(summary.lastChartedAt,true)],
        ['チャートイン日数',`${Number(summary.chartDays)||0}日`]
      ].map(([label,value])=>`<div class="chart-history-stat"><span>${label}</span><strong>${esc(value)}</strong></div>`).join('');
    }

    const sources=Array.isArray(selectedHistory.sources)?selectedHistory.sources:[];
    const hasGuyso=sources.some(source=>source?.id==='guyso')||allPoints.some(point=>String(point?.origin||'').startsWith('guyso'));
    const sourceParts=[];
    if(hasGuyso)sourceParts.push('<span>過去順位の一部：<a href="https://xn--o39an51b2re.com/" target="_blank" rel="noopener noreferrer">가이섬</a></span>');
    sourceParts.push('<span>最新順位：各チャートの公開情報</span>');
    const displayedDay=hourly&&visible.length?dayKey(visible.find(point=>isRank(point.rank))?.chartAt||visible[0]?.chartAt):'';
    sourceParts.push(`<span>${hourly?`${displayedDay||'最新'}の1日分`: `${visible.length.toLocaleString('ja-JP')}点表示`}</span>`);
    if(byId('chartHistorySource'))byId('chartHistorySource').innerHTML=sourceParts.join('<i>／</i>');

    const outages=Array.isArray(selectedHistory.outOfChartHistory)?selectedHistory.outOfChartHistory:[];
    if(byId('chartOutHistory')){
      byId('chartOutHistory').innerHTML=outages.length
        ?`<h4>圏外履歴</h4><div class="chart-out-list">${outages.slice(-12).reverse().map(item=>`<span class="chart-out-chip">${esc(dateTime(item.startAt,true))} → ${esc(item.endAt?dateTime(item.endAt,true):'継続中')}</span>`).join('')}</div>`
        :'';
    }
  }

  function validHistory(history,songId,chartId){
    return history&&
      (!history.songId||history.songId===songId)&&
      (!history.chartId||history.chartId===chartId)&&
      Array.isArray(history.points);
  }

  async function selectHistory(songId,chartId){
    const key=entryKey(songId,chartId);
    selectedEntry=entries.find(item=>entryKey(item.songId,item.chartId)===key)||null;
    if(!selectedEntry)return renderEmptyHistory();

    const song=songMap[songId]||{title:selectedEntry.songTitle||songId};
    const chart=chartMap[chartId]||{name:selectedEntry.chartName||chartId,maxRank:100,cadence:'daily'};
    selectedHistoryChart=chart;
    if(byId('historySongName'))byId('historySongName').textContent=song.title;
    if(byId('historyChartName'))byId('historyChartName').textContent=chart.name;
    if(byId('historySubtitle'))byId('historySubtitle').textContent=`${chart.name}／${song.title}`;
    renderEmptyHistory('順位履歴を読み込んでいます。');

    document.querySelectorAll('.chart-rank-card').forEach(card=>{
      card.classList.toggle('is-selected',card.dataset.entry===key);
    });

    const fallback={
      songId,
      chartId,
      points:[],
      sources:[],
      outOfChartHistory:selectedEntry.outOfChartHistory||[],
      summary:selectedEntry
    };

    if(historyCache.has(key)){
      selectedHistory=historyCache.get(key);
      renderSelectedHistory();
      return;
    }

    historyRequestId+=1;
    const requestId=historyRequestId;
    if(historyController)historyController.abort();
    historyController=new AbortController();

    try{
      const path=`data/korean-chart-history/${encodeURIComponent(songId)}--${encodeURIComponent(chartId)}.json`;
      const response=await fetch(`${path}?v=${encodeURIComponent(data.generatedAt||Date.now())}`,{
        cache:'no-store',
        signal:historyController.signal
      });
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const history=await response.json();
      if(!validHistory(history,songId,chartId)){
        throw new Error(`履歴識別子不一致: ${history?.songId||'?'} / ${history?.chartId||'?'}`);
      }
      historyCache.set(key,history);
      if(requestId!==historyRequestId)return;
      selectedHistory=history;
    }catch(error){
      if(error?.name==='AbortError')return;
      console.warn('History load failed',error);
      if(requestId!==historyRequestId)return;
      selectedHistory=fallback;
    }
    renderSelectedHistory();
  }

  function init(){
    installDisplayFixStyles();
    configureRangeSelector();
    renderOverview();
    renderSourceStatus();
    fillSelectors();

    document.querySelectorAll('[data-chart-view]').forEach(button=>{
      button.addEventListener('click',()=>setView(button.dataset.chartView));
    });
    ['chartSelector','songSelector','statusSelector'].forEach(id=>{
      byId(id)?.addEventListener('change',renderRankList);
    });
    byId('historyRangeSelector')?.addEventListener('change',renderSelectedHistory);
    window.addEventListener('resize',()=>{if(selectedEntry)renderSelectedHistory();},{passive:true});
    renderRankList();
  }

  init();
})();
