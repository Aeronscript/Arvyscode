(function(){
if(window.__ocPtyShimDone)return;window.__ocPtyShimDone=1;
var NativeWS=window.WebSocket;
function isPty(u){try{var x=new URL(u,location.href);return x.pathname.indexOf('/api/pty/')===0&&x.pathname.indexOf('/connect')!==-1}catch(e){return false}}
function b64ToBuf(b){var s=atob(b),n=s.length,a=new Uint8Array(n);for(var i=0;i<n;i++)a[i]=s.charCodeAt(i);return a}
function FakeWS(url){
 var self=this;
 var et=new EventTarget();
 this.url=String(url);this.readyState=0;this.binaryType='arraybuffer';
 this.bufferedAmount=0;this.extensions='';this.protocol='';
 this.onopen=null;this.onmessage=null;this.onerror=null;this.onclose=null;
 var listeners={open:[],message:[],error:[],close:[]};
 this.addEventListener=function(t,f,o){(listeners[t]=listeners[t]||[]).push(f);et.addEventListener(t,f,o)};
 this.removeEventListener=function(t,f,o){et.removeEventListener(t,f,o)};
 this.dispatchEvent=function(ev){try{et.dispatchEvent(ev)}catch(e){}(listeners[ev.type]||[]).forEach(function(f){try{f.call(self,ev)}catch(e){}});var h=self['on'+ev.type];if(h){try{h.call(self,ev)}catch(e){}}return true};
 function fire(type,data){self.dispatchEvent(new MessageEvent(type,{data:data}))}
 var id=null,closed=false,seq=0,sendQueue=Promise.resolve();
 function fail(){if(closed)return;closed=true;self.readyState=3;try{self.dispatchEvent(new CloseEvent('close',{code:1006,wasClean:false}))}catch(e){}}
 fetch('/__ptybridge/open',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:self.url}),cache:'no-store'})
 .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j}})})
 .then(function(r){
  if(closed)return;
  if(!r.ok||!r.j.id){fail();return}
  id=r.j.id;self.readyState=1;
  try{self.dispatchEvent(new Event('open'))}catch(e){}
  pump();
 })
 .catch(fail);
 function pump(){
  if(closed)return;
  fetch('/__ptybridge/'+id+'/recv?since='+seq+'&wait=15000',{cache:'no-store'})
  .then(function(r){return r.json()})
  .then(function(j){
   if(closed)return;
   seq=j.last||seq;
   var fr=j.frames||[];
   for(var i=0;i<fr.length;i++){
    var f=fr[i];
    if(f.op===8){closed=true;self.readyState=3;try{self.dispatchEvent(new CloseEvent('close',{code:1000,wasClean:true}))}catch(e){}return}
    var buf=b64ToBuf(f.d);
    if(f.op===1)fire('message',Buffer2Str(buf));
    else fire('message',buf.buffer);
   }
   pump();
  })
  .catch(function(){fail()});
 }
 function Buffer2Str(a){var s='';try{s=new TextDecoder('utf-8',{fatal:false}).decode(a)}catch(e){for(var i=0;i<a.length;i++)s+=String.fromCharCode(a[i])}return s}
 this.send=function(data){
  if(closed){throw new Error('WebSocket is closed')}
  var body,ct;
  if(typeof data==='string'){body=data;ct='text/plain;charset=UTF-8'}
  else{
   var u8=data instanceof ArrayBuffer?new Uint8Array(data):(data&&data.buffer?new Uint8Array(data.buffer,data.byteOffset||0,data.byteLength):new Uint8Array(data));
   body=u8;ct='application/octet-stream';
  }
  sendQueue=sendQueue.then(function(){
   return fetch('/__ptybridge/'+id+'/send',{method:'POST',headers:{'content-type':ct},body:body,cache:'no-store'}).catch(function(){});
  });
 };
 this.close=function(code){
  if(closed)return;closed=true;self.readyState=2;
  fetch('/__ptybridge/'+id+'/close',{method:'POST',cache:'no-store'}).catch(function(){});
  setTimeout(function(){self.readyState=3;try{self.dispatchEvent(new CloseEvent('close',{code:code||1000,wasClean:true}))}catch(e){}},30);
 };
}
Object.setPrototypeOf(FakeWS.prototype,NativeWS.prototype);
FakeWS.CONNECTING=0;FakeWS.OPEN=1;FakeWS.CLOSING=2;FakeWS.CLOSED=3;
window.WebSocket=function(u,p){return isPty(u)?new FakeWS(u):new NativeWS(u,p)};
window.WebSocket.prototype=NativeWS.prototype;
window.WebSocket.CONNECTING=0;window.WebSocket.OPEN=1;window.WebSocket.CLOSING=2;window.WebSocket.CLOSED=3;
console.log('[oc-pty] pont terminal actif : WebSocket PTY relayé en long-polling (passerelle bufferisante)');
})();