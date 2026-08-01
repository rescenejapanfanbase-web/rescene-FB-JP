(()=>{
  'use strict';
  const data=window.RESCENE_KOREAN_CHARTS||{};
  const charts=(Array.isArray(data.charts)?data.charts:[]).filter(item=>item?.published!==false).sort((a,b)=>(a.order||9999)-(b.order||9999));
  const songs=(Array.isArray(data.songs)?data.songs:[]).filter(item=>item?.published!==false).sort((a,b)=>(a.order||9999)-(b.order||9999));
  const entries=Array.isArray(data.entries)?data.entries:[];
  const sourceStatus=data.sourceStatus||{};
  const byId=(id)=>document.getElementById(id);
  const chartMap=Object.fromEntries(charts.map(item=>[item.id,item]));
  const songMap=Object.fromEntries(songs.map(item=>[item.id,item]));
  let view='chart';
  let selectedEntry=null;

  const esc=(value)=>String(value??'').replace(/[&<>"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[char]));
  const dateTime=(value,short=false)=>{
    if(!value)return '—';
    const date=new Date(value);
    if(Number.isNaN(date.getTime()))return String(value);
    return new Intl.DateTimeFormat('ja-JP',short?{year:'numeric',month:'2-digit',day:'2-digit'}:{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(date);
  };
  const rank=(value)=>Number.isFinite(Number(value))?`#${Number(value)}`:'圏外';
  const movement=(entry)=>{
    const type=entry?.movementType||'';
    if(type==='up')return {text:`▲${Math.abs(Number(entry.movement)||0)}`,className:'is-up'};
    if(type==='down')return {text:`▼${Math.abs(Number(entry.movement)||0)}`,className:'is-down'};
    if(type==='same')return {text:'－',className:'is-same'};
    if(type==='new')return {text:'NEW',className:'is-new'};
    if(type==='reentry')return {text:'RE',className:'is-new'};
    if(type==='out')return {text:'OUT',className:'is-down'};
    return {text:'—',className:'is-same'};
  };
  const statusOf=(chartId)=>sourceStatus[chartId]||{};

  function renderOverview(){
    byId('trackedSongCount').textContent=String(data.summary?.publishedSongs??songs.length);
    byId('trackedChartCount').textContent=String(data.summary?.chartCount??charts.length);
    byId('chartingNowCount').textContent=String(data.summary?.inChartCount??entries.filter(item=>item.status==='in').length);
    byId('lastSyncAt').textContent=data.generatedAt?dateTime(data.generatedAt):'初回同期前';
  }

  function renderSourceStatus(){
    const root=byId('chartSourceStatus');
    root.innerHTML=charts.map(chart=>{
      const status=statusOf(chart.id);
      const state=status.ok===true?'fresh':status.ok===false?'stale':'waiting';
      const pill=state==='fresh'?'正常':state==='stale'?'前回値を維持':'未実行';
      const detail=status.ok===false?`取得失敗：${status.lastSuccessAt?`前回成功 ${dateTime(status.lastSuccessAt)}`:'正常取得待ち'}`:status.lastSuccessAt?`${dateTime(status.lastSuccessAt)}／${status.itemCount||0}件取得`:`${chart.cadence||'hourly'}更新を待っています`;
      return `<article class="chart-source-card"><strong>${esc(chart.shortName||chart.name)}</strong><span class="source-pill is-${state}">${pill}</span><small>${esc(detail)}</small></article>`;
    }).join('')||'<p class="chart-empty card">公開対象チャートが設定されていません。</p>';
  }

  function fillSelectors(){
    const chartSelector=byId('chartSelector');
    const songSelector=byId('songSelector');
    chartSelector.innerHTML=charts.map(item=>`<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');
    songSelector.innerHTML=songs.map(item=>`<option value="${esc(item.id)}">${esc(item.title)}</option>`).join('');
    const firstChartWithData=charts.find(chart=>entries.some(entry=>entry.chartId===chart.id));
    const firstSongWithData=songs.find(song=>entries.some(entry=>entry.songId===song.id));
    if(firstChartWithData)chartSelector.value=firstChartWithData.id;
    if(firstSongWithData)songSelector.value=firstSongWithData.id;
  }

  function filteredEntries(){
    const statusFilter=byId('statusSelector').value;
    let rows=view==='chart'?entries.filter(item=>item.chartId===byId('chartSelector').value):entries.filter(item=>item.songId===byId('songSelector').value);
    if(statusFilter==='in')rows=rows.filter(item=>item.status==='in');
    if(statusFilter==='out')rows=rows.filter(item=>item.status!=='in');
    const chartOrder=Object.fromEntries(charts.map((item,index)=>[item.id,index]));
    const songOrder=Object.fromEntries(songs.map((item,index)=>[item.id,index]));
    return rows.sort((a,b)=>view==='chart'?
      ((a.currentRank??99999)-(b.currentRank??99999)||((songOrder[a.songId]??9999)-(songOrder[b.songId]??9999))):
      ((chartOrder[a.chartId]??9999)-(chartOrder[b.chartId]??9999)));
  }

  function rankCard(entry){
    const chart=chartMap[entry.chartId]||{name:entry.chartName||entry.chartId};
    const song=songMap[entry.songId]||{title:entry.songTitle||entry.songId};
    const move=movement(entry);
    const current=Number.isFinite(Number(entry.currentRank));
    const stale=statusOf(entry.chartId).ok===false;
    return `<article class="card chart-rank-card" data-entry="${esc(entry.songId)}--${esc(entry.chartId)}">
      <div class="chart-rank-main"><strong class="chart-rank-number${current?'':' is-out'}">${current?`#${Number(entry.currentRank)}`:'圏外'}</strong><span class="chart-movement ${move.className}">${move.text}</span></div>
      <div class="chart-rank-copy"><small>${esc(view==='chart'?chart.shortName||chart.name:song.title)}${stale?' · STALE':''}</small><h3>${esc(view==='chart'?song.title:chart.name)}</h3></div>
      <div class="chart-rank-stat"><span>前回順位</span><strong>${rank(entry.previousRank)}</strong></div>
      <div class="chart-rank-stat"><span>最高順位</span><strong>${rank(entry.peakRank)}</strong></div>
      <div class="chart-rank-stat"><span>初登場日</span><strong>${dateTime(entry.firstChartedAt,true)}</strong></div>
      <div class="chart-rank-stat"><span>チャートイン日数</span><strong>${Number(entry.chartDays)||0}日</strong></div>
      <button class="chart-history-button" type="button" data-history-song="${esc(entry.songId)}" data-history-chart="${esc(entry.chartId)}">推移を見る</button>
    </article>`;
  }

  function renderRankList(){
    const rows=filteredEntries();
    const message=byId('chartDataMessage');
    const list=byId('chartRankList');
    if(!entries.length){
      message.hidden=false;
      message.textContent=data.notice||'初回同期後に順位データが表示されます。Notionの対象曲・対象チャートを確認してください。';
      list.innerHTML='';
      renderEmptyHistory();
      return;
    }
    if(!rows.length){
      message.hidden=false;
      message.textContent='選択した条件に該当するデータはありません。';
      list.innerHTML='';
      return;
    }
    message.hidden=true;
    list.innerHTML=rows.map(rankCard).join('');
    list.querySelectorAll('[data-history-song]').forEach(button=>button.addEventListener('click',()=>selectHistory(button.dataset.historySong,button.dataset.historyChart)));
    if(!selectedEntry||!rows.some(item=>item.songId===selectedEntry.songId&&item.chartId===selectedEntry.chartId))selectHistory(rows[0].songId,rows[0].chartId);
  }

  function setView(next){
    view=next;
    document.querySelectorAll('[data-chart-view]').forEach(button=>{
      const active=button.dataset.chartView===view;
      button.classList.toggle('is-active',active);button.setAttribute('aria-selected',String(active));
    });
    byId('chartSelectorWrap').classList.toggle('is-hidden',view!=='chart');
    byId('songSelectorWrap').classList.toggle('is-hidden',view!=='song');
    renderRankList();
  }

  function renderEmptyHistory(message='順位履歴はまだありません。'){
    byId('chartSvgWrap').innerHTML=`<p class="chart-empty">${esc(message)}</p>`;
    byId('chartHistoryStats').innerHTML='';
    byId('chartOutHistory').innerHTML='';
  }

  function historySvg(points,maxRank){
    const width=900,height=330,pad={top:26,right:22,bottom:44,left:52};
    const usableW=width-pad.left-pad.right,usableH=height-pad.top-pad.bottom;
    const ranked=points.filter(point=>Number.isFinite(Number(point.rank)));
    if(!ranked.length)return '';
    const yMax=Math.max(10,Number(maxRank)||100,Math.max(...ranked.map(point=>Number(point.rank))));
    const x=(index)=>pad.left+(points.length===1?usableW/2:index*usableW/(points.length-1));
    const y=(rankValue)=>pad.top+(Math.max(1,Number(rankValue))-1)*usableH/(yMax-1);
    const gridRanks=[1,Math.max(2,Math.round(yMax*.25)),Math.max(3,Math.round(yMax*.5)),Math.max(4,Math.round(yMax*.75)),yMax].filter((v,i,a)=>a.indexOf(v)===i);
    const segments=[];let current=[];
    points.forEach((point,index)=>{if(Number.isFinite(Number(point.rank)))current.push(`${x(index).toFixed(1)},${y(point.rank).toFixed(1)}`);else if(current.length){segments.push(current);current=[];}});if(current.length)segments.push(current);
    const labels=[0,Math.floor((points.length-1)/2),points.length-1].filter((v,i,a)=>v>=0&&a.indexOf(v)===i);
    return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="順位推移グラフ">
      ${gridRanks.map(value=>`<line class="chart-grid-line" x1="${pad.left}" x2="${width-pad.right}" y1="${y(value)}" y2="${y(value)}"></line><text class="chart-axis-label" x="${pad.left-10}" y="${y(value)+4}" text-anchor="end">#${value}</text>`).join('')}
      ${segments.map(segment=>segment.length>1?`<polyline class="chart-rank-line" points="${segment.join(' ')}"></polyline>`:'').join('')}
      ${ranked.map(point=>{const index=points.indexOf(point);return `<circle class="chart-rank-point" cx="${x(index)}" cy="${y(point.rank)}" r="4"><title>${dateTime(point.chartAt)} #${point.rank}</title></circle>`;}).join('')}
      ${labels.map(index=>`<text class="chart-axis-label" x="${x(index)}" y="${height-15}" text-anchor="${index===0?'start':index===points.length-1?'end':'middle'}">${esc(dateTime(points[index]?.chartAt,true))}</text>`).join('')}
    </svg>`;
  }

  async function selectHistory(songId,chartId){
    selectedEntry=entries.find(item=>item.songId===songId&&item.chartId===chartId)||null;
    if(!selectedEntry)return renderEmptyHistory();
    const song=songMap[songId]||{title:selectedEntry.songTitle||songId};
    const chart=chartMap[chartId]||{name:selectedEntry.chartName||chartId,maxRank:100};
    byId('historySongName').textContent=song.title;
    byId('historyChartName').textContent=chart.name;
    byId('historySubtitle').textContent=`${chart.name}／${song.title}`;
    renderEmptyHistory('順位履歴を読み込んでいます。');
    let history={points:[],outOfChartHistory:selectedEntry.outOfChartHistory||[]};
    try{
      const response=await fetch(`${selectedEntry.historyPath}?v=${encodeURIComponent(data.generatedAt||Date.now())}`,{cache:'no-store'});
      if(response.ok)history=await response.json();
    }catch(error){console.warn('History load failed',error);}
    const points=Array.isArray(history.points)?history.points:[];
    const recent=points.slice(-240);
    const svg=historySvg(recent,chart.maxRank);
    byId('chartSvgWrap').innerHTML=svg||'<p class="chart-empty">この組み合わせの順位履歴はまだありません。</p>';
    const summary=history.summary||selectedEntry;
    byId('chartHistoryStats').innerHTML=[
      ['現在順位',rank(summary.currentRank??selectedEntry.currentRank)],['最高順位',rank(summary.peakRank??selectedEntry.peakRank)],
      ['初登場日',dateTime(summary.firstChartedAt??selectedEntry.firstChartedAt,true)],['最終チャートイン',dateTime(summary.lastChartedAt??selectedEntry.lastChartedAt,true)],
      ['チャートイン日数',`${Number(summary.chartDays??selectedEntry.chartDays)||0}日`]
    ].map(([label,value])=>`<div class="chart-history-stat"><span>${label}</span><strong>${esc(value)}</strong></div>`).join('');
    const outages=Array.isArray(history.outOfChartHistory)?history.outOfChartHistory:[];
    byId('chartOutHistory').innerHTML=outages.length?`<h4>圏外履歴</h4><div class="chart-out-list">${outages.slice(-12).reverse().map(item=>`<span class="chart-out-chip">${esc(dateTime(item.startAt,true))} → ${esc(item.endAt?dateTime(item.endAt,true):'継続中')}</span>`).join('')}</div>`:'';
    document.querySelectorAll('.chart-rank-card').forEach(card=>card.classList.toggle('is-selected',card.dataset.entry===`${songId}--${chartId}`));
  }

  renderOverview();renderSourceStatus();fillSelectors();
  document.querySelectorAll('[data-chart-view]').forEach(button=>button.addEventListener('click',()=>setView(button.dataset.chartView)));
  ['chartSelector','songSelector','statusSelector'].forEach(id=>byId(id)?.addEventListener('change',renderRankList));
  renderRankList();
})();
