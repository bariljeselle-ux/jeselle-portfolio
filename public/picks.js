/* "Add to my request": visitors pick packages on the Rates section; the project brief shows them and pre-ticks the services.
   Picks are saved in the visitor's own browser (localStorage), nothing is sent until they submit the brief. */
(function(){
var K='jb-picks';
function load(){try{var v=JSON.parse(localStorage.getItem(K)||'[]');return Array.isArray(v)?v:[]}catch(e){return []}}
function save(a){try{localStorage.setItem(K,JSON.stringify(a))}catch(e){}}
function cur(){return window.JB_CUR==='PHP'||document.documentElement.getAttribute('data-cur')==='PHP'?'PHP':'USD'}
function fmt(n,c){return (c==='PHP'?'₱':'$')+Math.round(n).toLocaleString('en-US')}
function totals(a,c){var o={lo:0,hi:0,mlo:0,mhi:0};a.forEach(function(p){if(p.note)return;var lo=c==='PHP'?p.plo:p.ulo,hi=c==='PHP'?p.phi:p.uhi;if(p.m){o.mlo+=lo;o.mhi+=hi}else{o.lo+=lo;o.hi+=hi}});return o}
function rng(lo,hi,c){return lo===hi?fmt(lo,c):fmt(lo,c)+'–'+fmt(hi,c)}
function summary(a,c){var t=totals(a,c),s=[];if(t.hi)s.push(rng(t.lo,t.hi,c));if(t.mhi)s.push(rng(t.mlo,t.mhi,c)+'/month');var q=a.some(function(p){return p.note||(!p.ulo&&!p.uhi)});return (s.join(' + ')||'to be quoted')+(q&&s.length?' + items to be quoted':'')}
function line(p,c){var lo=c==='PHP'?p.plo:p.ulo,hi=c==='PHP'?p.phi:p.uhi;var pr=p.note?p.note:(!lo&&!hi?'price in your quote':rng(lo,hi,c)+(p.unit||'')+(p.m?'/month':''));return p.svc+(p.tier?' – '+p.tier:'')+': '+pr}
window.JBPicks={load:load,save:save,summary:summary,line:line,fmt:fmt};
var esc=function(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})};

/* ---------- Homepage: Add buttons + floating picks bar ---------- */
function initHome(){
 var btns=document.querySelectorAll('[data-pick]');if(!btns.length)return;
 var css='.pickmini{flex:none;min-height:32px;padding:0 12px;border:1px solid #C9BAAB;background:#fff;color:#7A4E3A;border-radius:99px;font:500 12px Jost,system-ui,sans-serif;letter-spacing:.06em;cursor:pointer;white-space:nowrap;transition:background .2s,color .2s}.pickmini:hover{border-color:#7A4E3A}.pickmini[aria-pressed=true]{background:#7A4E3A;border-color:#7A4E3A;color:#fff}.pickmini:focus-visible{outline:2px solid #7A4E3A;outline-offset:2px}td.pk{width:1%;padding-left:10px!important;text-align:right}.svcpick{margin-top:auto;align-self:flex-start;width:auto;padding:0 18px}.pickbtn{margin-top:10px;width:100%;min-height:40px;border:1px solid #7A4E3A;background:#fff;color:#7A4E3A;font:500 12px Jost,system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;border-radius:3px;cursor:pointer;transition:background .2s,color .2s}.pickbtn:hover{background:#F7EDE6}.pickbtn[aria-pressed=true]{background:#7A4E3A;color:#fff}.pickbtn:focus-visible{outline:2px solid #7A4E3A;outline-offset:2px}.pkgpick{margin-top:4px;width:auto;align-self:flex-start;background:none;color:#F7F3EE;border-color:#BDB2A8;padding:0 18px}.pkgpick[aria-pressed=true]{background:#F7F3EE;color:#231E1B}'
 +'.pickbar{position:fixed;right:24px;bottom:24px;z-index:60;width:min(360px,calc(100vw - 32px));background:#231E1B;color:#F7F3EE;border-radius:14px;box-shadow:0 18px 40px -14px rgba(0,0,0,.6);font:15px/1.5 Jost,system-ui,sans-serif;transform:translateY(16px);opacity:0;pointer-events:none;transition:opacity .3s,transform .3s}.pickbar.on{opacity:1;transform:none;pointer-events:auto}.pickbar .ph{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px;cursor:pointer;min-height:52px;background:none;border:0;color:inherit;font:inherit;width:100%;text-align:left}.pickbar .ph b{font-weight:500}.pickbar .ph small{display:block;color:#D9B8A6;font-size:13px}.pickbar .pl2{display:none;padding:0 16px 14px;border-top:1px solid #4A413B}.pickbar.open .pl2{display:block}.pickbar ul{list-style:none;margin:10px 0;padding:0;max-height:40vh;overflow:auto}.pickbar li{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px dashed #4A413B;font-size:14px}.pickbar li button{background:none;border:0;color:#BDB2A8;font-size:18px;cursor:pointer;min-width:32px;min-height:32px}.pickbar .go{display:flex;align-items:center;justify-content:center;min-height:46px;background:#7A4E3A;color:#fff;text-decoration:none;border-radius:4px;font-size:13px;font-weight:500;letter-spacing:.12em;text-transform:uppercase}.pickbar .clr{background:none;border:0;color:#BDB2A8;font:inherit;font-size:13px;text-decoration:underline;cursor:pointer;margin-top:8px;min-height:32px}.pickbar .chev{transition:transform .2s}.pickbar.open .chev{transform:rotate(180deg)}'
 +'@media(max-width:760px){.pickbar{left:16px;right:16px;width:auto;bottom:78px}}@media(prefers-reduced-motion:reduce){.pickbar{transition:none}}';
 var st=document.createElement('style');st.textContent=css;document.head.appendChild(st);
 var bar=document.createElement('div');bar.className='pickbar';bar.setAttribute('aria-live','polite');
 bar.innerHTML='<button type="button" class="ph" aria-expanded="false"><span><b class="pc"></b><small class="pt"></small></span><span class="chev" aria-hidden="true">⌃</span></button><div class="pl2"><ul></ul><a class="go" href="brief.html">Continue to project brief →</a><button type="button" class="clr">Clear all</button></div>';
 document.body.appendChild(bar);
 function draw(){var a=load(),c=cur();btns.forEach(function(b){var on=a.some(function(p){return p.id===b.getAttribute('data-pick')});b.setAttribute('aria-pressed',String(on));b.textContent=on?(b.classList.contains('pickmini')?'✓ Added':'Added ✓'):(b.getAttribute('data-label')||(b.classList.contains('pickmini')?'+ Add':'Add to my request'))});
  bar.classList.toggle('on',a.length>0);if(!a.length)bar.classList.remove('open');
  bar.querySelector('.pc').textContent=a.length+' service'+(a.length===1?'':'s')+' picked';
  bar.querySelector('.pt').textContent='Estimate: '+summary(a,c);
  bar.querySelector('ul').innerHTML=a.map(function(p){return '<li><span>'+esc(line(p,c))+'</span><button type="button" data-rm="'+esc(p.id)+'" aria-label="Remove '+esc(p.svc)+'">×</button></li>'}).join('')}
 document.addEventListener('click',function(e){
  var b=e.target.closest&&e.target.closest('[data-pick]');
  if(b){e.preventDefault();e.stopPropagation();var a=load(),id=b.getAttribute('data-pick'),i=-1;a.forEach(function(p,k){if(p.id===id)i=k});
   if(i>=0)a.splice(i,1);else{var svc=b.getAttribute('data-svc');if(b.getAttribute('data-tier'))a=a.filter(function(p){return !(p.svc===svc&&p.tier)});
    a.push({id:id,svc:svc,note:b.getAttribute('data-note')||'',unit:b.getAttribute('data-unit')||'',tier:b.getAttribute('data-tier')||'',brief:b.getAttribute('data-brief'),m:b.getAttribute('data-m')==='1',ulo:+b.getAttribute('data-ulo'),uhi:+b.getAttribute('data-uhi'),plo:+b.getAttribute('data-plo'),phi:+b.getAttribute('data-phi')})}
   save(a);draw();return}
  var rm=e.target.closest&&e.target.closest('.pickbar [data-rm]');if(rm){var id2=rm.getAttribute('data-rm');save(load().filter(function(p){return p.id!==id2}));draw();return}
  if(e.target.closest&&e.target.closest('.pickbar .clr')){save([]);draw();return}
  if(e.target.closest&&e.target.closest('.pickbar .ph')){bar.classList.toggle('open');bar.querySelector('.ph').setAttribute('aria-expanded',String(bar.classList.contains('open')))}
 },true);
 document.addEventListener('currencychange',draw);addEventListener('storage',draw);draw();
}

/* ---------- Project brief: show picks (remove / confirm), pre-tick services, fill hidden fields ---------- */
function initBrief(){
 var form=document.getElementById('brief');if(!form||!form.elements.selected_packages)return;
 var OK='jb-picks-ok';
 var sig=function(a){return a.map(function(p){return p.id}).join('|')};
 var isOk=function(a){try{return a.length&&localStorage.getItem(OK)===sig(a)}catch(e){return false}};
 var setOk=function(a,v){try{v?localStorage.setItem(OK,sig(a)):localStorage.removeItem(OK)}catch(e){}};
 var st=document.createElement('style');st.textContent='.mypicks li{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:3px 0}.mypicks li button{flex:none;border:0;background:none;color:#8A7E75;font-size:18px;line-height:1;cursor:pointer;min-width:32px;min-height:28px}.mypicks li button:hover{color:#8A2E1E}.mypicks ul{list-style:disc}.mpbtns{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-top:10px}.mpok{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 20px;border:0;border-radius:3px;background:#2F6B3F;color:#fff;font:500 13px Jost,system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;cursor:pointer}.mpok:focus-visible{outline:2px solid #2F6B3F;outline-offset:2px}.mpdone{display:inline-flex;align-items:center;gap:6px;color:#2F6B3F;font-weight:500}.mypicks.need{animation:mpflash 1s 2;border-left-color:#B3402A}@keyframes mpflash{50%{box-shadow:0 0 0 4px rgba(179,64,42,.25)}}.mpwarn{color:#B3402A;font-size:14px;margin:8px 0 0}@media(prefers-reduced-motion:reduce){.mypicks.need{animation:none}}';document.head.appendChild(st);
 function fill(){var a=load(),c=cur(),ok=isOk(a);
  form.elements.selected_packages.value=a.map(function(p){return line(p,c)}).join('\n');
  form.elements.estimated_total.value=a.length?summary(a,c):'';
  if(form.elements.picks_confirmed)form.elements.picks_confirmed.value=a.length?(ok?'Yes, client confirmed '+a.length+' item'+(a.length>1?'s':''):'Not confirmed'):'';
  var box=document.getElementById('mypicks');
  if(box){box.hidden=!a.length;box.classList.remove('need');box.innerHTML=a.length?'<p class="mph">Your picked services</p><ul>'+a.map(function(p){return '<li><span>'+esc(line(p,c))+'</span>'+(ok?'':'<button type="button" data-rm="'+esc(p.id)+'" aria-label="Remove '+esc(p.svc)+'">×</button>')+'</li>'}).join('')+'</ul><p class="mpt">Estimate: <b>'+esc(summary(a,c))+'</b></p>'
   +'<div class="mpbtns">'+(ok?'<span class="mpdone">✓ Confirmed</span><a href="#" data-edit="1">Edit picks</a>':'<button type="button" class="mpok">✓ Confirm my picks</button><a href="/#rates">Add more</a>')+'</div>'
   +'<p class="mpn">'+(ok?'Thank you! I\'ll go through these with you on our call. The final price is in your written quote.':'Remove anything you don\'t need with ×, then confirm. The final price is in your written quote.')+'</p>':''}
  var svc=document.getElementById('mypicks2');if(svc){svc.hidden=!a.length;svc.innerHTML=a.length?'Already ticked from your picks: '+esc(a.map(function(p){return p.svc}).join(', '))+'. Add more if you need them.':''}}
 var a=load();
 a.forEach(function(p){(p.brief||'').split('|').forEach(function(v){if(!v)return;var i=form.querySelector('input[name=service][value="'+v.replace(/"/g,'')+'"]');if(i&&!i.checked){i.checked=true;try{i.dispatchEvent(new Event('change',{bubbles:true}))}catch(e){}}})});
 fill();document.addEventListener('currencychange',fill);
 document.addEventListener('click',function(e){var t=e.target;if(!t.closest)return;var box=t.closest('#mypicks');
  if(box){var rm=t.closest('[data-rm]');if(rm){var id=rm.getAttribute('data-rm');var b=load().filter(function(p){return p.id!==id});save(b);setOk(b,false);fill();return}
   if(t.closest('.mpok')){setOk(load(),true);fill();return}
   if(t.closest('[data-edit]')){e.preventDefault();setOk(load(),false);fill();return}}
  // Start brief: picks must be confirmed first
  if(t.closest('#start')){var cur2=load();if(cur2.length&&!isOk(cur2)){e.preventDefault();e.stopImmediatePropagation();var bx=document.getElementById('mypicks');bx.classList.add('need');if(!bx.querySelector('.mpwarn')){var w=document.createElement('p');w.className='mpwarn';w.textContent='Please confirm your picks (or remove what you don\'t need) before starting.';bx.appendChild(w)}bx.scrollIntoView({behavior:'smooth',block:'center'})}}
 },true);
 document.addEventListener('jb-brief-sent',function(){save([]);setOk([],false)});
}
function init(){initHome();initBrief()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
