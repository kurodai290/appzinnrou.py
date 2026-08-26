let socket=null,myId=null,myRole=null,room=null,actionDone=false,myMode="player";
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
function msg(t){if($("message"))$("message").textContent=t||""}
function text(id,t){if($(id))$(id).textContent=t??""}
function icon(r){return({"人狼":"🐺","占い師":"🔮","骑士":"🛡️","騎士":"🛡️","霊媒師":"👻","村人":"👤"}[r]||"❓")}
function render(){
 if(!room)return;
 $("home")?.classList.add("hidden");$("room")?.classList.remove("hidden");text("roomCode",room.code);
 const p=room.progress||{};text("progressIcon",p.icon||"⏳");text("progressTitle",p.title||"");text("progressDescription",p.description||"");
 text("playerCount",`${room.players.length} / 10人`);
 const pe=$("players");if(pe)pe.innerHTML=room.players.map(p=>`<div class="player ${p.alive?"":"dead"}"><div> ${p.alive?"🟢":"⚫"} ${esc(p.name)} ${p.id===myId?'<span class="self">自分</span>':""}</div><div>${p.host?"👑":""}</div></div>`).join("");
 const owner=room.ownerId===myId,gm=room.gmId===myId;
 $("start")?.classList.toggle("hidden",!(owner&&!room.started&&room.phase==="lobby"));
 $("reset")?.classList.toggle("hidden",!owner);
 $("gmPanel")?.classList.toggle("hidden",!gm);$("gmBadge")?.classList.toggle("hidden",!gm);
 if($("gmNext"))$("gmNext").disabled=!(gm&&room.started&&(room.phase==="night"||room.phase==="day"));
 if(room.started||room.phase==="finished")$("game")?.classList.remove("hidden");else $("game")?.classList.add("hidden");
 let title="⏳ 待機中",desc="";
 if(room.phase==="night"){title=`🌙 ${room.day}日目・夜`;desc="夜の行動を行ってください。"}
 if(room.phase==="day"){title=`☀️ ${room.day}日目・昼`;desc=`投票済み：${room.votesCount||0} / ${room.aliveCount||0}人`}
 if(room.phase==="finished"){title="🏆 ゲーム終了";desc=`${room.winner||""}の勝利です！`}
 if($("gameStatus"))$("gameStatus").innerHTML=`<div class="game-status-title">${title}</div><div>${desc}</div>`;
 text("roleText",myRole?`${icon(myRole)} ${myRole}`:"---");
 const ins=$("gameInstruction");if(ins){
  if(myMode==="gm")ins.innerHTML="<b>👑 ゲームマスター</b><br>「次の日へ進める」でゲームを進行できます。";
  else if(room.phase==="night")ins.innerHTML=myRole==="人狼"?"<b>🐺 人狼</b><br>襲撃する人を選んでください。":myRole==="占い師"?"<b>🔮 占い師</b><br>占う人を選んでください。":myRole==="騎士"?"<b>🛡️ 騎士</b><br>守る人を選んでください。":"<b>🌙 夜</b><br>朝まで待ってください。";
  else if(room.phase==="day")ins.innerHTML="<b>☀️ 昼</b><br>人狼だと思う人に投票してください。";
  else ins.innerHTML="";
 }
 renderActions();
}
function renderActions(){
 const a=$("actionArea");if(!a||!room)return;
 if(myMode==="gm"){a.innerHTML='<div class="waiting">👑 GMはゲームに参加しません。</div>';return}
 const me=room.players.find(p=>p.id===myId);if(!me){a.innerHTML="";return}
 if(!me.alive){a.innerHTML='<div class="waiting">⚫ 脱落しています。観戦してください。</div>';return}
 if(room.phase==="finished"){a.innerHTML=`<div class="winner">🏆 ${esc(room.winner||"ゲーム終了")}</div>`;return}
 if(actionDone){a.innerHTML='<div class="waiting">⏳ 行動済みです。ほかのプレイヤーを待っています。</div>';return}
 const targets=room.players.filter(p=>p.alive&&p.id!==myId);
 if(room.phase==="night"){
  let action=null,title="";
  if(myRole==="人狼"){action="wolf";title="🐺 襲撃する人"}else if(myRole==="占い師"){action="seer";title="🔮 占う人"}else if(myRole==="騎士"){action="guard";title="🛡️ 守る人"}
  if(!action){a.innerHTML='<div class="waiting">🌙 今夜は行動ありません。</div>';return}
  a.innerHTML=`<div class="target-title">${title}</div>`+targets.map(p=>`<button class="target" data-id="${p.id}" data-action="${action}">${esc(p.name)}</button>`).join("");
  a.querySelectorAll(".target").forEach(b=>b.onclick=()=>night(b.dataset.id,b.dataset.action));return
 }
 if(room.phase==="day"){
  a.innerHTML='<div class="target-title">🗳️ 投票する人</div>'+targets.map(p=>`<button class="target" data-id="${p.id}">🗳️ ${esc(p.name)}</button>`).join("");
  a.querySelectorAll(".target").forEach(b=>b.onclick=()=>vote(b.dataset.id));
 }
}
function night(id,action){if(actionDone)return;actionDone=true;render();socket.emit("action:night",{targetId:id,action})}
function vote(id){if(actionDone)return;actionDone=true;render();socket.emit("action:vote",{targetId:id})}
function connect(){
 socket=io(window.location.origin,{transports:["polling","websocket"]});
 socket.on("connect",()=>{myId=socket.id;msg("🟢 サーバーに接続しました。")});
 socket.on("connect_error",e=>msg("🔴 接続エラー："+e.message));
 socket.on("room:joined",d=>{myMode=d.mode||"player";$("home")?.classList.add("hidden");$("room")?.classList.remove("hidden");text("roomCode",d.code)});
 socket.on("room:update",d=>{room=d;render()});
 socket.on("game:role",d=>{myRole=d.role||null;actionDone=false;render();msg(`あなたの役職は「${d.role}」です。`)});
 socket.on("action:result",d=>msg("🔮 "+d.text));
 socket.on("game:event",d=>msg("📢 "+d.text));
 socket.on("room:reset",d=>{myRole=null;actionDone=false;msg(d?.message||"🔄 リセットされました。");render()});
 socket.on("error:msg",t=>msg("⚠️ "+t));
}
$("create")?.addEventListener("click",()=>{const name=$("name")?.value.trim();if(!name)return msg("名前を入力してください。");myMode=document.querySelector('input[name="mode"]:checked')?.value||"player";socket.emit("room:create",{name,mode:myMode})});
$("join")?.addEventListener("click",()=>{const name=$("name")?.value.trim(),code=$("code")?.value.trim().toUpperCase();if(!name)return msg("名前を入力してください。");if(!code)return msg("ルームコードを入力してください。");myMode=document.querySelector('input[name="mode"]:checked')?.value||"player";socket.emit("room:join",{name,code,mode:myMode})});
$("start")?.addEventListener("click",()=>socket.emit("game:start"));
$("gmNext")?.addEventListener("click",()=>socket.emit("gm:next"));
$("reset")?.addEventListener("click",()=>{if(confirm("ゲームをリセットしますか？"))socket.emit("room:reset")});
connect();