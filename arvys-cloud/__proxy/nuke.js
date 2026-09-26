(function(){try{if(window.__ocNuke)return;window.__ocNuke=1;
if(window.caches&&caches.keys){caches.keys().then(function(k){k.forEach(function(x){caches.delete(x)})}).catch(function(){})}
if(navigator.serviceWorker&&navigator.serviceWorker.getRegistrations){navigator.serviceWorker.getRegistrations().then(function(r){r.forEach(function(x){x.unregister()})}).catch(function(){})}
}catch(e){}})();