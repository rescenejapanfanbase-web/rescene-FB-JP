const GUIDE_ALIASES = new Map([
  ["youtube", "YouTube"],
  ["spotify", "Spotify"],
  ["apple music", "Apple Music"],
  ["applemusic", "Apple Music"],
  ["stationhead", "Stationhead"],
  ["tiktok", "TikTok"],
  ["tik tok", "TikTok"],
  ["duck ad", "Duck AD"],
  ["duckad", "Duck AD"],
]);

export const STANDARD_STREAMING_GUIDES = {
  YouTube: {
    type: "動画",
    subtitle: "公式MV・映像を最初から楽しむ",
    description: "公式チャンネルを開くところから、視聴設定、自然な再生、次の動画への移動までを順番に確認できます。",
    preparation: [
      "YouTubeアプリまたはブラウザ",
      "安定した通信環境",
      "必要に応じてGoogleアカウント",
    ],
    points: [
      "RESCENE Officialなど公式公開元の動画を選ぶ",
      "通信環境に合った画質と聞こえる音量で視聴する",
      "同じ動画だけを不自然に繰り返さず、ほかの公式動画も楽しむ",
    ],
    steps: [
      { title: "1. 公式動画を開く", text: "サイトのMV一覧またはRESCENE Officialから、視聴したい公式MV・パフォーマンス映像を開きます。", image: "" },
      { title: "2. 必要に応じてログイン", text: "高評価、コメント、チャンネル登録などを利用する場合はGoogleアカウントでログインします。一度ログイン済みなら毎回やり直す必要はありません。", image: "" },
      { title: "3. 画質と音量を確認", text: "プレーヤーの設定から、自動または通信環境に合う画質を選びます。音量は自分に聞こえる範囲で再生します。", image: "" },
      { title: "4. 最初から自然に視聴", text: "普段の動画視聴と同じように、急な早送りや短時間での連続スキップを避けて映像と音楽を楽しみます。", image: "" },
      { title: "5. 次の公式動画へ進む", text: "視聴後は別のRESCENE公式動画や関連する公式コンテンツへ移動し、同じ動画だけの連続ループに偏らないようにします。", image: "" },
      { title: "6. Premium利用時の連続再生", text: "このサイトで連続再生用プレイリストを案内する場合は、YouTube Premium利用時を想定します。無料利用時は通常の視聴方法で楽しんでください。", image: "" },
      { title: "7. 反応・共有する", text: "内容を楽しめたら、高評価、コメント、共有などを無理のない範囲で行います。公式動画のURLを共有するときは公開元を確認してください。", image: "" },
    ],
    link: "mv.html",
    buttonLabel: "MV一覧を見る",
    icon: "assets/platform-icons/youtube.png",
    note: "再生回数の集計方法は各サービス側で管理されています。特定の操作による集計を保証するものではないため、普段どおり自然に視聴してください。",
  },
  Spotify: {
    type: "音楽ストリーミング",
    subtitle: "アカウント準備からプレイリスト再生まで",
    description: "Spotifyを初めて使う場合でも、アプリの準備、公式配信の確認、ライブラリ追加、プレイリスト作成まで順番に進められます。",
    preparation: [
      "SpotifyアプリまたはWebプレイヤー",
      "Spotifyアカウント（Free・Premiumどちらでも可）",
      "オンライン再生できる通信環境",
    ],
    points: [
      "アーティスト名と作品名を確認して公式配信を開く",
      "好きな曲へ保存し、プレイリストにも追加する",
      "RESCENE以外の曲も混ぜ、普段どおり音楽を楽しむ",
    ],
    steps: [
      { title: "1. アプリを準備する", text: "SpotifyアプリをインストールするかWebプレイヤーを開き、アカウントを作成してログインします。", image: "" },
      { title: "2. 公式配信を開く", text: "サイトのディスコグラフィからSpotifyボタンを選び、RESCENEのアーティスト名・ジャケット・作品名を確認します。", image: "" },
      { title: "3. ライブラリへ保存する", text: "曲やアルバムの追加・保存ボタンを押し、マイライブラリからすぐ開ける状態にします。", image: "" },
      { title: "4. プレイリストを作成する", text: "スマホでは「作成」から「プレイリスト」を選び、名前を付けます。既存プレイリストを使う場合はこの手順を省略できます。", image: "" },
      { title: "5. 曲を追加する", text: "曲のメニューから「プレイリストに追加」を選びます。RESCENEの曲だけに限定せず、普段聴くほかの曲も混ぜて構成します。", image: "" },
      { title: "6. 自然に再生する", text: "聞こえる音量で再生し、短時間の連続スキップや同じ1曲だけの極端な反復を避け、日常の音楽として楽しみます。", image: "" },
      { title: "7. 再生状態を確認する", text: "曲名の横に再生中表示が出ているか、通信が切れていないかを確認します。アプリ更新で表示名が変わる場合は現在の画面案内に従ってください。", image: "" },
    ],
    link: "discography.html",
    buttonLabel: "配信作品を見る",
    icon: "assets/platform-icons/spotify.png",
    note: "FreeとPremiumでは再生順や広告などの機能が異なります。利用中のプランで表示される操作に従ってください。",
  },
  "Apple Music": {
    type: "音楽ストリーミング",
    subtitle: "公式配信をライブラリとプレイリストへ追加",
    description: "Apple Musicの準備から公式作品の確認、ライブラリ追加、プレイリスト作成、オンライン再生までを案内します。",
    preparation: [
      "Apple Musicアプリ",
      "Apple Accountまたは対応するログイン情報",
      "Apple Musicを利用できる契約・通信環境",
    ],
    points: [
      "公式配信ページから作品を開く",
      "ライブラリとプレイリストへ追加する",
      "オンライン再生とダウンロード再生の状態を確認する",
    ],
    steps: [
      { title: "1. Apple Musicを開く", text: "iPhone、iPad、Android、Mac、WindowsなどでApple Musicアプリを開き、利用するアカウントでサインインします。", image: "" },
      { title: "2. 公式配信を開く", text: "サイトのディスコグラフィからApple Musicボタンを選び、RESCENEのアーティスト名、作品名、ジャケットを確認します。", image: "streaming/apple-music-play.jpg" },
      { title: "3. ライブラリへ追加する", text: "曲またはアルバムの追加ボタンを押し、ライブラリからいつでも開ける状態にします。", image: "" },
      { title: "4. プレイリストを作成する", text: "「ライブラリ」からプレイリストを開き、新規プレイリストを作成します。すでに使っているプレイリストがあれば新しく作る必要はありません。", image: "" },
      { title: "5. 曲をプレイリストへ追加", text: "曲のメニューから「プレイリストに追加」を選びます。RESCENEの曲と普段聴くほかの曲を組み合わせます。", image: "" },
      { title: "6. 再生方法を確認する", text: "オンラインで聴く場合は通信状態を確認します。端末へダウンロード済みの場合はオフライン再生になることがあるため、目的に合わせて使い分けます。", image: "" },
      { title: "7. 自然に楽しむ", text: "聞こえる音量で再生し、急な連続スキップや同じ曲だけの極端な反復を避けて、普段の音楽として楽しみます。", image: "" },
    ],
    link: "discography.html",
    buttonLabel: "配信作品を見る",
    icon: "assets/platform-icons/apple-music.png",
    note: "Apple Musicのボタン名や配置はOS・アプリのバージョンによって異なる場合があります。表示中の案内を優先してください。",
  },
  Stationhead: {
    type: "コミュニティ",
    subtitle: "音楽サービスを連携してリスニングパーティーへ参加",
    description: "アプリの登録、音楽サービスの連携、ルーム検索、参加中の確認までを順番に案内します。",
    preparation: [
      "Stationheadアプリまたは対応ブラウザ",
      "Stationheadアカウント",
      "アプリに表示される対応音楽サービスのアカウント",
    ],
    points: [
      "最初に音楽サービスの連携状態を確認する",
      "公式案内または信頼できる主催者のルームリンクを使う",
      "配信中は接続状態と再生中表示を確認する",
    ],
    steps: [
      { title: "1. Stationheadを準備", text: "StationheadアプリをインストールするかWeb版を開き、メールアドレスなどでアカウントを作成してログインします。", image: "" },
      { title: "2. 音楽サービスを連携", text: "設定または初回案内から、画面に表示される対応音楽サービスを連携します。必要な契約条件はStationhead側の最新表示を確認してください。", image: "" },
      { title: "3. ルームを探す", text: "ファンベースや主催者が案内するルームURLを開くか、Stationhead内でRESCENEを検索します。", image: "" },
      { title: "4. 配信中のルームへ参加", text: "LIVE表示や配信中の表示を確認して入室します。開始前の場合は通知設定や開始時刻を確認します。", image: "" },
      { title: "5. 再生接続を確認", text: "画面上で曲名が切り替わっているか、連携サービスが切断されていないかを確認します。音が出ない場合は端末音量と連携状態を見直します。", image: "" },
      { title: "6. チャットや反応を楽しむ", text: "チャット、リアクション、共有は無理のない範囲で参加します。個人情報やアカウント情報は投稿しないでください。", image: "" },
      { title: "7. 終了後に退出する", text: "配信終了表示を確認してルームを退出します。不要になった通知や連携設定はアプリの設定画面から見直せます。", image: "" },
    ],
    link: "",
    buttonLabel: "",
    icon: "assets/platform-icons/stationhead.webp",
    note: "固定ルームがない場合は、開催時にファンベースや主催者が案内する最新リンクから参加してください。",
  },
  TikTok: {
    type: "SNS",
    subtitle: "公式音源を探して投稿へ追加",
    description: "投稿作成画面を開くところから、RESCENEの音源検索、公式音源の確認、投稿前チェックまでを案内します。",
    preparation: [
      "TikTokアプリ",
      "投稿または下書きを作成できるアカウント",
      "投稿に使用する動画または写真",
    ],
    points: [
      "投稿作成画面の楽曲・サウンド追加から検索する",
      "曲名とアーティスト名がRESCENEであることを確認する",
      "公開前に音量、使用範囲、公開設定を確認する",
    ],
    steps: [
      { title: "1. 投稿作成を開く", text: "TikTokアプリ下部の「＋」から投稿作成へ進み、動画を撮影するか端末内の動画・写真を選びます。", image: "" },
      { title: "2. 楽曲・サウンドを追加", text: "編集画面上部などにある「楽曲を選ぶ」「サウンドを追加」を開きます。表示名はアプリ更新で変わる場合があります。", image: "" },
      { title: "3. RESCENEを検索", text: "検索欄へ「RESCENE」または使用したい曲名を入力します。候補が多い場合は曲名とアーティスト名を両方確認します。", image: "" },
      { title: "4. 公式音源を選ぶ", text: "アーティスト名がRESCENEになっている音源を選び、試聴して曲が合っているか確認します。", image: "" },
      { title: "5. 使用部分と音量を調整", text: "動画に合わせて使用する部分を選び、元動画の音声と楽曲の音量バランスを調整します。", image: "" },
      { title: "6. 投稿内容を確認", text: "キャプション、タグ、公開範囲、コメント設定などを確認します。すぐ公開しない場合は下書き保存も利用できます。", image: "" },
      { title: "7. 投稿・共有する", text: "内容に問題がなければ投稿します。ほかの投稿を共有するときも、公式音源が付いているかを確認します。", image: "" },
    ],
    link: "",
    buttonLabel: "",
    icon: "assets/platform-icons/tiktok.webp",
    note: "ビジネス・宣伝目的の投稿では使用できる楽曲が制限される場合があります。投稿画面に表示される利用条件を確認してください。",
  },
  "Duck AD": {
    type: "応援サポート",
    subtitle: "登録・ミッション・投票券使用まで",
    description: "アプリの準備、RESCENEの選択、再生ミッションの確認、投票券の受け取りと使用までを順番に案内します。",
    preparation: [
      "公式アプリストアから入手したDuck AD",
      "Duck ADアカウント",
      "参加するミッションで指定された音楽サービス",
    ],
    points: [
      "ミッションごとの対象サービス・回数・期限を先に確認する",
      "必要な権限と連携先を確認してから開始する",
      "獲得後は投票券の有効期限と使用先を確認する",
    ],
    steps: [
      { title: "1. 公式アプリを入手", text: "App StoreまたはGoogle PlayでDuck ADを確認し、提供元とアプリ名を確認してインストールします。", image: "" },
      { title: "2. アカウントを作成", text: "アプリを開き、案内に従って登録・ログインします。通知や権限は内容を確認し、必要なものだけ許可してください。", image: "" },
      { title: "3. RESCENEを登録", text: "アーティスト検索やお気に入り設定からRESCENEを選び、関連する投票・ミッションを見つけやすくします。", image: "" },
      { title: "4. ミッション条件を確認", text: "Spotify、Melon、YouTubeなど、対象サービス、必要回数、対象曲、集計期間、締切を開始前に確認します。", image: "" },
      { title: "5. 指定サービスを連携", text: "ミッション画面の案内に従って対象サービスを連携します。アカウント名やログイン先を確認し、不明な外部画面には情報を入力しないでください。", image: "" },
      { title: "6. 再生・認証を実行", text: "アプリ内の開始ボタンや認証手順から再生し、進捗表示が増えているか確認します。通常のアプリから再生しただけでは認証されない場合があります。", image: "" },
      { title: "7. 報酬を受け取る", text: "条件達成後に受け取りボタンがある場合は押し、投票券やポイントが残高へ追加されたかを確認します。", image: "" },
      { title: "8. 投票券を使用する", text: "対象投票を開き、RESCENEを選択して使用枚数を確認します。確定後は完了表示や残高を確認し、締切前に反映を終えます。", image: "" },
    ],
    link: "",
    buttonLabel: "",
    icon: "assets/platform-icons/duck-ad.webp",
    note: "対応サービス、認証方法、必要回数、投票券の期限はイベントごとに変わります。必ずアプリ内の最新条件を優先してください。",
  },
};

function canonicalGuideTitle(value = "") {
  const normalized = String(value).normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
  return GUIDE_ALIASES.get(normalized) || "";
}

const cleanArray = (value) => Array.isArray(value) ? value.filter(Boolean) : [];

export function applyStreamingDefaults(guide = {}, options = {}) {
  const canonical = canonicalGuideTitle(guide.title);
  const standard = canonical ? STANDARD_STREAMING_GUIDES[canonical] : null;
  if (!standard) return { ...guide };

  const customSteps = cleanArray(guide.steps);
  const standardSteps = cleanArray(standard.steps);
  let steps;
  if (options.replaceStandardSteps || customSteps.length >= standardSteps.length) {
    steps = customSteps.length ? customSteps : standardSteps;
  } else {
    const normalizeStepTitle = (value = "") => String(value)
      .normalize("NFKC")
      .replace(/^\s*(?:STEP\s*)?\d+[.．:：)）-]?\s*/i, "")
      .replace(/\s+/g, "")
      .toLowerCase();
    const usedCustom = new Set();
    steps = standardSteps.map((step, index) => {
      const standardTitle = normalizeStepTitle(step.title);
      let matchedIndex = customSteps.findIndex((custom, customIndex) => {
        if (usedCustom.has(customIndex) || !custom?.image) return false;
        const customTitle = normalizeStepTitle(custom.title);
        return customTitle && (customTitle === standardTitle || customTitle.includes(standardTitle) || standardTitle.includes(customTitle));
      });
      if (matchedIndex < 0 && customSteps[index]?.image && !usedCustom.has(index)) matchedIndex = index;
      if (matchedIndex >= 0) usedCustom.add(matchedIndex);
      return {
        ...step,
        image: matchedIndex >= 0 ? customSteps[matchedIndex].image : (step.image || ""),
      };
    });
    for (const [index, extra] of customSteps.entries()) {
      if (index >= standardSteps.length && !usedCustom.has(index)) steps.push(extra);
    }
  }

  return {
    ...standard,
    ...guide,
    title: guide.title || canonical,
    type: guide.type || standard.type,
    subtitle: guide.subtitle || standard.subtitle,
    description: guide.description || standard.description,
    preparation: cleanArray(guide.preparation).length ? cleanArray(guide.preparation) : cleanArray(standard.preparation),
    points: cleanArray(guide.points).length ? cleanArray(guide.points) : cleanArray(standard.points),
    steps,
    link: guide.link || standard.link || "",
    buttonLabel: guide.buttonLabel || standard.buttonLabel || "",
    icon: guide.icon || standard.icon || "",
    note: guide.note || standard.note || "",
  };
}
