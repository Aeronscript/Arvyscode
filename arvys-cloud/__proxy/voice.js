(function(){
if(window.__ocVoiceDone)return;window.__ocVoiceDone=1;
// v4 — corrige : (1) SR navigateur auto-arrete apres chaque pause -> auto-relance
// (2) texte en direct efface -> texte cumule + TextNode rattache
// (3) anneau perdue au re-render React -> style ciblant l'ATTRIBUT, jamais une classe
var wantOn=false;           // UNIQUE etat de verite : dictee demandee ON/OFF
var rec=null;               // instance SpeechRecognition courante
var srWatchdog=null;        // watchdog demarrage muet 3,5 s
var srTimer=null;           // timer d'auto-relance
var finalText='';           // texte FINAL cumule (survit aux relances SR)
var voiceNode=null;         // TextNode dedie dans le composer
var lastErr='';             // derniere erreur SR de la session courante
var fbRec=false,fbBusy=false;
var fbCtx=null,fbProc=null,fbSrc=null,fbStream=null,fbChunks=[],fbMax=null;

// Keyframes une seule fois + style d'etat : le selecteur cible l'attribut
// data-action, donc il survit au remplacement de l'element par React.
var ringStyle=null;
(function(){
 var s=document.createElement('style');
 s.textContent='@keyframes __ocRing{0%{box-shadow:0 0 0 0 rgba(255,77,79,.55)}70%{box-shadow:0 0 0 9px rgba(255,77,79,0)}100%{box-shadow:0 0 0 0 rgba(255,77,79,0)}}';
 document.head.appendChild(s);
 ringStyle=document.createElement('style');
 ringStyle.id='__ocRingOn';
 document.head.appendChild(ringStyle);
})();
function ringOn(color){
 if(ringStyle)ringStyle.textContent='[data-action="composer-voice"]{animation:__ocRing 1.3s ease-out infinite !important;color:'+color+' !important}';
}
function ringOff(){if(ringStyle)ringStyle.textContent='';}

// Toast : si ms absent -> persiste 14 s (messages d'action importants)
function toast(msg,ms){
 try{
  var t=document.getElementById('__oc_toast');
  if(t)t.remove();
  t=document.createElement('div');
  t.id='__oc_toast';
  t.style.cssText='position:fixed;left:50%;bottom:88px;transform:translateX(-50%);z-index:2147483647;background:#1f2328;color:#fff;padding:10px 16px;border-radius:10px;font:13px/1.4 system-ui;box-shadow:0 6px 24px rgba(0,0,0,.25);max-width:88vw;text-align:center';
  t.textContent=msg;
  document.body.appendChild(t);
  var m=ms||14000;
  setTimeout(function(){try{var e=document.getElementById('__oc_toast');if(e&&e.textContent===msg)e.remove()}catch(e){}},m);
 }catch(e){}
}
function findEditor(){return document.querySelector('[data-component="composer-editor"][contenteditable="true"]')}
function findBtn(){return document.querySelector('[data-action="composer-voice"]')}
function editorTextExcluding(exclude){
 var ed=findEditor();if(!ed)return '';
 var out='';
 ed.childNodes.forEach(function(n){if(n!==exclude)out+=(n.textContent||'')});
 return out.replace(/\u200B/g,'');
}
function dispatchEditorInput(){
 var ed=findEditor();if(!ed)return;
 ed.dispatchEvent(new InputEvent('input',{bubbles:true}));
 var sel=window.getSelection();
 if(sel){var r=document.createRange();r.selectNodeContents(ed);r.collapse(false);sel.removeAllRanges();sel.addRange(r)}
}
// TextNode dedie : s'il a ete debranche par un re-render React, on le recree
function ensureVoiceNode(){
 var ed=findEditor();if(!ed)return null;
 if(!voiceNode||!voiceNode.isConnected){voiceNode=document.createTextNode('');ed.appendChild(voiceNode)}
 return voiceNode;
}
// Affiche le texte cumule + interim dans le TextNode dedie
function showSpoken(interim){
 var spoken=((finalText||'')+(interim||'')).replace(/\s+/g,' ').trim();
 if(!spoken)return;
 var node=ensureVoiceNode();
 if(!node)return;
 var base=editorTextExcluding(node).trim();
 node.textContent=(base?' ':'')+spoken;
 dispatchEditorInput();
}
// Permission micro connue du navigateur : denied -> on previent AVANT d'essayer
function micDenied(cb){
 try{
  if(!navigator.permissions||!navigator.permissions.query){cb(false);return}
  navigator.permissions.query({name:'microphone'}).then(function(p){cb(p.state==='denied')},function(){cb(false)});
 }catch(e){cb(false)}
}

// Tue l'instance SR courante + timers, detache les handlers.
// NE TOUCHE PAS a finalText ni voiceNode (le texte dicte est preserve).
function srKill(){
 if(srWatchdog){clearTimeout(srWatchdog);srWatchdog=null}
 if(srTimer){clearTimeout(srTimer);srTimer=null}
 if(rec){
  var rr=rec;rec=null;
  try{rr.onresult=null;rr.onerror=null;rr.onend=null;rr.onstart=null}catch(e){}
  try{rr.stop()}catch(e){}
  try{rr.abort()}catch(e){}
 }
}

// --- PRIMAIRE : dictee navigateur (Web Speech API), fr-FR FORCE, texte en direct ---
function startSR(){
 var S=window.SpeechRecognition||window.webkitSpeechRecognition;
 var ed=findEditor();
 if(!S||!ed){startFallback();return}
 var r;
 try{r=new S()}catch(e){startFallback();return}
 rec=r;
 r.lang='fr-FR';
 r.continuous=true;
 r.interimResults=true;
 r.maxAlternatives=1;
 var gotAny=false;
 var rescued=false;
 lastErr='';
 // Watchdog : session demarree mais muette (rien entendu, rien cumule) 3,5 s
 srWatchdog=setTimeout(function(){
  srWatchdog=null;
  if(!wantOn||rec!==r)return;
  if(!gotAny&&!finalText){try{r.stop()}catch(e){}}
 },3500);
 r.onresult=function(ev){
  gotAny=true;
  if(srWatchdog){clearTimeout(srWatchdog);srWatchdog=null}
  var interim='';
  for(var i=ev.resultIndex;i<ev.results.length;i++){
   var res=ev.results[i];
   var chunk=(res&&res[0]&&res[0].transcript)||'';
   if(res.isFinal)finalText+=chunk;else interim+=chunk;
  }
  showSpoken(interim);
 };
 r.onerror=function(ev){lastErr=(ev&&ev.error)||''};
 r.onend=function(){
  if(!wantOn)return;               // arret demande -> stopAll a deja nettoye
  if(gotAny||finalText){
   // Le SR navigateur s'auto-arrete apres chaque pause -> on le relance :
   // la dictee continue tant que wantOn est vrai.
   srKill();
   srTimer=setTimeout(function(){srTimer=null;if(wantOn)startSR()},250);
   return;
  }
  if(rescued)return;
  rescued=true;
  srKill();
  analyze();
 };
 try{r.start()}catch(e){srKill();analyze()}
}
// Diagnostic fin de session muette : permission -> cadenas ; sinon repli serveur
function analyze(){
 if(!wantOn)return;
 if(lastErr==='not-allowed'||lastErr==='service-not-allowed'||lastErr==='permission-denied'){
  wantOn=false;ringOff();
  if(/android/i.test(navigator.userAgent)){
   toast('Micro refusé par Android. Cause fréquente : une appli « superposée » (filtre lumineux, bulles…) bloque la demande. Réglages → Applications spéciales → Affichage par-dessus → désactivez ces applis, rechargez la page, puis autorisez le micro (cadenas dans la barre d adresse)');
  } else {
   toast('Micro non autorisé : clique le cadenas dans la barre d adresse → Autoriser le micro, puis reclique sur le micro');
  }
  return;
 }
 // Reseau bloque ou demarrage muet -> repli serveur, annonce clairement
 toast('Dictée directe indisponible → mode serveur : parlez, puis recliquez sur le micro pour arrêter',6000);
 startFallback();
}

// Arret IMMEDIAT : anneau eteint au clic, SR tue, texte dicte conserve
function stopAll(){
 wantOn=false;
 srKill();
 voiceNode=null;
 if(fbRec){ringOn('#e8a33d');fbStop()}
 else ringOff();
}

// --- REPLI : enregistrement micro -> WAV -> ASR serveur -> insertion ---
function fbCleanup(){
 try{if(fbProc)fbProc.disconnect()}catch(e){}
 try{if(fbSrc)fbSrc.disconnect()}catch(e){}
 try{if(fbCtx)fbCtx.close()}catch(e){}
 try{if(fbStream)fbStream.getTracks().forEach(function(t){t.stop()})}catch(e){}
 fbProc=fbSrc=fbCtx=fbStream=null;
 if(fbMax){clearTimeout(fbMax);fbMax=null}
}
function encodeWAV(samples,rate){
 var n=samples.length,buf=new ArrayBuffer(44+n*2),v=new DataView(buf);
 function w(o,s){for(var i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i))}
 w(0,'RIFF');v.setUint32(4,36+n*2,true);w(8,'WAVE');w(12,'fmt ');
 v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
 v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);
 w(36,'data');v.setUint32(40,n*2,true);
 for(var i=0;i<n;i++){var s=Math.max(-1,Math.min(1,samples[i]));v.setInt16(44+i*2,s<0?s*32768:s*32767,true)}
 return new Blob([buf],{type:'audio/wav'});
}
function blobB64(b){
 return new Promise(function(res,rej){
  var r=new FileReader();
  r.onload=function(){res(String(r.result).split(',')[1]||'')};
  r.onerror=function(){rej(new Error('lecture audio impossible'))};
  r.readAsDataURL(b);
 });
}
function insertText(txt){
 var ed=findEditor();
 if(!ed){toast('Composer introuvable — texte : '+txt);return}
 ed.focus();
 var ok=false;
 try{ok=document.execCommand('insertText',false,txt)}catch(e){}
 if(!ok){
  try{
   var n=document.createTextNode(txt);ed.appendChild(n);
   var sel=window.getSelection();if(sel){var r=document.createRange();r.selectNodeContents(ed);r.collapse(false);sel.removeAllRanges();sel.addRange(r)}
   ed.dispatchEvent(new InputEvent('input',{bubbles:true}));
  }catch(e){}
 }
}
function startFallback(){
 if(fbRec||fbBusy)return;
 if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){wantOn=false;ringOff();toast('Micro non disponible dans ce navigateur');return}
 navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}}).then(function(s){
  if(!wantOn){try{s.getTracks().forEach(function(t){t.stop()})}catch(e){}return}
  fbStream=s;
  try{fbCtx=new (window.AudioContext||window.webkitAudioContext)({sampleRate:16000})}catch(e){fbCtx=new (window.AudioContext||window.webkitAudioContext)()}
  fbSrc=fbCtx.createMediaStreamSource(s);
  fbProc=fbCtx.createScriptProcessor(4096,1,1);
  fbChunks=[];
  fbProc.onaudioprocess=function(ev){
   if(!fbRec)return;
   var inp=ev.inputBuffer.getChannelData(0);
   var out=new Float32Array(inp.length);
   for(var i=0;i<inp.length;i++)out[i]=inp[i];
   fbChunks.push(out);
  };
  fbSrc.connect(fbProc);fbProc.connect(fbCtx.destination);
  fbRec=true;
  ringOn('#ff4d4f');
  toast('J\'écoute… recliquez sur le micro pour arrêter',5000);
  fbMax=setTimeout(function(){if(fbRec)stopAll()},120000);
 }).catch(function(e){
  wantOn=false;ringOff();
  if(e&&e.name==='NotAllowedError'){
   if(/android/i.test(navigator.userAgent)){
    toast('Micro refusé par Android. Cause fréquente : une appli « superposée » (filtre lumineux, bulles…) bloque la demande. Réglages → Applications spéciales → Affichage par-dessus → désactivez ces applis, rechargez la page, puis autorisez le micro (cadenas)');
   } else if(/iPad|iPhone|iPod/.test(navigator.userAgent)){
    toast('Micro refusé : Réglages iOS → Safari (ou navigateur) → Micro → Autoriser, puis rechargez la page');
   } else {
    toast('Micro non autorisé : clique le cadenas dans la barre d adresse → Autoriser le micro, puis reclique sur le micro');
   }
  }
  else if(e&&e.name==='NotFoundError')toast('Aucun micro détecté sur cet appareil');
  else toast('Micro indisponible : '+((e&&e.message)||e));
 });
}
function fbStop(){
 if(!fbRec)return;
 fbRec=false;fbBusy=true;
 ringOn('#e8a33d');
 var rate=fbCtx.sampleRate||16000;
 var total=0;for(var i=0;i<fbChunks.length;i++)total+=fbChunks[i].length;
 var all=new Float32Array(total),off=0;
 for(var j=0;j<fbChunks.length;j++){all.set(fbChunks[j],off);off+=fbChunks[j].length}
 fbCleanup();
 if(total<rate*0.4){fbBusy=false;wantOn=false;ringOff();toast('Enregistrement trop court — parlez puis recliquez sur le micro');return}
 var wav=encodeWAV(all,rate);
 blobB64(wav).then(function(b64){
  return fetch('/__proxy/asr',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({audio:b64})}).then(function(r){
   return r.json().then(function(j){if(!r.ok)throw new Error(j.error||('HTTP '+r.status));return j});
  });
 }).then(function(j){
  fbBusy=false;wantOn=false;ringOff();
  var txt=String(j.text||'').trim();
  if(!txt){toast('Aucune parole détectée — réessayez un peu plus près du micro');return}
  insertText(txt);
 }).catch(function(e){
  fbBusy=false;wantOn=false;ringOff();
  toast('Transcription impossible : '+((e&&e.message)||e));
 });
}
function toggle(){
 if(wantOn){stopAll();return}
 if(fbBusy){toast('Transcription en cours… une seconde');return}
 micDenied(function(denied){
  if(denied){
   if(/android/i.test(navigator.userAgent)){
    toast('Micro bloqué pour ce site : cadenas dans la barre d adresse → Micro → Autoriser. Si la demande n apparaît pas, une appli « superposée » la bloque (Réglages → Applications spéciales → Affichage par-dessus)');
   } else {
    toast('Micro bloqué pour ce site : clique le cadenas dans la barre d adresse → Micro → Autoriser, puis reclique sur le micro');
   }
   return;
  }
  wantOn=true;
  finalText='';
  voiceNode=null;
  ringOn('#ff4d4f');
  startSR();
 });
}
// Le pointerdown ne doit PAS declencher le focus/blur du composer natif
document.addEventListener('pointerdown',function(e){
 var b=e.target&&e.target.closest?e.target.closest('[data-action="composer-voice"]'):null;
 if(!b)return;
 e.stopPropagation();
},true);
// Le clic est intercepte EN CAPTURE : le handler natif ne demarre jamais
document.addEventListener('click',function(e){
 var b=e.target&&e.target.closest?e.target.closest('[data-action="composer-voice"]'):null;
 if(!b)return;
 e.preventDefault();e.stopPropagation();
 toggle();
},true);
// Sonde d'etat pour le diagnostic
window.__ocVoiceState=function(){
 return {wantOn:wantOn,rec:!!rec,fbRec:fbRec,fbBusy:fbBusy,finalText:finalText,ring:ringStyle?ringStyle.textContent:''};
};
console.log('[oc-voice] v4 — dictee fr-FR continue (auto-relance), texte cumule, anneau immune au re-render, repli serveur annonce');
})();