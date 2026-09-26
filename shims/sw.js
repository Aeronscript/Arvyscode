/* Arvys Code - neutralisation du service worker Workbox */
var MARKER_DB='__ocSWctl',STORE='k';
function dbOpen(){
  return new Promise(function(res,rej){
    var r=indexedDB.open(MARKER_DB,1);
    r.onupgradeneeded=function(){try{r.result.createObjectStore(STORE)}catch(e){}};
    r.onsuccess=function(){res(r.result)};
    r.onerror=function(){rej(r.error||new Error('idb'))};
    setTimeout(function(){rej(new Error('idb timeout'))},1500);
  });
}
function markerGet(){
  return dbOpen().then(function(db){return new Promise(function(res){
    var tx=db.transaction(STORE,'readonly');var q=tx.objectStore(STORE).get('done');
    q.onsuccess=function(){res(!!q.result)};q.onerror=function(){res(false)};
  })}).catch(function(){return false});
}
function markerSet(){
  return dbOpen().then(function(db){return new Promise(function(res){
    var tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(1,'done');
    tx.oncomplete=function(){res()};tx.onerror=function(){res()};
  })}).catch(function(){});
}
self.addEventListener('install',function(e){self.skipWaiting()});
self.addEventListener('activate',function(e){e.waitUntil(
  caches.keys().catch(function(){return []}).then(function(keys){
    return Promise.all(keys.map(function(k){return caches.delete(k).catch(function(){})}));
  }).then(function(){return self.clients.claim()}).catch(function(){})
    .then(markerGet).then(function(done){
      var unreg=function(){try{return self.registration.unregister()}catch(e){return Promise.resolve(false)}};
      if(done)return unreg();
      return markerSet().then(function(){
        return self.clients.matchAll({type:'window',includeUncontrolled:true}).catch(function(){return []});
      }).then(function(cs){
        (cs||[]).forEach(function(c){try{c.navigate(c.url)}catch(e){}});
      }).then(unreg);
    }).catch(function(){})
)});
self.addEventListener('fetch',function(){});