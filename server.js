const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

const rooms = new Map();
const MAX_PLAYERS = 10;

const ROLE_SETS = {
  5: ["人狼", "占い師", "騎士", "村人", "村人"],
  6: ["人狼", "人狼", "占い師", "騎士", "村人", "村人"],
  7: ["人狼", "人狼", "占い師", "騎士", "霊媒師", "村人", "村人"],
  8: ["人狼", "人狼", "占い師", "騎士", "霊媒師", "村人", "村人", "村人"],
  9: ["人狼", "人狼", "人狼", "占い師", "騎士", "霊媒師", "村人", "村人", "村人"],
  10:["人狼", "人狼", "人狼", "占い師", "騎士", "霊媒師", "村人", "村人", "村人", "村人"]
};

function roomCode() {
  let code;
  do {
    code = crypto.randomBytes(3).toString("hex").toUpperCase();
  } while (rooms.has(code));
  return code;
}

function shuffled(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

function publicPlayers(room) {
  return room.players.map(p => ({
    id: p.id,
    name: p.name,
    alive: p.alive,
    host: p.host
  }));
}

function emitRoom(room) {
  io.to(room.code).emit("room:update", {
    code: room.code,
    phase: room.phase,
    day: room.day,
    players: publicPlayers(room),
    started: room.started,
    winner: room.winner
  });
}

function sendRole(player, room) {
  player.socket.emit("game:role", {
    role: player.role,
    teammateIds: room.players
      .filter(p => p.role === "人狼" && p.id !== player.id)
      .map(p => p.id)
  });
}

function winner(room) {
  const alive = room.players.filter(p => p.alive);
  const wolves = alive.filter(p => p.role === "人狼").length;
  const villagers = alive.length - wolves;
  if (wolves === 0) return "村人陣営";
  if (wolves >= villagers) return "人狼陣営";
  return null;
}

function beginNight(room) {
  room.phase = "night";
  room.day += 1;
  room.votes = {};
  room.night = { wolf: null, seer: null, guard: null };
  room.players.forEach(p => {
    if (p.alive) sendRole(p, room);
  });
  emitRoom(room);
}

function resolveNight(room) {
  const alive = room.players.filter(p => p.alive);
  const targetIds = [];

  if (room.night.wolf && room.night.guard !== room.night.wolf) {
    targetIds.push(room.night.wolf);
  }
  targetIds.forEach(id => {
    const p = room.players.find(x => x.id === id);
    if (p) p.alive = false;
  });

  const result = winner(room);
  if (result) {
    room.winner = result;
    room.phase = "finished";
    emitRoom(room);
    return;
  }
  room.phase = "day";
  room.votes = {};
  emitRoom(room);
}

io.on("connection", socket => {
  socket.on("room:create", ({ name }) => {
    name = String(name || "").trim().slice(0, 12);
    if (!name) return socket.emit("error:msg", "名前を入力してください。");

    const code = roomCode();
    const room = {
      code, players: [], started: false, phase: "lobby", day: 0,
      votes: {}, night: {}, winner: null
    };
    const player = { id: socket.id, socket, name, host: true, alive: true, role: null };
    room.players.push(player);
    rooms.set(code, room);
    socket.join(code);
    socket.data.room = code;
    socket.emit("room:joined", { code });
    emitRoom(room);
  });

  socket.on("room:join", ({ code, name }) => {
    code = String(code || "").trim().toUpperCase();
    name = String(name || "").trim().slice(0, 12);
    const room = rooms.get(code);

    if (!name) return socket.emit("error:msg", "名前を入力してください。");
    if (!room) return socket.emit("error:msg", "そのルームはありません。");
    if (room.started) return socket.emit("error:msg", "ゲームはすでに始まっています。");
    if (room.players.length >= MAX_PLAYERS) return socket.emit("error:msg", "満員です。");

    const player = { id: socket.id, socket, name, host: false, alive: true, role: null };
    room.players.push(player);
    socket.join(code);
    socket.data.room = code;
    socket.emit("room:joined", { code });
    emitRoom(room);
  });

  socket.on("game:start", () => {
    const room = rooms.get(socket.data.room);
    if (!room) return;
    const me = room.players.find(p => p.id === socket.id);
    if (!me?.host) return socket.emit("error:msg", "ホストだけが開始できます。");
    if (room.players.length < 5) return socket.emit("error:msg", "5人以上で開始してください。");

    const roles = ROLE_SETS[room.players.length] || ROLE_SETS[10];
    shuffled(room.players).forEach((p, i) => {
      p.role = roles[i];
      p.alive = true;
    });
    room.started = true;
    room.winner = null;
    room.day = 0;
    beginNight(room);
  });

  socket.on("action:night", ({ action, targetId }) => {
    const room = rooms.get(socket.data.room);
    if (!room || room.phase !== "night") return;
    const me = room.players.find(p => p.id === socket.id);
    const target = room.players.find(p => p.id === targetId);
    if (!me || !me.alive || !target || !target.alive || target.id === me.id) return;

    if (action === "wolf" && me.role === "人狼") room.night.wolf = target.id;

    if (action === "seer" && me.role === "占い師") {
      socket.emit("action:result", {
        text: `${target.name}さんは${target.role === "人狼" ? "人狼" : "人狼ではありません"}。`
      });
      room.night.seer = target.id;
    }

    if (action === "guard" && me.role === "騎士") room.night.guard = target.id;

    const livingSpecials = room.players.filter(p =>
      p.alive && ["人狼", "占い師", "騎士"].includes(p.role)
    );
    const wolves = livingSpecials.filter(p => p.role === "人狼");
    const seers = livingSpecials.filter(p => p.role === "占い師");
    const guards = livingSpecials.filter(p => p.role === "騎士");

    const ready =
      wolves.every(p => room.night.wolf) &&
      seers.every(p => room.night.seer) &&
      guards.every(p => room.night.guard);

    if (ready) resolveNight(room);
  });

  socket.on("action:vote", ({ targetId }) => {
    const room = rooms.get(socket.data.room);
    if (!room || room.phase !== "day") return;
    const me = room.players.find(p => p.id === socket.id);
    const target = room.players.find(p => p.id === targetId);
    if (!me?.alive || !target?.alive || target.id === me.id) return;

    room.votes[me.id] = target.id;
    const alive = room.players.filter(p => p.alive);
    if (Object.keys(room.votes).length < alive.length) return;

    const counts = {};
    Object.values(room.votes).forEach(id => counts[id] = (counts[id] || 0) + 1);
    const max = Math.max(...Object.values(counts));
    const top = Object.keys(counts).filter(id => counts[id] === max);

    if (top.length === 1) {
      const out = room.players.find(p => p.id === top[0]);
      if (out) out.alive = false;
    }

    const result = winner(room);
    if (result) {
      room.winner = result;
      room.phase = "finished";
      emitRoom(room);
    } else {
      beginNight(room);
    }
  });

  socket.on("disconnect", () => {
    const code = socket.data.room;
    const room = rooms.get(code);
    if (!room) return;
    const index = room.players.findIndex(p => p.id === socket.id);
    if (index !== -1) room.players.splice(index, 1);

    if (room.players.length === 0) {
      rooms.delete(code);
      return;
    }
    if (!room.players.some(p => p.host)) room.players[0].host = true;
    emitRoom(room);
  });
});

server.listen(PORT, () => {
  console.log(`Werewolf Online running on port ${PORT}`);
});