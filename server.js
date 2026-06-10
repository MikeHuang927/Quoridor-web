const express = require("express");
const http = require("http");
const os = require("os");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const BOARD_SIZE = 9;
const OUTSIDE_TOP = -1;
const OUTSIDE_BOTTOM = BOARD_SIZE;

let game = createNewGame(1, {
  started: false,
  mode: "normal",
  timerMinutes: 10
});

function createNewGame(startPlayer = 1, options = {}) {
  const timerMinutes = options.timerMinutes || 10;
  const timerMs = timerMinutes * 60 * 1000;

  return {
    players: {
      1: {
        id: null,
        pos: { r: OUTSIDE_BOTTOM, c: 4 },
        goal: OUTSIDE_TOP,
        walls: 10
      },
      2: {
        id: null,
        pos: { r: OUTSIDE_TOP, c: 4 },
        goal: OUTSIDE_BOTTOM,
        walls: 10
      }
    },
    currentPlayer: startPlayer,
    horizontalWalls: [],
    verticalWalls: [],
    history: [],
    gameOver: false,
    winner: null,
    started: options.started || false,
    mode: options.mode || "normal",
    timerMinutes,
    timers: {
      1: timerMs,
      2: timerMs
    },
    turnStartedAt: Date.now(),
    timeLoser: null
  };
}

function cloneState() {
  return JSON.parse(JSON.stringify({
    players: game.players,
    currentPlayer: game.currentPlayer,
    horizontalWalls: game.horizontalWalls,
    verticalWalls: game.verticalWalls,
    gameOver: game.gameOver,
    winner: game.winner,
    started: game.started,
    mode: game.mode,
    timerMinutes: game.timerMinutes,
    timers: game.timers,
    turnStartedAt: game.turnStartedAt,
    timeLoser: game.timeLoser
  }));
}

function saveHistory() {
  game.history.push(cloneState());
}

function restoreState(state) {
  game.players = state.players;
  game.currentPlayer = state.currentPlayer;
  game.horizontalWalls = state.horizontalWalls;
  game.verticalWalls = state.verticalWalls;
  game.gameOver = state.gameOver;
  game.winner = state.winner;
  game.started = state.started;
  game.mode = state.mode;
  game.timerMinutes = state.timerMinutes;
  game.timers = state.timers;
  game.turnStartedAt = Date.now();
  game.timeLoser = state.timeLoser;
}

function getPlayerNumber(socketId) {
  if (game.players[1].id === socketId) return 1;
  if (game.players[2].id === socketId) return 2;
  return null;
}

function getOpponent(playerNumber) {
  return playerNumber === 1 ? 2 : 1;
}

function getStartOutsideRow(playerNumber) {
  return playerNumber === 1 ? OUTSIDE_BOTTOM : OUTSIDE_TOP;
}

function isAtOwnStartOutside(playerNumber) {
  return game.players[playerNumber].pos.r === getStartOutsideRow(playerNumber);
}

function wallExists(list, r, c) {
  return list.some(w => w.r === r && w.c === c);
}

function wallSegments(orientation, r, c) {
  if (orientation === "H") {
    return [`H-${r}-${c}`, `H-${r}-${c + 1}`];
  }

  return [`V-${r}-${c}`, `V-${r + 1}-${c}`];
}

function isWallConflict(orientation, r, c) {
  const newSegments = new Set(wallSegments(orientation, r, c));

  for (const w of game.horizontalWalls) {
    for (const seg of wallSegments("H", w.r, w.c)) {
      if (newSegments.has(seg)) return true;
    }
  }

  for (const w of game.verticalWalls) {
    for (const seg of wallSegments("V", w.r, w.c)) {
      if (newSegments.has(seg)) return true;
    }
  }

  if (orientation === "H") {
    if (r >= 0 && r <= BOARD_SIZE - 2 && wallExists(game.verticalWalls, r, c)) {
      return true;
    }
  }

  if (orientation === "V") {
    if (wallExists(game.horizontalWalls, r, c)) {
      return true;
    }
  }

  return false;
}

function isBlocked(r1, c1, r2, c2) {
  if (r2 === r1 - 1) {
    return (
      wallExists(game.horizontalWalls, r2, c2) ||
      wallExists(game.horizontalWalls, r2, c2 - 1)
    );
  }

  if (r2 === r1 + 1) {
    return (
      wallExists(game.horizontalWalls, r1, c2) ||
      wallExists(game.horizontalWalls, r1, c2 - 1)
    );
  }

  if (r1 < 0 || r1 >= BOARD_SIZE) {
    return false;
  }

  if (c2 === c1 - 1) {
    return (
      wallExists(game.verticalWalls, r1, c2) ||
      wallExists(game.verticalWalls, r1 - 1, c2)
    );
  }

  if (c2 === c1 + 1) {
    return (
      wallExists(game.verticalWalls, r1, c1) ||
      wallExists(game.verticalWalls, r1 - 1, c1)
    );
  }

  return false;
}

function validNeighborFrom(current, nr, nc) {
  if (nc < 0 || nc >= BOARD_SIZE) return false;

  if (nr >= 0 && nr < BOARD_SIZE) return true;

  if (nr === OUTSIDE_TOP || nr === OUTSIDE_BOTTOM) {
    if (current.r === nr && Math.abs(current.c - nc) === 1) {
      return true;
    }

    return nc === current.c;
  }

  return false;
}

function hasPath(playerNumber) {
  const player = game.players[playerNumber];
  const start = player.pos;
  const goal = player.goal;

  const queue = [{ r: start.r, c: start.c }];
  const visited = new Set();

  while (queue.length > 0) {
    const current = queue.shift();
    const key = `${current.r},${current.c}`;

    if (current.r === goal) return true;
    if (visited.has(key)) continue;

    visited.add(key);

    const directions = [
      { dr: -1, dc: 0 },
      { dr: 1, dc: 0 },
      { dr: 0, dc: -1 },
      { dr: 0, dc: 1 }
    ];

    for (const d of directions) {
      const nr = current.r + d.dr;
      const nc = current.c + d.dc;

      if (!validNeighborFrom(current, nr, nc)) continue;

      if (!isBlocked(current.r, current.c, nr, nc)) {
        queue.push({ r: nr, c: nc });
      }
    }
  }

  return false;
}

function bothPlayersHavePath() {
  return hasPath(1) && hasPath(2);
}

function isInitialEntryMove(playerNumber, current, row, col) {
  if (playerNumber === 1) {
    return current.r === OUTSIDE_BOTTOM && row === BOARD_SIZE - 1 && col >= 0 && col < BOARD_SIZE;
  }

  if (playerNumber === 2) {
    return current.r === OUTSIDE_TOP && row === 0 && col >= 0 && col < BOARD_SIZE;
  }

  return false;
}

function isOutsideStartSideMove(playerNumber, current, row, col) {
  const startOutsideRow = getStartOutsideRow(playerNumber);

  return (
    current.r === startOutsideRow &&
    row === startOutsideRow &&
    col >= 0 &&
    col < BOARD_SIZE &&
    Math.abs(current.c - col) === 1
  );
}

function canMoveTo(playerNumber, row, col) {
  const player = game.players[playerNumber];
  const opponent = game.players[getOpponent(playerNumber)];

  const r = player.pos.r;
  const c = player.pos.c;

  if (col < 0 || col >= BOARD_SIZE) return false;
  if (row < OUTSIDE_TOP || row > OUTSIDE_BOTTOM) return false;

  if (row === OUTSIDE_TOP && playerNumber !== 1 && r !== OUTSIDE_TOP) return false;
  if (row === OUTSIDE_BOTTOM && playerNumber !== 2 && r !== OUTSIDE_BOTTOM) return false;

  if (row === opponent.pos.r && col === opponent.pos.c) return false;

  if (isOutsideStartSideMove(playerNumber, player.pos, row, col)) return true;

  if (isInitialEntryMove(playerNumber, player.pos, row, col)) {
    return !isBlocked(r, c, row, col);
  }

  if (Math.abs(r - row) + Math.abs(c - col) !== 1) return false;

  if (r === OUTSIDE_TOP || r === OUTSIDE_BOTTOM) {
    if (col !== c) return false;
  }

  return !isBlocked(r, c, row, col);
}

function canPlaceWall(orientation, r, c) {
  if (c < 0 || c > BOARD_SIZE - 2) return false;

  if (orientation === "H") {
    if (r < OUTSIDE_TOP || r > BOARD_SIZE - 1) return false;
  } else if (orientation === "V") {
    if (r < 0 || r > BOARD_SIZE - 2) return false;
  } else {
    return false;
  }

  if (isWallConflict(orientation, r, c)) return false;

  if (orientation === "H") {
    game.horizontalWalls.push({ r, c, owner: game.currentPlayer });
    const valid = bothPlayersHavePath();
    game.horizontalWalls.pop();
    return valid;
  }

  game.verticalWalls.push({ r, c, owner: game.currentPlayer });
  const valid = bothPlayersHavePath();
  game.verticalWalls.pop();
  return valid;
}

function updateActiveTimer() {
  if (!game.started) return;
  if (game.gameOver) return;
  if (game.mode !== "timed") return;

  const now = Date.now();
  const elapsed = now - game.turnStartedAt;

  if (elapsed <= 0) return;

  const player = game.currentPlayer;

  game.timers[player] -= elapsed;
  game.turnStartedAt = now;

  if (game.timers[player] <= 0) {
    game.timers[player] = 0;
    game.gameOver = true;
    game.timeLoser = player;
    game.winner = getOpponent(player);
  }
}

function switchTurn() {
  game.currentPlayer = getOpponent(game.currentPlayer);
  game.turnStartedAt = Date.now();
}

function publicGameState() {
  updateActiveTimer();

  return {
    players: {
      1: {
        pos: game.players[1].pos,
        walls: game.players[1].walls,
        connected: game.players[1].id !== null
      },
      2: {
        pos: game.players[2].pos,
        walls: game.players[2].walls,
        connected: game.players[2].id !== null
      }
    },
    currentPlayer: game.currentPlayer,
    horizontalWalls: game.horizontalWalls,
    verticalWalls: game.verticalWalls,
    gameOver: game.gameOver,
    winner: game.winner,
    started: game.started,
    mode: game.mode,
    timerMinutes: game.timerMinutes,
    timers: game.timers,
    timeLoser: game.timeLoser
  };
}

function broadcastGame() {
  io.emit("gameState", publicGameState());
}

function resetGameKeepingPlayers(startPlayer, keepSettings = true) {
  const oldPlayer1 = game.players[1].id;
  const oldPlayer2 = game.players[2].id;

  const mode = keepSettings ? game.mode : "normal";
  const timerMinutes = keepSettings ? game.timerMinutes : 10;
  const started = keepSettings ? game.started : false;

  game = createNewGame(startPlayer, {
    started,
    mode,
    timerMinutes
  });

  game.players[1].id = oldPlayer1;
  game.players[2].id = oldPlayer2;
  game.turnStartedAt = Date.now();

  broadcastGame();
}

io.on("connection", socket => {
  let assignedPlayer = null;

  if (game.players[1].id === null) {
    game.players[1].id = socket.id;
    assignedPlayer = 1;
  } else if (game.players[2].id === null) {
    game.players[2].id = socket.id;
    assignedPlayer = 2;
  }

  socket.emit("playerAssigned", assignedPlayer);
  socket.emit("gameState", publicGameState());

  socket.on("startGame", data => {
    const playerNumber = getPlayerNumber(socket.id);

    if (playerNumber !== 1) return;
    if (game.started) return;

    const mode = data && data.mode === "timed" ? "timed" : "normal";
    let timerMinutes = Number(data && data.timerMinutes);

    if (!Number.isFinite(timerMinutes)) timerMinutes = 10;
    timerMinutes = Math.max(1, Math.min(60, Math.round(timerMinutes)));

    const oldPlayer1 = game.players[1].id;
    const oldPlayer2 = game.players[2].id;

    game = createNewGame(1, {
      started: true,
      mode,
      timerMinutes
    });

    game.players[1].id = oldPlayer1;
    game.players[2].id = oldPlayer2;
    game.turnStartedAt = Date.now();

    broadcastGame();
  });

  socket.on("move", data => {
    const playerNumber = getPlayerNumber(socket.id);

    if (!playerNumber) return;
    if (!game.started) return;
    if (game.gameOver) return;
    if (playerNumber !== game.currentPlayer) return;

    updateActiveTimer();
    if (game.gameOver) {
      broadcastGame();
      return;
    }

    const current = game.players[playerNumber].pos;

    let nr;
    let nc;

    if (typeof data.targetR === "number" && typeof data.targetC === "number") {
      nr = data.targetR;
      nc = data.targetC;
    } else {
      const { dr, dc } = data;
      nr = current.r + dr;
      nc = current.c + dc;
    }

    if (!canMoveTo(playerNumber, nr, nc)) return;

    const setupSideMove = isOutsideStartSideMove(playerNumber, current, nr, nc);

    if (setupSideMove) {
      game.players[playerNumber].pos = { r: nr, c: nc };
      game.turnStartedAt = Date.now();
      broadcastGame();
      return;
    }

    saveHistory();

    game.players[playerNumber].pos = { r: nr, c: nc };

    if (nr === game.players[playerNumber].goal) {
      game.gameOver = true;
      game.winner = playerNumber;
      broadcastGame();
      return;
    }

    switchTurn();
    broadcastGame();
  });

  socket.on("placeWall", data => {
    const playerNumber = getPlayerNumber(socket.id);

    if (!playerNumber) return;
    if (!game.started) return;
    if (game.gameOver) return;
    if (playerNumber !== game.currentPlayer) return;
    if (game.players[playerNumber].walls <= 0) return;
    if (isAtOwnStartOutside(playerNumber)) return;

    updateActiveTimer();
    if (game.gameOver) {
      broadcastGame();
      return;
    }

    const { orientation, r, c } = data;

    if (!canPlaceWall(orientation, r, c)) return;

    saveHistory();

    if (orientation === "H") {
      game.horizontalWalls.push({ r, c, owner: playerNumber });
    } else {
      game.verticalWalls.push({ r, c, owner: playerNumber });
    }

    game.players[playerNumber].walls -= 1;

    switchTurn();
    broadcastGame();
  });

  socket.on("nextRoundChoice", data => {
    const playerNumber = getPlayerNumber(socket.id);

    if (!playerNumber) return;
    if (!game.gameOver) return;
    if (playerNumber !== game.winner) return;

    const choice = data && data.choice;
    const startPlayer = choice === "second" ? getOpponent(playerNumber) : playerNumber;

    resetGameKeepingPlayers(startPlayer, true);
  });

  socket.on("undo", () => {
    const playerNumber = getPlayerNumber(socket.id);

    if (!playerNumber) return;
    if (!game.started) return;
    if (game.history.length === 0) return;

    const lastState = game.history.pop();
    restoreState(lastState);

    broadcastGame();
  });

  socket.on("restart", () => {
    const playerNumber = getPlayerNumber(socket.id);

    if (!playerNumber) return;

    resetGameKeepingPlayers(1, false);
  });

  socket.on("disconnect", () => {
    if (game.players[1].id === socket.id) {
      game.players[1].id = null;
    }

    if (game.players[2].id === socket.id) {
      game.players[2].id = null;
    }

    io.emit("playerDisconnected");
    broadcastGame();
  });
});

setInterval(() => {
  if (!game.started) return;
  if (game.gameOver) return;
  if (game.mode !== "timed") return;

  updateActiveTimer();
  broadcastGame();
}, 1000);

function getLocalIPAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === "IPv4" && !net.internal) {
        addresses.push(net.address);
      }
    }
  }

  return addresses;
}

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}.`);
  console.log(`本機測試網址：http://localhost:${PORT}`);

  const addresses = getLocalIPAddresses();

  for (const ip of addresses) {
    console.log(`區域網路連線網址：http://${ip}:${PORT}`);
  }
});
