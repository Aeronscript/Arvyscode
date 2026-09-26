(function(){
if(window.__ocBridgeDone)return;window.__ocBridgeDone=1;
var realFetch=window.fetch.bind(window);window.__ocRealFetch=realFetch;
function install(){
 if(window.__ocBridgeInstalled)return;window.__ocBridgeInstalled=1;
 console.log('[oc-bridge] actif : /api/event servi en flux synthétique alimenté par long-polling JSON (contournement passerelle qui bufferise le SSE)');
 window.fetch=function(input,init){
  try{
   var url=typeof input==='string'?input:(input&&input.url)||'';
   var method=((init&&init.method)||(input&&input.method)||'GET').toUpperCase();
   if(method==='GET'&&url.indexOf('/api/event')!==-1&&url.indexOf('__proxy')===-1){
     return synthetic(init);
   }
  }catch(e){}
  return realFetch(input,init);
 };
}
function synthetic(init){
 var enc=new TextEncoder();
 var stopped=false;
 var localCtrl=new AbortController();
 var signal=init&&init.signal;
 if(signal){
  if(signal.aborted)stopped=true;
  else signal.addEventListener('abort',function(){stopped=true;try{localCtrl.abort()}catch(e){}});
 }
 var stream=new ReadableStream({
  start:function(ctrl){
   var hello={id:'evt_shim_'+Date.now().toString(36),type:'server.connected',data:{}};
   ctrl.enqueue(enc.encode('data: '+JSON.stringify(hello)+'\n\n'));
   pump(ctrl);
  },
  cancel:function(){stopped=true;try{localCtrl.abort()}catch(e){}}
 });
 function pump(ctrl){
  var last=-1;
  function loop(){
   if(stopped){try{ctrl.close()}catch(e){}return}
   realFetch('/__proxy/events?since='+last+'&wait=8000',{signal:localCtrl.signal,cache:'no-store'})
    .then(function(r){return r.ok?r.json():{events:[],last:last}})
    .then(function(j){
     if(stopped){try{ctrl.close()}catch(e){}return}
     if(typeof j.last==='number')last=j.last;
     var evs=j.events||[];
     for(var i=0;i<evs.length;i++){
      try{ctrl.enqueue(enc.encode('data: '+JSON.stringify(evs[i])+'\n\n'))}catch(e){stopped=true;break}
     }
     try{ctrl.enqueue(enc.encode(': ka\n\n'))}catch(e){}
     loop();
    })
    .catch(function(){if(!stopped){stopped=true;try{ctrl.close()}catch(e){}}});
  }
  loop();
 }
 return Promise.resolve(new Response(stream,{status:200,headers:{'Content-Type':'text/event-stream','Cache-Control':'no-store','X-Accel-Buffering':'no'}}));
}
install();
})();