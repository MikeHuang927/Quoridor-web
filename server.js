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

let game = createNewGame();

function createNewGame() {
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
    currentPlayer: 1,
    horizontalWalls: [],
    verticalWalls: [],
    history: [],
    gameOver: false,
    winner: null
  };
}

function cloneState() {
  return JSON.parse(JSON.stringify({
    players: game.players,
    currentPlayer: game.currentPlayer,
    horizontalWalls: game.horizontalWalls,
    verticalWalls: game.verticalWalls,
    gameOver: game.gameOver,
    winner: game.winner
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
}

function getPlayerNumber(socketId) {
  if (game.players[1].id === socketId) return 1;
  if (game.players[2].id === socketId) return 2;
  return null;
}

function wallExists(list, r, c) {
  return list.some(w => w.r === r && w.c === c);
}

function wallSegments(orientation, r, c) {
  if (orientation === "H") {
    return [
      `H-${r}-${c}`,
      `H-${r}-${c + 1}`
    ];
  }

  return [
    `V-${r}-${c}`,
    `V-${r + 1}-${c}`
  ];
}

function isWallConflict(orientation, r, c) {
  const newSegments = new Set(wallSegments(orientation, r, c));

  for (const w of game.horizontalWalls) {
    const oldSegments = wallSegments("H", w.r, w.c);

    for (const seg of oldSegments) {
      if (newSegments.has(seg)) return true;
    }
  }

  for (const w of game.verticalWalls) {
    const oldSegments = wallSegments("V", w.r, w.c);

    for (const seg of oldSegments) {
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
      wallExists(game.horizontalWalls, r2, c1) ||
      wallExists(game.horizontalWalls, r2, c1 - 1)
    );
  }

  if (r2 === r1 + 1) {
    return (
      wallExists(game.horizontalWalls, r1, c1) ||
      wallExists(game.horizontalWalls, r1, c1 - 1)
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

    if (current.r === goal) {
      return true;
    }

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

function canMoveTo(playerNumber, row, col) {
  const player = game.players[playerNumber];
  const opponent = game.players[playerNumber === 1 ? 2 : 1];

  const r = player.pos.r;
  const c = player.pos.c;

  if (col < 0 || col >= BOARD_SIZE) {
    return false;
  }

  if (row < OUTSIDE_TOP || row > OUTSIDE_BOTTOM) {
    return false;
  }

  if (row === OUTSIDE_TOP && playerNumber !== 1) {
    return false;
  }

  if (row === OUTSIDE_BOTTOM && playerNumber !== 2) {
    return false;
  }

  if (row === opponent.pos.r && col === opponent.pos.c) {
    return false;
  }

  if (Math.abs(r - row) + Math.abs(c - col) !== 1) {
    return false;
  }

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

  if (isWallConflict(orientation, r, c)) {
    return false;
  }

  if (orientation === "H") {
    game.horizontalWalls.push({ r, c, owner: game.currentPlayer });
    const valid = bothPlayersHavePath();
    game.horizontalWalls.pop();
    return valid;
  }

  if (orientation === "V") {
    game.verticalWalls.push({ r, c, owner: game.currentPlayer });
    const valid = bothPlayersHavePath();
    game.verticalWalls.pop();
    return valid;
  }

  return false;
}

function publicGameState() {
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
    winner: game.winner
  };
}

function broadcastGame() {
  io.emit("gameState", publicGameState());
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

  socket.on("move", data => {
    const playerNumber = getPlayerNumber(socket.id);

    if (!playerNumber) return;
    if (game.gameOver) return;
    if (playerNumber !== game.currentPlayer) return;

    const { dr, dc } = data;

    const current = game.players[playerNumber].pos;
    const nr = current.r + dr;
    const nc = current.c + dc;

    if (!canMoveTo(playerNumber, nr, nc)) return;

    saveHistory();

    game.players[playerNumber].pos = { r: nr, c: nc };

    if (nr === game.players[playerNumber].goal) {
      game.gameOver = true;
      game.winner = playerNumber;
      broadcastGame();
      return;
    }

    game.currentPlayer = game.currentPlayer === 1 ? 2 : 1;
    broadcastGame();
  });

  socket.on("placeWall", data => {
    const playerNumber = getPlayerNumber(socket.id);

    if (!playerNumber) return;
    if (game.gameOver) return;
    if (playerNumber !== game.currentPlayer) return;
    if (game.players[playerNumber].walls <= 0) return;

    const { orientation, r, c } = data;

    if (!canPlaceWall(orientation, r, c)) return;

    saveHistory();

    if (orientation === "H") {
      game.horizontalWalls.push({ r, c, owner: playerNumber });
    } else {
      game.verticalWalls.push({ r, c, owner: playerNumber });
    }

    game.players[playerNumber].walls -= 1;
    game.currentPlayer = game.currentPlayer === 1 ? 2 : 1;

    broadcastGame();
  });

  socket.on("undo", () => {
    const playerNumber = getPlayerNumber(socket.id);

    if (!playerNumber) return;
    if (game.history.length === 0) return;

    const lastState = game.history.pop();
    restoreState(lastState);

    broadcastGame();
  });

  socket.on("restart", () => {
    const playerNumber = getPlayerNumber(socket.id);

    if (!playerNumber) return;

    const oldPlayer1 = game.players[1].id;
    const oldPlayer2 = game.players[2].id;

    game = createNewGame();

    game.players[1].id = oldPlayer1;
    game.players[2].id = oldPlayer2;

    broadcastGame();
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

  if (typeof getLocalIPAddresses === "function") {
    const addresses = getLocalIPAddresses();

    for (const ip of addresses) {
      console.log(`區域網路連線網址：http://${ip}:${PORT}`);
    }
  }
});