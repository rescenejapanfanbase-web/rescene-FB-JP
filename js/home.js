
(()=>{const el=document.getElementById('newsGrid');if(!el||!window.RESCENE_NEWS)return;el.innerHTML=RESCENE_NEWS.slice(0,4).map(n=>`<article class="news-card"><div class="news-meta"><span class="news-date">${n.date}</span><span class="badge">${n.label}</span></div><div class="news-title"><a href="${n.link}">${n.title}</a></div><div class="news-text">${n.text}</div></article>`).join('')})();
