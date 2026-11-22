/* Prices in US$ for clients abroad and in PH ₱ for clients in the Philippines.
   Picks pesos when the visitor's device time zone is Asia/Manila (no server call, no Netlify credits).
   Visitors can switch with the "Prices in" toggle; their choice is remembered on their device.
   Elements with data-php="..." show that text in peso mode. */
(function(){
var K='jb-cur';
var css='.curwrap{display:inline-flex;align-items:center;gap:10px;font-size:14px;color:#6E625A;flex-wrap:wrap;justify-content:center}.curtoggle{display:inline-flex;border:1px solid #C9BAAB;border-radius:99px;overflow:hidden;background:#fff}.curtoggle button{border:0;background:none;font:inherit;font-size:13px;letter-spacing:.04em;padding:8px 16px;min-height:40px;cursor:pointer;color:#231E1B}.curtoggle button[aria-pressed=true]{background:#7A4E3A;color:#fff}.curtoggle button:focus-visible{outline:2px solid #7A4E3A;outline-offset:2px}';
try{var st=document.createElement('style');st.textContent=css;document.head.appendChild(st)}catch(e){}
function detect(){
 try{var v=localStorage.getItem(K);if(v==='USD'||v==='PHP')return v}catch(e){}
 try{var tz=Intl.DateTimeFormat().resolvedOptions().timeZone||'';if(tz==='Asia/Manila')return 'PHP'}catch(e){}
 return 'USD';
}
function apply(c){
 var els=document.querySelectorAll('[data-php]');
 for(var i=0;i<els.length;i++){var el=els[i];if(!el.hasAttribute('data-usd'))el.setAttribute('data-usd',el.innerHTML);el.innerHTML=c==='PHP'?el.getAttribute('data-php'):el.getAttribute('data-usd')}
 var ins=document.querySelectorAll('input[data-php-value]');
 for(var j=0;j<ins.length;j++){var x=ins[j];if(!x.hasAttribute('data-usd-value'))x.setAttribute('data-usd-value',x.value);x.value=c==='PHP'?x.getAttribute('data-php-value'):x.getAttribute('data-usd-value')}
 var bs=document.querySelectorAll('.curtoggle button');
 for(var k=0;k<bs.length;k++)bs[k].setAttribute('aria-pressed',String(bs[k].getAttribute('data-cur')===c));
 document.documentElement.setAttribute('data-cur',c);window.JB_CUR=c;
 try{document.dispatchEvent(new CustomEvent('currencychange',{detail:c}))}catch(e){}
}
document.addEventListener('click',function(e){var b=e.target&&e.target.closest?e.target.closest('.curtoggle button'):null;if(!b)return;var c=b.getAttribute('data-cur');try{localStorage.setItem(K,c)}catch(x){}apply(c)});
function init(){apply(detect())}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
