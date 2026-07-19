(()=>{
  'use strict';

  const REPOSITORY='rescenejapanfanbase-web/rescene-FB-JP';
  const API_CACHE_KEY='rescene-sync-status-api-v4';
  const API_CACHE_MS=5*60*1000;
  const workflowBase=`https://github.com/${REPOSITORY}/actions/workflows/`;

  const configs={
    schedule:{
      workflow:'sync-notion.yml',
      dataUrl:'data/schedule.json',
      parseData(data){
        const count=Array.isArray(data?.events)?data.events.length:0;
        return {count:`${count}件`,detail:'公開中のスケジュール',generatedAt:data?.generatedAt||null,state:'success',message:`公開予定 ${count}件のデータを読み込みました。`};
      },
    },
    news:{
      workflow:'sync-notion-news.yml',
      dataUrl:'data/news.json',
      parseData(data){
        const count=Array.isArray(data?.news)?data.news.length:0;
        const notionCount=Number.isFinite(Number(data?.notionCount))?Number(data.notionCount):0;
        return {count:`${count}件`,detail:`公開ニュース（Notion ${notionCount}件）`,generatedAt:data?.generatedAt||null,state:'success',message:`ニュース ${count}件を読み込みました。`};
      },
    },
    youtube:{
      workflow:'sync-youtube-channels.yml',
      dataUrl:'data/youtube-channels.json',
      parseData(data){
        const channels=Array.isArray(data?.channels)?data.channels:[];
        const videos=channels.reduce((sum,channel)=>sum+(Array.isArray(channel?.videos)?channel.videos.length:0),0);
        const errors=channels.filter(channel=>channel?.syncError);
        const allMode=data?.collectionMode==='all-public-videos';
        const typeCounts=channels.reduce((counts,channel)=>{
          const source=channel?.typeCounts||{};
          counts.video+=Number(source.video)||0;
          counts.short+=Number(source.short)||0;
          counts.live+=Number(source.live)||0;
          return counts;
        },{video:0,short:0,live:0});
        const typeDetail=allMode?`通常 ${typeCounts.video} / ショート ${typeCounts.short} / ライブ ${typeCounts.live}`:`${channels.length}チャンネル`;
        return {
          count:`${videos}件`,
          detail:allMode?`全公開動画（${typeDetail}）`:`最新動画（${typeDetail}）`,
          generatedAt:data?.generatedAt||null,
          state:errors.length?'warning':'success',
          message:errors.length?`${errors.map(channel=>channel.label||channel.key).join('、')}の一部取得で警告があります。取得済みデータを表示しています。`:`${channels.length}チャンネル・${videos}件の${allMode?'全公開動画':'動画'}データを読み込みました。`,
        };
      },
    },
    homeguides:{
      workflow:'sync-home-guides.yml',
      dataUrl:'data/home-guides.json',
      parseData(data){
        const guides=Array.isArray(data?.guides)?data.guides:[];
        return {count:`${guides.length}件`,detail:'トップページに表示するガイド更新情報',generatedAt:data?.generatedAt||null,state:'success',message:`ガイド更新情報 ${guides.length}件を読み込みました。`};
      },
    },
    imageopt:{
      workflow:'optimize-images.yml',
      dataUrl:'data/image-optimization.json',
      parseData(data){
        const sourceFiles=Number(data?.sourceFiles)||0;
        const uniqueImages=Number(data?.uniqueImages)||0;
        const derivatives=Number(data?.derivatives)||0;
        const failed=Number(data?.failedImages)||0;
        const saving=Number(data?.estimatedSavingPercent)||0;
        const pending=!data?.generatedAt||sourceFiles===0;
        return {
          count:pending?'未生成':`${sourceFiles}枚`,
          detail:pending?'初回の画像最適化を実行してください。':`重複除外 ${uniqueImages}種類 / WebP ${derivatives}件 / 推定 ${saving}%削減`,
          generatedAt:data?.generatedAt||null,
          state:pending||failed?'warning':'success',
          message:pending?'Actionsから「Optimize Site Images」を一度実行すると、元画像を残したまま画面幅別WebPを生成します。':failed?`${failed}件の画像を最適化できませんでした。レポートと最新ログを確認してください。`:`${sourceFiles}枚を画面幅別WebPへ自動変換しています。元画像は保持されています。`,
        };
      },
    },
    backup:{
      workflow:'backup-site.yml',
      dataUrl:null,
      parseData(){return {count:'SITE ZIP',detail:'サイト一式＋復元情報を90日保存',generatedAt:null,state:'success',message:'最新のバックアップ実行結果を確認しています。Artifactは最新ログからダウンロードできます。'};},
    },
    externallinks:{
      workflow:'check-external-links.yml',
      dataUrl:'data/external-link-report.json',
      parseData(data){
        const summary=data?.summary||{};
        const checked=Number(summary.checked)||0;
        const broken=Number(summary.broken)||0;
        const warning=Number(summary.warning)||0;
        const ok=Number(summary.ok)||0;
        const pending=!data?.generatedAt;
        return {
          count:pending?'未実行':`${checked}件`,
          detail:pending?'初回の外部リンクチェックを実行してください。':`リンク切れ ${broken} / 要確認 ${warning} / 正常 ${ok}`,
          generatedAt:data?.generatedAt||null,
          state:broken?'error':pending||warning?'warning':'success',
          message:pending?'Actionsから「Check External Links」を一度実行してください。':broken?`${broken}件のリンク切れがあります。詳細レポートから記載ページを確認してください。`:warning?`リンク切れはありません。自動確認できなかった項目が${warning}件あります。`:`${checked}件の外部リンクを確認し、リンク切れはありませんでした。`,
        };
      },
    },
    sitecheck:{
      workflow:'check-site.yml',
      dataUrl:null,
      parseData(){return {count:'HTML / ASSETS',detail:'内部リンクと画像参照を確認',generatedAt:null,state:'success',message:'最新のGitHub Actions実行結果を確認しています。'};},
    },
  };

  const stateLabels={success:'成功',warning:'要確認',error:'失敗',running:'実行中',unknown:'未取得'};
  const eventLabels={schedule:'定期実行',workflow_dispatch:'手動実行',push:'更新時に自動実行',pull_request:'プルリクエスト'};
  const formatter=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const compactFormatter=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});

  const cards=Object.fromEntries([...document.querySelectorAll('[data-sync-card]')].map(card=>[card.dataset.syncCard,card]));
  const refreshButton=document.getElementById('refreshStatus');
  const toolbarDot=document.getElementById('toolbarDot');
  const toolbarText=document.getElementById('toolbarText');
  const overallStatus=document.getElementById('overallStatus');
  const overallDescription=document.getElementById('overallDescription');
  const summaryMark=document.getElementById('summaryMark');
  const checkedAt=document.getElementById('checkedAt');
  const apiStatus=document.getElementById('apiStatus');

  const field=(card,name)=>card?.querySelector(`[data-field="${name}"]`);
  const formatDate=value=>{
    if(!value)return '—';
    const date=new Date(value);
    return Number.isNaN(date.getTime())?'—':compactFormatter.format(date);
  };
  const duration=(start,end)=>{
    const from=new Date(start).getTime();
    const to=new Date(end).getTime();
    if(!Number.isFinite(from)||!Number.isFinite(to)||to<from)return '';
    const seconds=Math.round((to-from)/1000);
    if(seconds<60)return `${seconds}秒`;
    const minutes=Math.floor(seconds/60);
    const rest=seconds%60;
    return rest?`${minutes}分${rest}秒`:`${minutes}分`;
  };

  function setPill(card,state,label){
    const pill=field(card,'state');
    if(!pill)return;
    pill.className=`state-pill is-${state}`;
    pill.textContent=label||stateLabels[state]||stateLabels.unknown;
    card.dataset.state=state;
  }

  function setMessage(card,text,state){
    const message=field(card,'message');
    if(!message)return;
    message.textContent=text;
    message.className=`sync-message${state==='error'?' is-error':state==='warning'?' is-warning':''}`;
  }

  async function fetchJson(url){
    const separator=url.includes('?')?'&':'?';
    const response=await fetch(`${url}${separator}v=${Date.now()}`,{cache:'no-store'});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async function loadData(config){
    if(!config.dataUrl)return config.parseData();
    const data=await fetchJson(config.dataUrl);
    return config.parseData(data);
  }

  function readApiCache(){
    try{
      const cache=JSON.parse(localStorage.getItem(API_CACHE_KEY)||'null');
      if(!cache||Date.now()-cache.savedAt>API_CACHE_MS)return null;
      return cache;
    }catch{return null;}
  }

  function writeApiCache(runs){
    try{localStorage.setItem(API_CACHE_KEY,JSON.stringify({savedAt:Date.now(),runs}));}catch{}
  }

  async function fetchLatestRun(workflow){
    const endpoint=`https://api.github.com/repos/${REPOSITORY}/actions/workflows/${encodeURIComponent(workflow)}/runs?per_page=1`;
    const response=await fetch(endpoint,{headers:{Accept:'application/vnd.github+json'}});
    if(!response.ok)throw new Error(`GitHub API HTTP ${response.status}`);
    const data=await response.json();
    return Array.isArray(data?.workflow_runs)?data.workflow_runs[0]||null:null;
  }

  async function loadRuns(force){
    if(!force){
      const cache=readApiCache();
      if(cache)return {runs:cache.runs,source:'cache',errors:[]};
    }
    const entries=await Promise.all(Object.entries(configs).map(async([key,config])=>{
      try{return [key,await fetchLatestRun(config.workflow),null];}
      catch(error){return [key,null,error instanceof Error?error.message:String(error)];}
    }));
    const runs={};
    const errors=[];
    entries.forEach(([key,run,error])=>{runs[key]=run;if(error)errors.push({key,error});});
    if(errors.length<Object.keys(configs).length)writeApiCache(runs);
    return {runs,source:'api',errors};
  }

  function runState(run){
    if(!run)return 'unknown';
    if(run.status&&run.status!=='completed')return 'running';
    if(run.conclusion==='success')return 'success';
    if(['neutral','skipped','stale'].includes(run.conclusion))return 'warning';
    if(run.conclusion)return 'error';
    return 'unknown';
  }

  function renderCard(key,dataResult,run,apiError){
    const card=cards[key];
    const config=configs[key];
    if(!card||!config)return 'unknown';
    const workflowLink=field(card,'workflow-link');
    const latestLink=field(card,'run-link');
    workflowLink.href=`${workflowBase}${config.workflow}`;

    if(dataResult.ok){
      field(card,'count').textContent=dataResult.value.count;
      field(card,'count-detail').textContent=dataResult.value.detail;
      if(config.dataUrl)field(card,'data-time').textContent=formatDate(dataResult.value.generatedAt);
    }else{
      field(card,'count').textContent='—';
      field(card,'count-detail').textContent='公開データを読み込めませんでした。';
      if(config.dataUrl)field(card,'data-time').textContent='読み込みエラー';
    }

    let state=runState(run);
    if(apiError)state='unknown';
    if(!dataResult.ok)state='error';
    else if(dataResult.value.state==='error'&&state!=='running')state='error';
    else if(dataResult.value.state==='warning'&&state==='success')state='warning';

    if(run){
      const runTime=run.updated_at||run.run_started_at||run.created_at;
      const elapsed=duration(run.run_started_at||run.created_at,run.updated_at);
      field(card,'run-time').textContent=`${formatDate(runTime)}${elapsed?`（${elapsed}）`:''}`;
      field(card,'run-event').textContent=`${eventLabels[run.event]||run.event||'不明'} / #${run.run_number||'—'}`;
      latestLink.href=run.html_url;
      latestLink.classList.remove('btn-disabled');
    }else{
      field(card,'run-time').textContent=apiError?'API取得エラー':'実行履歴なし';
      field(card,'run-event').textContent='—';
      latestLink.removeAttribute('href');
      latestLink.classList.add('btn-disabled');
    }

    setPill(card,state);
    if(!dataResult.ok){
      setMessage(card,`公開データの読み込みに失敗しました：${dataResult.error}`,'error');
    }else if(apiError){
      setMessage(card,`GitHub Actionsの状況を取得できませんでした。公開データは読み込めています。`,'warning');
    }else if(state==='error'){
      setMessage(card,'最新のGitHub Actions実行が失敗しました。最新ログから原因を確認してください。','error');
    }else if(state==='running'){
      setMessage(card,'GitHub Actionsを実行中です。完了後に再読み込みしてください。','warning');
    }else if(state==='warning'){
      setMessage(card,dataResult.value.message||'確認が必要な項目があります。','warning');
    }else if(state==='success'){
      setMessage(card,dataResult.value.message||'最新の実行は正常に完了しています。','success');
    }else{
      setMessage(card,'実行状況を確認できませんでした。GitHub Actionsを直接確認してください。','warning');
    }
    return state;
  }

  function renderOverall(states,runInfo){
    const hasError=states.includes('error');
    const hasRunning=states.includes('running');
    const hasWarning=states.includes('warning')||states.includes('unknown');
    let state='success';
    let title='すべて正常';
    let description='最新の同期・トップページ更新・画像最適化・バックアップ・外部リンク・サイトチェックは正常に完了しています。';
    let mark='✓';
    if(hasError){state='error';title='問題があります';description='失敗またはデータ読み込みエラーがあります。対象カードの最新ログを確認してください。';mark='!';}
    else if(hasRunning){state='running';title='同期を実行中';description='GitHub Actionsの処理が進行中です。完了後にもう一度確認してください。';mark='↻';}
    else if(hasWarning){state='warning';title='確認が必要です';description='一部の状況を取得できないか、警告がある同期があります。';mark='△';}
    overallStatus.textContent=title;
    overallDescription.textContent=description;
    summaryMark.textContent=mark;
    toolbarDot.className=`live-dot is-${state}`;
    toolbarText.textContent=description;
    checkedAt.textContent=formatter.format(new Date());
    if(runInfo.errors.length===0)apiStatus.textContent=runInfo.source==='cache'?'正常（5分キャッシュ）':'正常';
    else if(runInfo.errors.length<Object.keys(configs).length)apiStatus.textContent='一部取得エラー';
    else apiStatus.textContent='取得できません';
  }

  async function refresh(force=false){
    refreshButton.disabled=true;
    refreshButton.classList.add('is-loading');
    toolbarDot.className='live-dot';
    toolbarText.textContent='最新状況を確認しています。';
    overallStatus.textContent='確認中';
    overallDescription.textContent='公開データとGitHub Actionsを読み込んでいます。';
    summaryMark.textContent='…';
    apiStatus.textContent='確認中';

    const dataEntries=await Promise.all(Object.entries(configs).map(async([key,config])=>{
      try{return [key,{ok:true,value:await loadData(config)}];}
      catch(error){return [key,{ok:false,error:error instanceof Error?error.message:String(error)}];}
    }));
    const dataResults=Object.fromEntries(dataEntries);
    const runInfo=await loadRuns(force);
    const errorMap=Object.fromEntries(runInfo.errors.map(item=>[item.key,item.error]));
    const states=Object.keys(configs).map(key=>renderCard(key,dataResults[key],runInfo.runs[key],errorMap[key]));
    renderOverall(states,runInfo);
    refreshButton.disabled=false;
    refreshButton.classList.remove('is-loading');
  }

  refreshButton?.addEventListener('click',()=>refresh(true));
  refresh(false).catch(error=>{
    console.error(error);
    overallStatus.textContent='読み込みエラー';
    overallDescription.textContent='管理ページの初期化に失敗しました。ページを再読み込みしてください。';
    summaryMark.textContent='!';
    toolbarDot.className='live-dot is-error';
    toolbarText.textContent='管理ページを読み込めませんでした。';
    checkedAt.textContent=formatter.format(new Date());
    apiStatus.textContent='未確認';
    refreshButton.disabled=false;
    refreshButton.classList.remove('is-loading');
  });
})();
