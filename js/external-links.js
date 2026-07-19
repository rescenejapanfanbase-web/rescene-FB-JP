(()=>{
  'use strict';

  const REPORT_URL='data/external-link-report.json';
  const PAGE_SIZE=20;
  const formatter=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  const stateLabels={all:'すべて',broken:'リンク切れ',warning:'要確認',ok:'正常'};

  const elements={
    generatedAt:document.getElementById('externalGeneratedAt'),
    checked:document.getElementById('externalChecked'),
    broken:document.getElementById('externalBroken'),
    warning:document.getElementById('externalWarning'),
    ok:document.getElementById('externalOk'),
    hostCount:document.getElementById('externalHosts'),
    status:document.getElementById('externalLoadStatus'),
    statusFilters:document.getElementById('externalStatusFilters'),
    serviceFilter:document.getElementById('externalServiceFilter'),
    query:document.getElementById('externalSearch'),
    results:document.getElementById('externalResults'),
    resultCount:document.getElementById('externalResultCount'),
    empty:document.getElementById('externalEmpty'),
    more:document.getElementById('externalMore'),
    services:document.getElementById('externalServices'),
    notes:document.getElementById('externalNotes'),
  };

  let report=null;
  let statusFilter='all';
  let serviceFilter='all';
  let query='';
  let visibleCount=PAGE_SIZE;

  const formatDate=value=>{
    if(!value)return '未実行';
    const date=new Date(value);
    return Number.isNaN(date.getTime())?'未実行':formatter.format(date);
  };

  const make=(tag,className,text)=>{
    const node=document.createElement(tag);
    if(className)node.className=className;
    if(text!==undefined)node.textContent=text;
    return node;
  };

  function renderSummary(){
    const summary=report?.summary||{};
    elements.generatedAt.textContent=formatDate(report?.generatedAt);
    elements.checked.textContent=Number(summary.checked||0).toLocaleString('ja-JP');
    elements.broken.textContent=Number(summary.broken||0).toLocaleString('ja-JP');
    elements.warning.textContent=Number(summary.warning||0).toLocaleString('ja-JP');
    elements.ok.textContent=Number(summary.ok||0).toLocaleString('ja-JP');
    elements.hostCount.textContent=Number(summary.hosts||0).toLocaleString('ja-JP');

    if(!report?.generatedAt){
      elements.status.className='external-load-status is-warning';
      elements.status.textContent='初回チェック前です。GitHub Actionsの「Check External Links」を実行してください。';
    }else if(Number(summary.broken)>0){
      elements.status.className='external-load-status is-error';
      elements.status.textContent=`修正が必要なリンクを${summary.broken}件検出しました。`;
    }else if(Number(summary.warning)>0){
      elements.status.className='external-load-status is-warning';
      elements.status.textContent=`リンク切れはありません。自動確認できなかった項目が${summary.warning}件あります。`;
    }else{
      elements.status.className='external-load-status is-success';
      elements.status.textContent='確認した外部リンクはすべて正常です。';
    }
  }

  function renderServices(){
    elements.serviceFilter.innerHTML='<option value="all">すべてのサービス</option>';
    elements.services.replaceChildren();
    const services=Array.isArray(report?.services)?report.services:[];
    services.forEach(service=>{
      const option=document.createElement('option');
      option.value=service.key;
      option.textContent=`${service.label}（${service.checked}）`;
      elements.serviceFilter.append(option);

      const card=make('div','external-service-card');
      const top=make('div','external-service-top');
      top.append(make('strong','',service.label),make('span','',`${service.checked}件`));
      const counts=make('div','external-service-counts');
      counts.append(
        make('span','is-error',`切れ ${service.broken}`),
        make('span','is-warning',`確認 ${service.warning}`),
        make('span','is-success',`正常 ${service.ok}`),
      );
      card.append(top,counts);
      elements.services.append(card);
    });
  }

  function renderNotes(){
    elements.notes.replaceChildren();
    const notes=Array.isArray(report?.notes)?report.notes:[];
    notes.forEach(note=>{
      const li=document.createElement('li');
      li.textContent=note;
      elements.notes.append(li);
    });
  }

  function filteredItems(){
    const words=query.toLocaleLowerCase('ja').split(/\s+/).filter(Boolean);
    return (Array.isArray(report?.items)?report.items:[]).filter(item=>{
      if(statusFilter!=='all'&&item.status!==statusFilter)return false;
      if(serviceFilter!=='all'&&item.serviceKey!==serviceFilter)return false;
      if(!words.length)return true;
      const sourceText=(item.sources||[]).map(source=>`${source.file} ${source.label||''}`).join(' ');
      const haystack=`${item.url} ${item.service} ${item.message} ${sourceText}`.toLocaleLowerCase('ja');
      return words.every(word=>haystack.includes(word));
    });
  }

  function sourceLink(source){
    const anchor=make('a','external-source');
    const line=source.line?`:${source.line}`:'';
    anchor.textContent=`${source.file}${line}`;
    anchor.href=source.file;
    if(source.file.endsWith('.json')){
      anchor.target='_blank';
      anchor.rel='noopener noreferrer';
    }
    if(source.label)anchor.title=source.label;
    return anchor;
  }

  function itemCard(item){
    const article=make('article',`card external-result is-${item.status}`);
    const head=make('div','external-result-head');
    const service=make('div','external-result-service');
    service.append(make('span',`external-state is-${item.status}`,stateLabels[item.status]||item.status),make('strong','',item.service));
    const http=make('span','external-http',item.httpStatus?`HTTP ${item.httpStatus}`:'HTTP —');
    head.append(service,http);

    const url=make('a','external-result-url',item.url);
    url.href=item.url;
    url.target='_blank';
    url.rel='noopener noreferrer';

    const message=make('p','external-result-message',item.message||'判定メッセージはありません。');
    const meta=make('div','external-result-meta');
    meta.append(make('span','',`確認方法: ${item.method||'HTTP'}`));
    if(item.finalUrl&&item.finalUrl!==item.normalizedUrl){
      const final=make('a','', '転送先を開く ↗');
      final.href=item.finalUrl;
      final.target='_blank';
      final.rel='noopener noreferrer';
      meta.append(final);
    }

    const sources=make('div','external-result-sources');
    sources.append(make('span','external-source-label','記載場所'));
    (item.sources||[]).slice(0,8).forEach(source=>sources.append(sourceLink(source)));
    if((item.sources||[]).length>8)sources.append(make('span','external-source-more',`ほか${item.sources.length-8}件`));
    article.append(head,url,message,meta,sources);
    return article;
  }

  function updateUrl(){
    const params=new URLSearchParams();
    if(statusFilter!=='all')params.set('status',statusFilter);
    if(serviceFilter!=='all')params.set('service',serviceFilter);
    if(query)params.set('q',query);
    const suffix=params.toString()?`?${params}`:location.pathname;
    history.replaceState(null,'',suffix);
  }

  function renderResults(){
    const items=filteredItems();
    const visible=items.slice(0,visibleCount);
    elements.results.replaceChildren(...visible.map(itemCard));
    elements.resultCount.textContent=`${items.length}件中 ${visible.length}件を表示`;
    elements.empty.hidden=items.length!==0;
    elements.more.hidden=visible.length>=items.length;
    elements.more.textContent=`さらに${Math.min(PAGE_SIZE,items.length-visible.length)}件表示`;
    updateUrl();
  }

  function selectStatus(value){
    statusFilter=['all','broken','warning','ok'].includes(value)?value:'all';
    [...elements.statusFilters.querySelectorAll('button')].forEach(button=>{
      const selected=button.dataset.status===statusFilter;
      button.classList.toggle('is-active',selected);
      button.setAttribute('aria-pressed',selected?'true':'false');
    });
    visibleCount=PAGE_SIZE;
    renderResults();
  }

  function readInitialFilters(){
    const params=new URLSearchParams(location.search);
    serviceFilter=params.get('service')||'all';
    query=params.get('q')||'';
    elements.serviceFilter.value=serviceFilter;
    elements.query.value=query;
    selectStatus(params.get('status')||'all');
  }

  async function load(){
    try{
      const response=await fetch(`${REPORT_URL}?v=${Date.now()}`,{cache:'no-store'});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      report=await response.json();
      renderSummary();
      renderServices();
      renderNotes();
      readInitialFilters();
    }catch(error){
      console.error(error);
      elements.status.className='external-load-status is-error';
      elements.status.textContent='外部リンクチェック結果を読み込めませんでした。';
      elements.results.replaceChildren();
      elements.empty.hidden=false;
      elements.empty.textContent='data/external-link-report.jsonを確認してください。';
    }
  }

  elements.statusFilters?.addEventListener('click',event=>{
    const button=event.target.closest('button[data-status]');
    if(button)selectStatus(button.dataset.status);
  });
  elements.serviceFilter?.addEventListener('change',()=>{
    serviceFilter=elements.serviceFilter.value;
    visibleCount=PAGE_SIZE;
    renderResults();
  });
  elements.query?.addEventListener('input',()=>{
    query=elements.query.value.trim();
    visibleCount=PAGE_SIZE;
    renderResults();
  });
  elements.more?.addEventListener('click',()=>{
    visibleCount+=PAGE_SIZE;
    renderResults();
  });

  load();
})();
