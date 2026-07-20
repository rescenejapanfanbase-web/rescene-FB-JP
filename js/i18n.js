(()=>{
  'use strict';

  const LANGUAGES={
    jp:{label:'JP',html:'ja',target:'ja'},
    kr:{label:'KR',html:'ko',target:'ko'},
    eng:{label:'ENG',html:'en',target:'en'},
  };
  const STORAGE_KEY='rescene-language';
  const CACHE_KEY='rescene-i18n-cache-v1';
  const JAPANESE_RE=/[\u3040-\u30ff\u3400-\u9fff々〆〤]/;
  const ATTRS=['aria-label','title','placeholder','alt'];
  const SKIP_SELECTOR='script,style,noscript,svg,path,code,pre,textarea,[translate="no"],[data-no-i18n],.logo,.track-title,.release-headline h2,.chant-song-title,.video-title,.mv-gallery-body h2,.channel-title,.member-profile-head h2,.member-preview-name,.member-detail-name,.official-link-card h3,.news-title';

  const translations={
    en:{
      'ホーム':'Home','サイト内検索':'Site Search','RESCENEについて':'About RESCENE','メンバー':'Members','スケジュール':'Schedule','ニュース':'News','音楽':'Music','ディスコグラフィ':'Discography','MV一覧':'MV List','応援ガイド':'Support Guide','ストリーミング':'Streaming','投票ガイド':'Voting Guide','掛け声ガイド':'Fan Chant Guide','リンク':'Links','公式リンク':'Official Links','テーマ切り替え':'Switch theme','メニューを開く':'Open menu','モバイルナビゲーション':'Mobile navigation',
      'RESCENEを日本から応援する非公式ファンベースです。':'An unofficial fanbase supporting RESCENE from Japan.','公式情報はRESCENEおよび所属事務所・各主催者の案内もあわせてご確認ください。':'Please also check announcements from RESCENE, the agency, and event organizers for official information.',
      'すべて':'All','動画':'Videos','ショート':'Shorts','ライブ':'Live','チャンネル':'Channels','投稿動画一覧':'All Videos','チャンネルを見る ↗':'View Channel ↗','YouTubeで見る ↗':'Watch on YouTube ↗','最新動画を取得しています。':'Loading the latest video.','動画タイトルを検索':'Search video titles','さらに表示':'Load More','読み込み中':'Loading',
      '公式リンクを読み込んでいます。':'Loading official links.','リンクを探す':'Find Links','公式コミュニティ':'Official Community','公式SNS':'Official Social Media','音楽配信':'Music Platforms','外部サイトで見る ↗':'View External Site ↗','ページを見る →':'View Page →',
      'ディスコグラフィ絞り込み':'Discography filters','作品データを読み込んでいます。':'Loading release data.','スペシャル・デジタルシングル':'Special & Digital Singles','ミニアルバム':'Mini Albums','フルアルバム':'Full Albums','シングルアルバム':'Single Albums','公開作品はまだありません':'No releases are available yet','曲名未設定':'Untitled Track','タイトル未設定':'Untitled','ジャケット':'cover','最終同期':'Last synced',
      '基本情報':'Basic Information','名前に込められた世界観':'The Meaning Behind the Name','もう一度':'Once Again','記憶に残る場面':'A Scene to Remember','メンバープロフィール':'Member Profiles','詳しく見る →':'View Details →','5人のメンバーを知る':'Meet the Five Members','メンバーを見る':'View Members','詳細プロフィールを見る':'View Full Profile','生年月日':'Date of Birth','出身地':'Hometown','本名':'Real Name','メンバーカラー':'Member Color','詳細プロフィール':'Full Profiles','ページ上部へ ↑':'Back to Top ↑','プロフィールを見る →':'View Profiles →',
      '検索':'Search','検索キーワード':'Search keywords','キーワードを入力してください':'Enter a keyword','検索結果がありません':'No results found','さらに24件表示':'Show 24 more','外部サイトで見る':'View external site','ページが見つかりません':'Page Not Found','ホームへ戻る':'Back to Home','お問い合わせ':'Contact','連絡する':'Contact Us','返信について':'About Replies','掲載内容の訂正':'Content Corrections','企画・広告のご相談':'Projects & Advertising',
      'カテゴリー':'Category','楽曲別ガイド':'Song Guides','掛け声を見る →':'View Fan Chant →','公式':'Official','非公式':'Unofficial','公式掛け声動画を見る':'Watch Official Fan Chant Video','掛け声動画を見る':'Watch Fan Chant Video',
      'サービス別ガイド':'Guides by Service','すべてのサービス':'All Services','詳しい手順':'Detailed Steps','詳しい手順を見る ↓':'View Detailed Steps ↓','確認：':'Note:','このカテゴリーのガイドはありません。':'No guide is available in this category.','配信作品を見る':'View Releases','MV一覧を見る':'View MV List',
      '現在の投票案内':'Current Voting Information','音楽番組':'Music Shows','投票アプリ一覧':'Voting Apps','音楽番組のスコア配分':'Music Show Score Distribution','使用アプリ':'App','準備するもの':'What You Need','投票':'Voting','事前投票':'Pre-voting','リアルタイム投票':'Live Voting','最終確認':'Last Checked','投票早見表':'Voting Quick Guide','画像付き投票ガイド':'Voting Guide with Images','手順':'Step','画像なし':'No Image',
      'スケジュールを読み込んでいます。':'Loading schedule.','日本時間で表示':'Shown in Japan time','今日':'Today','前の月':'Previous month','次の月':'Next month','予定':'Event','登録済みの予定':'Scheduled Events','すべての予定をカレンダーで受け取る':'Subscribe to All Events',
      '最新ニュース':'Latest News','ニュース一覧へ →':'View All News →','詳細を見る →':'View Details →','ニュース一覧へ戻る':'Back to News','記事を見る':'Read Article','記事を見る ↗':'Read Article ↗','記事を読み込んでいます。':'Loading article.',
      '同期状況':'Sync Status','確認中':'Checking','正常':'Healthy','要確認':'Needs Review','最終同期実行':'Last Sync Run','データ変更日時':'Data Updated','実行頻度':'Frequency','実行方法':'Trigger','手動実行先 ↗':'Run Manually ↗','最新ログ ↗':'Latest Log ↗','公開ページ →':'Public Page →','管理リンク':'Management Link','Notion管理 ↗':'Manage in Notion ↗',
      '公式情報を見る':'View Official Information','すべて見る →':'View All →','初めて来た方へ':'New Here?','まず見るページ':'Start Here','RESCENEを知る':'About RESCENE','5人を知る':'Meet the Members','音楽を聴く':'Listen to the Music','一緒に応援する':'Support Together','グループのコンセプトと歩み':'Group concept and journey','アルバム・シングル・MV':'Albums, singles, and MVs','ストリーミングと投票の基本':'Streaming and voting basics','最近追加・更新したガイド':'Recently Added & Updated Guides','最新情報まとめ':'Latest Updates','最新情報を見る':'View Latest Updates','公式情報':'Official Information',
      '曜日':'Day','土':'Sat','日':'Sun','月':'Mon','火':'Tue','水':'Wed','木':'Thu','金':'Fri','誕生日':'Birthday','記念日':'Anniversary','イベント':'Event','放送・その他':'Broadcast & Other','お知らせ':'Notice','リリース':'Release',
      '公開作品':'Published releases','件':'items','人':'members','曲':'tracks','最終更新':'Last updated','読み込みエラー':'Load Error','再読み込み':'Reload','時間をおいて再読み込みしてください。':'Please try reloading later.'
    },
    ko:{
      'ホーム':'홈','サイト内検索':'사이트 검색','RESCENEについて':'RESCENE 소개','メンバー':'멤버','スケジュール':'스케줄','ニュース':'뉴스','音楽':'음악','ディスコグラフィ':'디스코그래피','MV一覧':'MV 목록','応援ガイド':'응원 가이드','ストリーミング':'스트리밍','投票ガイド':'투표 가이드','掛け声ガイド':'응원법 가이드','リンク':'링크','公式リンク':'공식 링크','テーマ切り替え':'테마 전환','メニューを開く':'메뉴 열기','モバイルナビゲーション':'모바일 내비게이션',
      'RESCENEを日本から応援する非公式ファンベースです。':'일본에서 RESCENE을 응원하는 비공식 팬베이스입니다.','公式情報はRESCENEおよび所属事務所・各主催者の案内もあわせてご確認ください。':'공식 정보는 RESCENE, 소속사 및 각 주최 측의 안내도 함께 확인해 주세요.',
      'すべて':'전체','動画':'동영상','ショート':'쇼츠','ライブ':'라이브','チャンネル':'채널','投稿動画一覧':'업로드 영상 목록','チャンネルを見る ↗':'채널 보기 ↗','YouTubeで見る ↗':'YouTube에서 보기 ↗','最新動画を取得しています。':'최신 영상을 불러오는 중입니다.','動画タイトルを検索':'영상 제목 검색','さらに表示':'더 보기','読み込み中':'불러오는 중',
      '公式リンクを読み込んでいます。':'공식 링크를 불러오는 중입니다.','リンクを探す':'링크 찾기','公式コミュニティ':'공식 커뮤니티','公式SNS':'공식 SNS','音楽配信':'음원 플랫폼','外部サイトで見る ↗':'외부 사이트에서 보기 ↗','ページを見る →':'페이지 보기 →',
      'ディスコグラフィ絞り込み':'디스코그래피 필터','作品データを読み込んでいます。':'작품 데이터를 불러오는 중입니다.','スペシャル・デジタルシングル':'스페셜·디지털 싱글','ミニアルバム':'미니 앨범','フルアルバム':'정규 앨범','シングルアルバム':'싱글 앨범','公開作品はまだありません':'공개된 작품이 아직 없습니다','曲名未設定':'곡명 미설정','タイトル未設定':'제목 미설정','ジャケット':'재킷','最終同期':'마지막 동기화',
      '基本情報':'기본 정보','名前に込められた世界観':'이름에 담긴 세계관','もう一度':'다시 한번','記憶に残る場面':'기억에 남는 장면','メンバープロフィール':'멤버 프로필','詳しく見る →':'자세히 보기 →','5人のメンバーを知る':'다섯 멤버 알아보기','メンバーを見る':'멤버 보기','詳細プロフィールを見る':'상세 프로필 보기','生年月日':'생년월일','出身地':'출신지','本名':'본명','メンバーカラー':'멤버 컬러','詳細プロフィール':'상세 프로필','ページ上部へ ↑':'페이지 위로 ↑','プロフィールを見る →':'프로필 보기 →',
      '検索':'검색','検索キーワード':'검색어','キーワードを入力してください':'검색어를 입력해 주세요','検索結果がありません':'검색 결과가 없습니다','さらに24件表示':'24개 더 보기','外部サイトで見る':'외부 사이트에서 보기','ページが見つかりません':'페이지를 찾을 수 없습니다','ホームへ戻る':'홈으로 돌아가기','お問い合わせ':'문의','連絡する':'문의하기','返信について':'답변 안내','掲載内容の訂正':'게시 내용 수정','企画・広告のご相談':'기획·광고 문의',
      'カテゴリー':'카테고리','楽曲別ガイド':'곡별 가이드','掛け声を見る →':'응원법 보기 →','公式':'공식','非公式':'비공식','公式掛け声動画を見る':'공식 응원법 영상 보기','掛け声動画を見る':'응원법 영상 보기',
      'サービス別ガイド':'서비스별 가이드','すべてのサービス':'모든 서비스','詳しい手順':'상세 방법','詳しい手順を見る ↓':'상세 방법 보기 ↓','確認：':'확인:','このカテゴリーのガイドはありません。':'이 카테고리의 가이드가 없습니다.','配信作品を見る':'음원 보기','MV一覧を見る':'MV 목록 보기',
      '現在の投票案内':'현재 투표 안내','音楽番組':'음악방송','投票アプリ一覧':'투표 앱 목록','音楽番組のスコア配分':'음악방송 점수 배점','使用アプリ':'사용 앱','準備するもの':'준비물','投票':'투표','事前投票':'사전 투표','リアルタイム投票':'실시간 투표','最終確認':'최종 확인','投票早見表':'투표 요약표','画像付き投票ガイド':'이미지 투표 가이드','手順':'단계','画像なし':'이미지 없음',
      'スケジュールを読み込んでいます。':'스케줄을 불러오는 중입니다.','日本時間で表示':'일본 시간 기준','今日':'오늘','前の月':'이전 달','次の月':'다음 달','予定':'일정','登録済みの予定':'등록된 일정','すべての予定をカレンダーで受け取る':'모든 일정을 캘린더로 받기',
      '最新ニュース':'최신 뉴스','ニュース一覧へ →':'뉴스 목록 →','詳細を見る →':'자세히 보기 →','ニュース一覧へ戻る':'뉴스 목록으로 돌아가기','記事を見る':'기사 보기','記事を見る ↗':'기사 보기 ↗','記事を読み込んでいます。':'기사를 불러오는 중입니다.',
      '同期状況':'동기화 상태','確認中':'확인 중','正常':'정상','要確認':'확인 필요','最終同期実行':'마지막 동기화 실행','データ変更日時':'데이터 변경 시간','実行頻度':'실행 주기','実行方法':'실행 방법','手動実行先 ↗':'수동 실행 ↗','最新ログ ↗':'최신 로그 ↗','公開ページ →':'공개 페이지 →','管理リンク':'관리 링크','Notion管理 ↗':'Notion 관리 ↗',
      '公式情報を見る':'공식 정보 보기','すべて見る →':'전체 보기 →','初めて来た方へ':'처음 방문하셨나요?','まず見るページ':'먼저 볼 페이지','RESCENEを知る':'RESCENE 알아보기','5人を知る':'다섯 멤버 알아보기','音楽を聴く':'음악 듣기','一緒に応援する':'함께 응원하기','グループのコンセプトと歩み':'그룹 콘셉트와 여정','アルバム・シングル・MV':'앨범·싱글·MV','ストリーミングと投票の基本':'스트리밍과 투표 기본','最近追加・更新したガイド':'최근 추가·업데이트된 가이드','最新情報まとめ':'최신 정보 모음','最新情報を見る':'최신 정보 보기','公式情報':'공식 정보',
      '曜日':'요일','土':'토','日':'일','月':'월','火':'화','水':'수','木':'목','金':'금','誕生日':'생일','記念日':'기념일','イベント':'이벤트','放送・その他':'방송·기타','お知らせ':'공지','リリース':'발매',
      '公開作品':'공개 작품','件':'건','人':'명','曲':'곡','最終更新':'마지막 업데이트','読み込みエラー':'불러오기 오류','再読み込み':'새로고침','時間をおいて再読み込みしてください。':'잠시 후 다시 불러와 주세요.'
    }
  };

  const originalText=new WeakMap();
  const originalAttrs=new WeakMap();
  const cache=loadCache();
  let currentLanguage=normalizeLanguage(readStorage(STORAGE_KEY)||'jp');
  let translator=null;
  let translatorTarget='';
  let applying=false;
  let runToken=0;
  let cacheSaveTimer=0;
  let observer=null;
  let mutationTimer=0;

  function normalizeLanguage(value){return Object.hasOwn(LANGUAGES,value)?value:'jp'}
  function readStorage(key){try{return localStorage.getItem(key)}catch{return null}}
  function writeStorage(key,value){try{localStorage.setItem(key,value)}catch{}}
  function loadCache(){
    try{const value=JSON.parse(localStorage.getItem(CACHE_KEY)||'{}');return value&&typeof value==='object'?value:{}}
    catch{return {}}
  }
  function saveCacheSoon(){
    clearTimeout(cacheSaveTimer);
    cacheSaveTimer=setTimeout(()=>{
      try{
        const entries=Object.entries(cache);
        if(entries.length>1200){entries.sort((a,b)=>(b[1]?.used||0)-(a[1]?.used||0));for(const [key] of entries.slice(1000))delete cache[key]}
        localStorage.setItem(CACHE_KEY,JSON.stringify(cache));
      }catch{}
    },300);
  }
  function hasJapanese(value){return JAPANESE_RE.test(String(value||''))}
  function isSkipped(node){
    const element=node?.nodeType===Node.ELEMENT_NODE?node:node?.parentElement;
    return !element||Boolean(element.closest(SKIP_SELECTOR));
  }
  function exactTranslation(value,target){return translations[target]?.[value]||''}
  function cacheKey(value,target){return `${target}\u0000${value}`}
  function getCached(value,target){
    const hit=cache[cacheKey(value,target)];
    if(hit?.text){hit.used=Date.now();return hit.text}
    return '';
  }
  function setCached(value,target,text){cache[cacheKey(value,target)]={text,used:Date.now()};saveCacheSoon()}
  function splitWhitespace(value){
    const match=String(value).match(/^(\s*)([\s\S]*?)(\s*)$/);
    return {prefix:match?.[1]||'',body:match?.[2]||'',suffix:match?.[3]||''};
  }
  function translatedStatic(value,target){
    const direct=exactTranslation(value,target);
    if(direct)return direct;
    const arrows=value.match(/\s*[↗→↓↑]+$/)?.[0]||'';
    if(arrows){const base=value.slice(0,-arrows.length).trimEnd();const mapped=exactTranslation(base,target);if(mapped)return `${mapped}${arrows}`}
    return '';
  }
  async function createTranslator(target,token,userActivated){
    if(target==='ja')return null;
    if(translator&&translatorTarget===target)return translator;
    translator=null;translatorTarget='';
    if(!('Translator' in self))return null;
    try{
      const availability=await self.Translator.availability({sourceLanguage:'ja',targetLanguage:target});
      if(token!==runToken||availability==='unavailable')return null;
      setLanguageStatus(availability==='downloadable'?(target==='ko'?'한국어 언어 팩 준비 중':'Preparing English language pack'):'');
      const created=await self.Translator.create({
        sourceLanguage:'ja',targetLanguage:target,
        monitor(m){m.addEventListener('downloadprogress',event=>{if(token===runToken)setLanguageStatus(`${LANGUAGES[currentLanguage].label} ${Math.round((event.loaded||0)*100)}%`)})},
      });
      if(token!==runToken){created?.destroy?.();return null}
      translator=created;translatorTarget=target;setLanguageStatus('');return created;
    }catch(error){
      console.info('Translator API is unavailable for this session.',error);
      if(userActivated)setLanguageStatus(target==='ko'?'공통 메뉴를 번역했습니다':'Common interface translated');
      return null;
    }
  }
  async function translateValue(value,target,engine){
    if(!hasJapanese(value))return value;
    const manual=translatedStatic(value,target);
    if(manual)return manual;
    const cached=getCached(value,target);
    if(cached)return cached;
    if(!engine)return value;
    try{
      const result=await engine.translate(value);
      if(result&&result!==value)setCached(value,target,result);
      return result||value;
    }catch{return value}
  }
  function collectTextNodes(root=document.body){
    const nodes=[];
    if(!root)return nodes;
    if(root.nodeType===Node.TEXT_NODE){if(hasJapanese(root.nodeValue)&&!isSkipped(root))nodes.push(root);return nodes}
    if(root.nodeType!==Node.ELEMENT_NODE&&root.nodeType!==Node.DOCUMENT_NODE&&root.nodeType!==Node.DOCUMENT_FRAGMENT_NODE)return nodes;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode(node){
      if(!node.nodeValue?.trim()||!hasJapanese(node.nodeValue)||isSkipped(node))return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }});
    let node;while((node=walker.nextNode()))nodes.push(node);
    return nodes;
  }
  function collectAttributeElements(root=document.body){
    const elements=[];
    if(!root)return elements;
    if(root.nodeType===Node.ELEMENT_NODE)elements.push(root);
    root.querySelectorAll?.('*').forEach(element=>elements.push(element));
    return elements.filter(element=>!isSkipped(element)&&ATTRS.some(attr=>hasJapanese(element.getAttribute(attr)||'')));
  }
  function rememberText(node){if(!originalText.has(node))originalText.set(node,node.nodeValue)}
  function rememberAttrs(element){
    if(originalAttrs.has(element))return;
    const saved={};ATTRS.forEach(attr=>{if(element.hasAttribute(attr))saved[attr]=element.getAttribute(attr)});originalAttrs.set(element,saved);
  }
  function restoreSubtree(root=document.body){
    applying=true;
    collectAllTextNodes(root).forEach(node=>{if(originalText.has(node))node.nodeValue=originalText.get(node)});
    collectAllElements(root).forEach(element=>{const attrs=originalAttrs.get(element);if(attrs)Object.entries(attrs).forEach(([name,value])=>element.setAttribute(name,value))});
    if(document.documentElement.dataset.originalTitle)document.title=document.documentElement.dataset.originalTitle;
    applying=false;
  }
  function collectAllTextNodes(root){
    const nodes=[];if(!root)return nodes;
    if(root.nodeType===Node.TEXT_NODE)return [root];
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode()))nodes.push(node);return nodes;
  }
  function collectAllElements(root){
    const items=[];if(root?.nodeType===Node.ELEMENT_NODE)items.push(root);root?.querySelectorAll?.('*').forEach(el=>items.push(el));return items;
  }
  async function translateSubtree(root,language,engine,token){
    if(language==='jp')return;
    const target=LANGUAGES[language].target;
    const nodes=collectTextNodes(root);
    const attrs=collectAttributeElements(root);
    let complete=0,total=nodes.length+attrs.reduce((sum,el)=>sum+ATTRS.filter(attr=>hasJapanese(el.getAttribute(attr)||'')).length,0);
    applying=true;
    for(const node of nodes){
      if(token!==runToken)break;
      rememberText(node);
      const original=originalText.get(node);
      const {prefix,body,suffix}=splitWhitespace(original);
      node.nodeValue=prefix+await translateValue(body,target,engine)+suffix;
      complete++;if(total>20&&complete%12===0)setLanguageStatus(`${LANGUAGES[language].label} ${Math.round(complete/total*100)}%`);
    }
    for(const element of attrs){
      if(token!==runToken)break;
      rememberAttrs(element);
      const originals=originalAttrs.get(element);
      for(const attr of ATTRS){
        const original=originals?.[attr];
        if(!hasJapanese(original))continue;
        element.setAttribute(attr,await translateValue(original,target,engine));
        complete++;
      }
    }
    applying=false;
  }
  async function applyLanguage(language,{userActivated=false,root=document.body}={}){
    language=normalizeLanguage(language);
    const token=++runToken;
    currentLanguage=language;
    writeStorage(STORAGE_KEY,language);
    document.documentElement.lang=LANGUAGES[language].html;
    document.documentElement.dataset.language=language;
    updateLanguageControls();
    if(!document.documentElement.dataset.originalTitle)document.documentElement.dataset.originalTitle=document.title;
    restoreSubtree(document.body);
    if(language==='jp'){setLanguageStatus('');return}
    const target=LANGUAGES[language].target;
    const manualTitle=translatedStatic(document.documentElement.dataset.originalTitle,target);
    const engine=await createTranslator(target,token,userActivated);
    if(token!==runToken)return;
    document.title=manualTitle||await translateValue(document.documentElement.dataset.originalTitle,target,engine);
    await translateSubtree(root,language,engine,token);
    if(token===runToken)setLanguageStatus(engine?'':(language==='kr'?'공통 메뉴를 번역했습니다':'Common interface translated'));
  }
  function setLanguageStatus(value){
    document.querySelectorAll('[data-language-status]').forEach(element=>{element.textContent=value;element.hidden=!value});
  }
  function updateLanguageControls(){
    document.querySelectorAll('[data-language-option]').forEach(button=>{
      const active=button.dataset.languageOption===currentLanguage;
      button.classList.toggle('is-active',active);button.setAttribute('aria-pressed',String(active));
    });
    document.querySelectorAll('[data-language-current]').forEach(element=>element.textContent=LANGUAGES[currentLanguage].label);
  }
  function languageButtons(){return Object.entries(LANGUAGES).map(([key,item])=>`<button type="button" data-language-option="${key}" aria-pressed="${key===currentLanguage}">${item.label}</button>`).join('')}
  function injectStyles(){
    if(document.getElementById('rescene-language-style'))return;
    const style=document.createElement('style');style.id='rescene-language-style';style.textContent=`
      .language-nav{position:relative;display:flex;align-items:center}.language-nav-toggle{min-width:42px;height:40px;padding:0 10px;border:1px solid var(--border);background:var(--soft-bg);color:var(--text);border-radius:999px;font-size:.7rem;font-weight:900;letter-spacing:.04em;cursor:pointer}.language-nav-toggle:hover{color:var(--pink);border-color:rgba(255,111,174,.5)}.language-popover{position:absolute;right:0;top:calc(100% + 10px);z-index:1100;display:none;min-width:184px;padding:12px;background:var(--card);border:1px solid var(--border);border-radius:15px;box-shadow:var(--shadow)}.language-popover.is-open{display:block}.language-title{display:block;margin-bottom:8px;color:var(--muted);font-size:.62rem;font-weight:900;letter-spacing:.13em}.language-options{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.language-options button{min-height:34px;border:1px solid var(--border);border-radius:10px;background:var(--soft-bg);color:var(--muted);font-size:.68rem;font-weight:900;cursor:pointer}.language-options button:hover,.language-options button.is-active{color:#fff;background:linear-gradient(135deg,var(--pink),var(--purple));border-color:transparent}.language-status{display:block;margin-top:8px;color:var(--muted);font-size:.58rem;line-height:1.35}.language-mobile-block{margin:14px 0 0;padding:16px 0 0;border-top:1px solid var(--border)}.language-mobile-block .language-options button{min-height:38px}.language-mobile-block .language-title{margin-bottom:9px}.language-mobile-block .language-status{margin-top:7px}@media(max-width:979px){.language-nav{display:none}}@media(min-width:980px){.language-mobile-block{display:none}}html.light-mode .language-options button.is-active{color:#fff}
    `;document.head.appendChild(style);
  }
  function injectControls(){
    injectStyles();
    const navActions=document.querySelector('.nav-actions');
    if(navActions&&!navActions.querySelector('.language-nav')){
      const holder=document.createElement('div');holder.className='language-nav';holder.innerHTML=`<button class="language-nav-toggle" type="button" aria-label="Language" aria-haspopup="true" aria-expanded="false"><span data-language-current>${LANGUAGES[currentLanguage].label}</span></button><div class="language-popover"><span class="language-title">LANGUAGE</span><div class="language-options">${languageButtons()}</div><small class="language-status" data-language-status hidden></small></div>`;
      const hamburger=navActions.querySelector('.hamburger');navActions.insertBefore(holder,hamburger||null);
      const toggle=holder.querySelector('.language-nav-toggle'),popover=holder.querySelector('.language-popover');
      toggle.addEventListener('click',event=>{event.stopPropagation();const open=!popover.classList.contains('is-open');popover.classList.toggle('is-open',open);toggle.setAttribute('aria-expanded',String(open))});
      document.addEventListener('click',event=>{if(!holder.contains(event.target)){popover.classList.remove('is-open');toggle.setAttribute('aria-expanded','false')}});
    }
    const menu=document.querySelector('.mobile-menu');
    if(menu&&!menu.querySelector('.language-mobile-block')){
      const block=document.createElement('div');block.className='language-mobile-block';block.innerHTML=`<span class="language-title">LANGUAGE</span><div class="language-options">${languageButtons()}</div><small class="language-status" data-language-status hidden></small>`;menu.appendChild(block);
    }
    document.querySelectorAll('[data-language-option]').forEach(button=>button.addEventListener('click',()=>applyLanguage(button.dataset.languageOption,{userActivated:true})));
    updateLanguageControls();
  }
  function observeDynamicContent(){
    observer?.disconnect();
    observer=new MutationObserver(mutations=>{
      if(applying||currentLanguage==='jp')return;
      const roots=[];
      mutations.forEach(mutation=>{
        mutation.addedNodes.forEach(node=>{if(node.nodeType===Node.ELEMENT_NODE||node.nodeType===Node.TEXT_NODE)roots.push(node)});
        if(mutation.type==='characterData')roots.push(mutation.target);
      });
      if(!roots.length)return;
      clearTimeout(mutationTimer);
      mutationTimer=setTimeout(async()=>{
        const token=runToken;
        const target=LANGUAGES[currentLanguage].target;
        const engine=await createTranslator(target,token,false);
        for(const root of roots){if(token!==runToken)break;await translateSubtree(root,currentLanguage,engine,token)}
        if(token===runToken)setLanguageStatus('');
      },100);
    });
    observer.observe(document.body,{subtree:true,childList:true,characterData:true});
  }
  function init(){
    injectControls();observeDynamicContent();
    if(currentLanguage!=='jp')applyLanguage(currentLanguage,{userActivated:false});
    document.addEventListener('rescene:content-updated',()=>{if(currentLanguage!=='jp')applyLanguage(currentLanguage,{userActivated:false})});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
