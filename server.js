// Kelvin Estates / Kelvin Town multiplayer server. No dependencies: just run  node server.js
// Serves the game (index.html) AND: live multiplayer, unique usernames, house assignment,
// private messages (text + voice notes), delivery/read receipts and "last seen".
const http=require('http'),crypto=require('crypto'),fs=require('fs'),path=require('path');
const PORT=process.env.PORT||3000, PAGE=path.join(__dirname,'index.html');
const DB=path.join(process.env.DATA_DIR||__dirname,'users.json');
const CAPS={estate:20,royal:12,pearl:12,tenement:72,selfcon:24,hostel:20,emerald:16,sunrise:24,lakeview:9,palm:16},FALL=['tenement','selfcon','hostel','palm','sunrise','pearl','emerald','royal','lakeview','estate'],LIFEIDS=['child','student','worker','trader','biz','rich'];
// registered usernames: lowercase name -> {name, token, inbox[], house, last}
let USERS={};try{USERS=JSON.parse(fs.readFileSync(DB,'utf8'))}catch(e){}
let dirty=false;const saveSoon=()=>{dirty=true};
setInterval(()=>{if(!dirty)return;dirty=false;fs.writeFile(DB,JSON.stringify(USERS),()=>{});},5000);
const NAME=/^[A-Za-z0-9_.-]{3,14}$/;
const AUDIO=/^data:audio\/[a-z0-9.+-]+(;codecs=[a-z0-9.,-]+)?;base64,[A-Za-z0-9+\/=]+$/i;
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
const sessions=key=>[...clients.values()].filter(x=>x.key===key);
const isOnline=key=>sessions(key).length>0;
function houseMap(){const m={};Object.values(USERS).forEach(u=>{if(u.home)m[u.home.cat+':'+u.home.i]=u.name;});return m;}
// pick a random vacant home, trying the player's preferred kinds first
function assignHome(prefs){const used=new Set(Object.values(USERS).filter(u=>u.home).map(u=>u.home.cat+':'+u.home.i));
  const order=[...new Set([...(prefs||[]).filter(c=>CAPS[c]),...FALL])];
  for(const c of order){const free=[];for(let i=0;i<CAPS[c];i++)if(!used.has(c+':'+i))free.push(i);if(free.length)return{cat:c,i:free[Math.floor(Math.random()*free.length)]};}
  const c=order[0];return{cat:c,i:Math.floor(Math.random()*CAPS[c])};}
server.on('upgrade',(req,sock)=>{
  const key=req.headers['sec-websocket-key'];if(!key||clients.size>=150){sock.destroy();return;}
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+
    crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')+'\r\n\r\n');
  const id='p'+(nid++),c={sock,p:{},lastdm:0,lastwho:0,name:null,key:null,buf:Buffer.alloc(0)};clients.set(id,c);send(c,{t:'hi',id});
  sock.on('data',d=>{c.buf=Buffer.concat([c.buf,d]);if(c.buf.length>130000){sock.destroy();return;}parse(id,c);});
  const gone=()=>{if(!clients.delete(id))return;if(c.key&&USERS[c.key]&&!isOnline(c.key)){USERS[c.key].last=Date.now();saveSoon();}};
  sock.on('close',gone);sock.on('error',()=>{gone();sock.destroy();});});
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
  if(m.t=='join'){const n=String(m.name||''),tk=String(m.token||'').slice(0,64);
    if(!NAME.test(n)||tk.length<12){send(c,{t:'bad'});return;}
    const k=n.toLowerCase();let u=USERS[k];
    if(u&&u.token!==tk){send(c,{t:'taken'});return;}
    if(c.key&&c.key!==k){send(c,{t:'bad'});return;}
    if(!u){if(Object.keys(USERS).length>=5000){send(c,{t:'bad'});return;}u=USERS[k]={name:n,token:tk,inbox:[],life:null,home:null,last:Date.now()};}
    if(!u.home&&typeof u.house=='number')u.home={cat:'estate',i:u.house};
    c.name=u.name;c.key=k;const inbox=u.inbox;u.inbox=[];u.last=Date.now();saveSoon();
    send(c,{t:'joined',name:u.name,life:u.life||null,home:u.home||null,houses:houseMap(),inbox});
    inbox.forEach(i=>{const sk=String(i.from).toLowerCase();sessions(sk).forEach(x=>send(x,{t:'ack',id:i.id,to:u.name,st:'d'}));});
    return;}
  if(!c.name)return;
  // the life quiz result: stored once, and a home is picked at random for it
  if(m.t=='life'){const u=USERS[c.key];if(!u)return;const L=m.life||{};if(!LIFEIDS.includes(L.id))return;
    if(!u.life)u.life={id:L.id,age:Math.max(5,Math.min(90,+L.age||20))};
    if(!u.home)u.home=assignHome(Array.isArray(m.prefs)?m.prefs.slice(0,6).map(String):[]);
    saveSoon();const hm=houseMap();send(c,{t:'home',life:u.life,home:u.home,houses:hm});
    clients.forEach(x=>{if(x!==c)send(x,{t:'hm',houses:hm});});return;}
  if(m.t=='p'&&m.d&&typeof m.d=='object'){const d=m.d;
    c.p={x:num(d.x),z:num(d.z),y:num(d.y),l:d.l==1?1:0,hd:num(d.hd),n:c.name,
      s:/^#[0-9a-f]{6}$/i.test(d.s)?d.s:'#e8833a',v:['okada','keke','car'].includes(d.v)?d.v:null};}
  else if(m.t=='dm'){const now=Date.now();if(now-c.lastdm<350)return;c.lastdm=now;
    const to=String(m.to||'').toLowerCase(),mid=clean(m.id,24)||('s'+now);
    const text=clean(m.text,200).trim();let audio=null,dur=0;
    if(typeof m.audio=='string'&&m.audio.length<=48000&&AUDIO.test(m.audio)){audio=m.audio;dur=Math.max(1,Math.min(20,Math.round(+m.dur||1)));}
    if(!text&&!audio)return;
    const u=USERS[to];if(!u){send(c,{t:'dmfail',to:clean(m.to,14)});return;}
    const o={t:'dm',from:c.name,id:mid,text,audio,dur,ts:now};const ss=sessions(to);ss.forEach(x=>send(x,o));
    if(!ss.length){u.inbox.push({from:c.name,id:mid,text,audio,dur,ts:now});while(u.inbox.length>40)u.inbox.shift();saveSoon();}
    send(c,{t:'ack',id:mid,to:u.name,st:ss.length?'d':'s'});}
  else if(m.t=='rd'){const to=String(m.to||'').toLowerCase();sessions(to).forEach(x=>send(x,{t:'rd',by:c.name}));}
  else if(m.t=='who'){const now=Date.now();if(now-c.lastwho<250)return;c.lastwho=now;
    const k=String(m.name||'').toLowerCase(),u=USERS[k];
    send(c,{t:'whoR',name:u?u.name:clean(m.name,14),exists:!!u,online:!!u&&isOnline(k),last:u?(isOnline(k)?now:u.last):0});}}
let tick=0;
setInterval(()=>{if(!clients.size)return;tick++;
  const peers=[...clients].filter(([,c])=>c.name&&c.p.x!==undefined).map(([id,c])=>({id,p:c.p}));
  const msg={t:'s',peers};if(tick%10==0)msg.h=houseMap();
  clients.forEach(c=>send(c,msg));},100);
server.listen(PORT,()=>console.log('Kelvin server running on port '+PORT));
