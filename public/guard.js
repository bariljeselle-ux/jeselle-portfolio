// Spam guard: counts seconds since the page opened, so forms sent instantly by bots are set aside
(function(){var t0=Date.now();function u(){var s=String(Math.round((Date.now()-t0)/1000));document.querySelectorAll('input[name="_el"]').forEach(function(i){i.value=s})}setInterval(u,1000);document.addEventListener('submit',u,true)})();
