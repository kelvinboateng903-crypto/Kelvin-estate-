// Kelvin Estates multiplayer server. No dependencies: just run  node server.js
// Serves the game (index.html) AND live multiplayer, unique usernames and private messages.
const http=require('http'),crypto=require('crypto'),fs=require('fs'),path=require('path');
const PORT=process.env.PORT||3000, PAGE=path.join(__dirname,'index.html');
const DB=path.join(process.env.DATA_DIR||__dirname,'users.json');
// ---- registered usernames: lowercase name -> {name, token, inbox[]} ----
let USERS={};try{USERS=JSON.parse(fs.readFileSync(DB,'utf8'))}catch(e){}
let dirty=false;const saveSoon=()=>{dirty=true};
setInterval(()=>{if(!dirty)return;dirty=false;fs.writeFile(DB,JSON.stringify(USERS),()=>{});},5000);
const NAME=/^[A-Za-z0-9_.-]{3,14}$/;
const server=http.createServer((req,res)=>{
  if(req.url.split('?')[0]==='/health'){res.end('ok');return;}
  fs.readFile(PAGE,(e,d)=>{if(e){res.writeHead(500);res.end('index.html missing');return;}
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(d);});});
const clients=new Map();let nid=1;
const num=v=>typeof v=='number'&&isFinite(v)?Math.max(-5000,Math.min(5000,v)):0;
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f<>]/g,'').slice(0,n);
function frame(str){const b=Buffer.from(str),n=b.length;let h;
  if(n<126)h=Buffer.from([0x81,n]);else if(n<65536){h=Buffer.alloc(4);h[0]=0x81;h[1]=126;h.writeUInt16BE(n,2);}
  else{h=Buffer.alloc(10);h[0]=0x81;h[1]=127;h.writeBigUInt64BE(BigInt(n),2);}
  return Buffer.concat([h,b]);}
const send=(c,o)=>{try{c.sock.write(frame(JSON.stringify(o)))}catch(e){}};
server.on('upgrade',(req,sock)=>{
  const key=req.headers['sec-websocket-key'];if(!key||clients.size>=150){sock.destroy();return;}
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+
    crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')+'\r\n\r\n');
  const id='p'+(nid++),c={sock,p:{},last:0,lastdm:0,name:null,key:null,buf:Buffer.alloc(0)};clients.set(id,c);send(c,{t:'hi',id});
  sock.on('data',d=>{c.buf=Buffer.concat([c.buf,d]);if(c.buf.length>20000){sock.destroy();return;}parse(id,c);});
  sock.on('close',()=>clients.delete(id));sock.on('error',()=>{clients.delete(id);sock.destroy();});});
function parse(id,c){for(;;){const b=c.buf;if(b.length<2)return;const op=b[0]&15,masked=(b[1]&128)?4:0;let len=b[1]&127,off=2;
  if(len==126){if(b.length<4)return;len=b.readUInt16BE(2);off=4;}else if(len==127){c.sock.destroy();return;}
  if(b.length<off+masked+len)return;
  let payload=Buffer.from(b.subarray(off+masked,off+masked+len));
  if(masked){const mk=b.subarray(off,off+4);for(let i=0;i<payload.length;i++)payload[i]^=mk[i%4];}
  c.buf=b.subarray(off+masked+len);
  if(op==8){c.sock.end();return;}
  if(op==9){c.sock.write(Buffer.concat([Buffer.from([0x8A,payload.length]),payload]));continue;}
  if(op==1)handle(id,c,payload.toString());}}
function handle(id,c,txt){let m;try{m=JSON.parse(txt)}catch(e){return}
  if(!m||typeof m!='object')return;
  // ---- claim a username (first come, first served; tied to a secret token in the player's browser) ----
  if(m.t=='join'){const n=String(m.name||''),tk=String(m.token||'').slice(0,64);
    if(!NAME.test(n)||tk.length<12){send(c,{t:'bad'});return;}
    const k=n.toLowerCase();let u=USERS[k];
    if(u&&u.token!==tk){send(c,{t:'taken'});return;}
    if(c.key&&c.key!==k){send(c,{t:'bad'});return;}
    if(!u){if(Object.keys(USERS).length>=5000){send(c,{t:'bad'});return;}u=USERS[k]={name:n,token:tk,inbox:[]};}
    c.name=u.name;c.key=k;const inbox=u.inbox;u.inbox=[];saveSoon();
    send(c,{t:'joined',name:u.name,inbox});return;}
  if(!c.name)return;   // must have a username first
  if(m.t=='p'&&m.d&&typeof m.d=='object'){const d=m.d;
    c.p={x:num(d.x),z:num(d.z),y:num(d.y),l:d.l==1?1:0,hd:num(d.hd),n:c.name,
      s:/^#[0-9a-f]{6}$/i.test(d.s)?d.s:'#e8833a',v:['okada','keke','car'].includes(d.v)?d.v:null};}
  else if(m.t=='dm'){const now=Date.now();if(now-c.lastdm<400)return;c.lastdm=now;
    const to=String(m.to||'').toLowerCase(),txtm=clean(m.text,200).trim();if(!txtm)return;
    const u=USERS[to];if(!u){send(c,{t:'dmfail',to:clean(m.to,14)});return;}
    const o={t:'dm',from:c.name,text:txtm,ts:now};let n=0;
    clients.forEach(x=>{if(x.key===to){send(x,o);n++;}});
    if(!n){u.inbox.push({from:c.name,text:txtm,ts:now});if(u.inbox.length>50)u.inbox.shift();saveSoon();}}}
setInterval(()=>{if(!clients.size)return;
  const peers=[...clients].filter(([,c])=>c.name&&c.p.x!==undefined).map(([id,c])=>({id,p:c.p}));
  clients.forEach(c=>send(c,{t:'s',peers}));},100);
server.listen(PORT,()=>console.log('Kelvin Estates running on port '+PORT));
