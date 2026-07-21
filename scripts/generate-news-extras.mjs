import { readFile, writeFile, mkdir } from 'node:fs/promises';
const BASE_URL=(process.env.SITE_BASE_URL||'https://rescene-fb.jp').replace(/\/$/,'');
const readJson=async(path,fallback)=>{try{return JSON.parse(await readFile(path,'utf8'));}catch{return fallback;}};
const newsPayload=await readJson('data/news.json',{news:[]});
const memberPayload=await readJson('data/members.json',{members:[]});
const discographyPayload=await readJson('data/discography.json',{releases:[]});
const news=Array.isArray(newsPayload.news)?newsPayload.news:[];
const members=Array.isArray(memberPayload.members)?memberPayload.members:[];
const releases=Array.isArray(discographyPayload.releases)?discographyPayload.releases:[];
const normalize=value=>String(value||'').normalize('NFKC').toLowerCase();
const stop=new Set(['rescene','リセンヌ','리센느','について','お知らせ','公式','日本','配信','開始','発売','公開','記録','獲得','任命','サイト','ファンベース','ニュース','イベント','special','digital','single','album','mini','the','and','with','from']);
const tokens=value=>[...new Set(normalize(value).replace(/[\s\n、。・「」『』（）()\[\]【】!！?？:：/／・,.-]+/g,' ').split(' ').map(x=>x.trim()).filter(x=>x.length>=2&&!stop.has(x)))];
const memberTerms=members.map(m=>({slug:m.slug,name:m.name,terms:[m.name,m.koreanName,m.japaneseName,m.realName].map(normalize).filter(Boolean)}));
const releaseTerms=releases.map(r=>({slug:r.slug||r.anchor||'',title:r.title||r.name||'',terms:[r.title,r.name,r.subtitle,...(Array.isArray(r.tracks)?r.tracks.map(t=>typeof t==='string'?t:t?.title):[])].map(normalize).filter(Boolean)}));
const enrich=item=>{
 const text=normalize([item.title,item.text,item.body,item.categoryName,item.label].filter(Boolean).join(' '));
 const people=memberTerms.filter(m=>m.terms.some(term=>term&&text.includes(term))).map(m=>m.slug);
 const works=releaseTerms.filter(r=>r.terms.some(term=>term.length>=3&&text.includes(term))).map(r=>r.slug||normalize(r.title));
 return {...item,_tokens:tokens(text),_people:people,_works:works};
};
const enriched=news.map(enrich);
const related={};
for(const item of enriched){
 related[item.slug]=enriched.filter(other=>other.slug!==item.slug).map(other=>{
   let score=0;const reasons=[];
   if(item.category&&item.category===other.category){score+=5;reasons.push('同じカテゴリー');}
   const overlap=item._tokens.filter(token=>other._tokens.includes(token));score+=Math.min(8,overlap.length*2);if(overlap.length)reasons.push('共通キーワード');
   const people=item._people.filter(x=>other._people.includes(x));score+=people.length*6;if(people.length)reasons.push('同じメンバー');
   const works=item._works.filter(x=>other._works.includes(x));score+=works.length*7;if(works.length)reasons.push('同じ作品');
   const dateA=Date.parse(String(item.date||'').replaceAll('.','-'));const dateB=Date.parse(String(other.date||'').replaceAll('.','-'));
   if(Number.isFinite(dateA)&&Number.isFinite(dateB)){const days=Math.abs(dateA-dateB)/86400000;if(days<45)score+=2;else if(days<180)score+=1;}
   return {score,reasons,item:other};
 }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||String(b.item.date).localeCompare(String(a.item.date))).slice(0,3).map(({score,reasons,item:other})=>({slug:other.slug,title:other.title,date:other.date,label:other.label,image:other.image,text:other.text,score,reasons}));
}
const baseTags=['#RESCENE','#리센느','#リセンヌ'];
const categoryTag={release:'#RESCENE_RELEASE',event:'#RESCENE_EVENT',ambassador:'#RESCENE_AMBASSADOR',notice:''};
const trimTo=(text,max)=>text.length<=max?text:`${text.slice(0,Math.max(0,max-1)).trim()}…`;
const socialPosts=news.map(item=>{
 const url=`${BASE_URL}/articles/${encodeURIComponent(item.slug)}.html`;
 const tags=[categoryTag[item.category],...baseTags].filter(Boolean).join(' ');
 const date=item.date&&/^\d{4}\.\d{2}\.\d{2}$/.test(item.date)?`【${item.date}】`:'【NEWS】';
 const reserved=url.length+tags.length+4;
 const headline=trimTo(`${date} ${item.title}`,Math.max(48,280-reserved));
 const xText=`${headline}\n\n${url}\n\n${tags}`;
 const lineText=`${item.title}\n${trimTo(item.text||'',150)}`;
 return {slug:item.slug,date:item.date,title:item.title,url,hashtags:tags,xText,lineText,charCount:[...xText].length};
});
const comparable={related,socialPosts};
const old=await readJson('data/news-extras.json',{});
const generatedAt=JSON.stringify({related:old.related||{},socialPosts:old.socialPosts||[]})===JSON.stringify(comparable)?(old.generatedAt||new Date().toISOString()):new Date().toISOString();
const payload={generatedAt,sourceNewsGeneratedAt:newsPayload.generatedAt||null,related,socialPosts};
await mkdir('data',{recursive:true});
await writeFile('data/news-extras.json',`${JSON.stringify(payload,null,2)}\n`,'utf8');
await writeFile('data/news-extras-data.js',`window.RESCENE_NEWS_EXTRAS = ${JSON.stringify(payload,null,2)};\n`,'utf8');
console.log(`ニュース追加データ生成: SNS投稿 ${socialPosts.length}件 / 関連記事 ${Object.values(related).reduce((n,x)=>n+x.length,0)}件`);
