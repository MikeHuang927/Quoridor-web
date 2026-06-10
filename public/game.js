const socket = io();

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const undoBtn = document.getElementById("undoBtn");
const restartBtn = document.getElementById("restartBtn");

const playerInfo = document.getElementById("playerInfo");
const waitingInfo = document.getElementById("waitingInfo");
const turnInfo = document.getElementById("turnInfo");
const winnerInfo = document.getElementById("winnerInfo");

const instructionOverlay = document.getElementById("instructionOverlay");
const desktopInstruction = document.getElementById("desktopInstruction");
const touchInstruction = document.getElementById("touchInstruction");

let instructionClosed = false;
let instructionLastTapTime = 0;

const INSTRUCTION_DOUBLE_TAP_TIME = 420;

function isTouchDeviceForInstruction() {
  return (
    window.matchMedia("(pointer: coarse)").matches ||
    window.innerWidth <= 768 ||
    navigator.maxTouchPoints > 0 ||
    "ontouchstart" in window
  );
}

function closeInstructionOverlay() {
  if (instructionClosed) return;

  instructionClosed = true;
  instructionOverlay.classList.add("hidden");

  desktopInstruction.style.display = "none";
  touchInstruction.style.display = "none";

  setTimeout(() => {
    if (typeof draw === "function") {
      draw();
    }
  }, 50);
}

function showInstructionBeforeGame() {
  if (!instructionOverlay || !desktopInstruction || !touchInstruction) {
    return;
  }

  const isTouchDevice = isTouchDeviceForInstruction();

  desktopInstruction.style.display = isTouchDevice ? "none" : "block";
  touchInstruction.style.display = isTouchDevice ? "block" : "none";
  instructionOverlay.classList.remove("hidden");

  function handleDesktopClose(event) {
    if (isTouchDevice) return;

    event.preventDefault();
    closeInstructionOverlay();

    instructionOverlay.removeEventListener("click", handleDesktopClose);
  }

  function handleTouchClose(event) {
    if (!isTouchDevice) return;

    event.preventDefault();

    const now = Date.now();

    if (now - instructionLastTapTime <= INSTRUCTION_DOUBLE_TAP_TIME) {
      closeInstructionOverlay();

      instructionOverlay.removeEventListener("touchend", handleTouchClose);
      instructionOverlay.removeEventListener("pointerup", handleTouchClose);
      return;
    }

    instructionLastTapTime = now;
  }

  instructionOverlay.addEventListener("click", handleDesktopClose);
  instructionOverlay.addEventListener("touchend", handleTouchClose, { passive: false });
  instructionOverlay.addEventListener("pointerup", handleTouchClose);
}

window.addEventListener("load", showInstructionBeforeGame);

const BOARD_SIZE = 9;
const OUTSIDE_TOP = -1;
const OUTSIDE_BOTTOM = BOARD_SIZE;

const CELL = 52;
const MARGIN_X = 60;
const MARGIN_Y = 86;
const WALL_THICKNESS = 10;

const WALL_COUNT = 10;
const INV_WALL_WIDTH = 38;
const INV_WALL_HEIGHT = 9;
const INV_GAP = 10;

const INVENTORY_HIT_HEIGHT = CELL * 1.5;

const CANVAS_WIDTH = MARGIN_X * 2 + CELL * BOARD_SIZE;
const CANVAS_HEIGHT = MARGIN_Y * 2 + CELL * BOARD_SIZE;

canvas.width = CANVAS_WIDTH;
canvas.height = CANVAS_HEIGHT;

let myPlayer = null;
let gameState = null;

let selectedWall = null;
let previewWall = null;

let selectedPawn = false;
let pendingPawnMove = null;

let lastTap = {
  type: null,
  time: 0
};

let touchSession = null;
let ignoreMouseClickUntil = 0;

let pendingWallRotateTimer = null;
let lastWallFreeTapTime = 0;

const DOUBLE_TAP_TIME = 360;
const TOUCH_TAP_MAX_DURATION = 280;
const TOUCH_MOVE_TOLERANCE = 14;

const colors = {
  p1: "blue",
  p2: "red",
  p1Wall: "#4A90E2",
  p2Wall: "#E94B4B",
  inactive: "lightgray",
  placedWall: "#444444",
  preview: "gold"
};

socket.on("playerAssigned", (player) => {
  myPlayer = player;

  if (myPlayer === 1) {
    playerInfo.textContent = "你是玩家 1：方向鍵移動；手機/平板可觸控棋子移動";
  } else if (myPlayer === 2) {
    playerInfo.textContent = "你是玩家 2：方向鍵移動；手機/平板可觸控棋子移動";
  } else {
    playerInfo.textContent = "你是觀戰者";
  }

  draw();
});

socket.on("gameState", (state) => {
  gameState = state;
  clearLocalSelections();
  draw();
});

socket.on("playerDisconnected", () => {
  waitingInfo.textContent = "有玩家離線，等待玩家重新加入。";
});

undoBtn.addEventListener("click", () => {
  socket.emit("undo");
});

restartBtn.addEventListener("click", () => {
  socket.emit("restart");
});

document.addEventListener("keydown", (e) => {
  if (!gameState) return;
  if (gameState.gameOver) return;
  if (!myPlayer) return;

  let move = null;

  if (e.key === "ArrowUp") move = getMoveByViewDirection("up");
  if (e.key === "ArrowDown") move = getMoveByViewDirection("down");
  if (e.key === "ArrowLeft") move = getMoveByViewDirection("left");
  if (e.key === "ArrowRight") move = getMoveByViewDirection("right");

  if (move) {
    e.preventDefault();
    clearLocalSelections();
    socket.emit("move", move);
  }
});

canvas.addEventListener("mousemove", (e) => {
  if (!selectedWall) return;

  const pos = getMousePos(e);
  updatePreviewWall(pos.x, pos.y);
  draw();
});

canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();

  if (!selectedWall) return;

  selectedWall.orientation = selectedWall.orientation === "H" ? "V" : "H";

  const pos = getMousePos(e);
  updatePreviewWall(pos.x, pos.y);
  draw();
});

canvas.addEventListener("click", (e) => {
  if (Date.now() < ignoreMouseClickUntil) return;

  const pos = getMousePos(e);
  handleMouseCanvasAction(pos.x, pos.y);
});

canvas.addEventListener("touchstart", (e) => {
  e.preventDefault();

  if (e.touches.length !== 1) return;

  const pos = getTouchPos(e.touches[0]);

  touchSession = {
    startX: pos.x,
    startY: pos.y,
    lastX: pos.x,
    lastY: pos.y,
    startTime: Date.now(),
    moved: false,
    startedOnInventory: false
  };

  if (!gameState) return;
  if (gameState.gameOver) return;
  if (myPlayer !== gameState.currentPlayer) return;

  if (isTouchOnMyPawn(pos.x, pos.y) && !selectedWall) {
    return;
  }

  const inventoryPlayer = clickedInventory(pos.x, pos.y);

  if (inventoryPlayer && inventoryPlayer === myPlayer) {
    if (gameState.players[myPlayer].walls <= 0) return;

    if (selectedWall) {
      clearLocalSelections();
      draw();
      touchSession.startedOnInventory = true;
      return;
    }

    selectedPawn = false;
    pendingPawnMove = null;
    clearPendingWallRotate();

    selectedWall = {
      player: myPlayer,
      orientation: "H"
    };

    touchSession.startedOnInventory = true;

    updatePreviewWall(pos.x, pos.y);
    draw();
  }
}, { passive: false });

canvas.addEventListener("touchmove", (e) => {
  e.preventDefault();

  if (!touchSession) return;
  if (e.touches.length !== 1) return;

  const pos = getTouchPos(e.touches[0]);

  const dx = pos.x - touchSession.startX;
  const dy = pos.y - touchSession.startY;

  touchSession.lastX = pos.x;
  touchSession.lastY = pos.y;

  if (dx * dx + dy * dy > TOUCH_MOVE_TOLERANCE * TOUCH_MOVE_TOLERANCE) {
    touchSession.moved = true;
  }

  if (selectedWall) {
    clearPendingWallRotate();
    updatePreviewWall(pos.x, pos.y);
    draw();
  }
}, { passive: false });

canvas.addEventListener("touchend", (e) => {
  e.preventDefault();

  ignoreMouseClickUntil = Date.now() + 500;

  if (!touchSession) return;

  const duration = Date.now() - touchSession.startTime;
  const wasMoved = touchSession.moved;
  const wasLongPress = duration > TOUCH_TAP_MAX_DURATION;

  const x = touchSession.lastX;
  const y = touchSession.lastY;
  const startedOnInventory = touchSession.startedOnInventory;

  touchSession = null;

  if (startedOnInventory) {
    return;
  }

  if (wasMoved || wasLongPress) {
    return;
  }

  handleTouchTap(x, y);
}, { passive: false });

function handleMouseCanvasAction(x, y) {
  if (!gameState) return;
  if (gameState.gameOver) return;
  if (myPlayer !== gameState.currentPlayer) return;

  const inventoryPlayer = clickedInventory(x, y);

  if (inventoryPlayer) {
    if (inventoryPlayer !== myPlayer) return;
    if (gameState.players[myPlayer].walls <= 0) return;

    if (selectedWall) {
      clearLocalSelections();
      draw();
      return;
    }

    selectedPawn = false;
    pendingPawnMove = null;

    selectedWall = {
      player: myPlayer,
      orientation: "H"
    };

    updatePreviewWall(x, y);
    draw();
    return;
  }

  if (selectedWall && previewWall) {
    if (!canPlaceWallClient(selectedWall.orientation, previewWall.r, previewWall.c)) {
      draw();
      return;
    }

    socket.emit("placeWall", {
      orientation: selectedWall.orientation,
      r: previewWall.r,
      c: previewWall.c
    });

    clearLocalSelections();
  }
}

function handleTouchTap(x, y) {
  if (!gameState) return;
  if (gameState.gameOver) return;
  if (myPlayer !== gameState.currentPlayer) return;

  if (selectedWall) {
    handleTouchWallTap(x, y);
    return;
  }

  handleTouchPawnTap(x, y);
}

function handleTouchPawnTap(x, y) {
  const tappedPawn = isTouchOnMyPawn(x, y);
  const tappedCell = getBoardCellFromPoint(x, y);

  if (!selectedPawn) {
    if (tappedPawn) {
      selectedPawn = true;
      pendingPawnMove = null;
      recordTap("pawn");
      draw();
    }

    return;
  }

  if (selectedPawn && pendingPawnMove) {
    const tappedValidCell = tappedCell
      ? getMoveFromTappedCell(tappedCell.logicalR, tappedCell.logicalC)
      : null;

    if (
      tappedValidCell &&
      (
        tappedValidCell.targetR !== pendingPawnMove.targetR ||
        tappedValidCell.targetC !== pendingPawnMove.targetC
      )
    ) {
      pendingPawnMove = tappedValidCell;
      recordTap("pawnConfirm");
      draw();
      return;
    }

    if (isDoubleTap("pawnConfirm")) {
      socket.emit("move", {
        dr: pendingPawnMove.dr,
        dc: pendingPawnMove.dc
      });

      clearLocalSelections();
      return;
    }

    recordTap("pawnConfirm");
    draw();
    return;
  }

  if (selectedPawn && tappedCell) {
    const move = getMoveFromTappedCell(tappedCell.logicalR, tappedCell.logicalC);

    if (move) {
      pendingPawnMove = move;
      recordTap("pawnConfirm");
      draw();
      return;
    }
  }
}

function handleTouchWallTap(x, y) {
  updatePreviewWall(x, y);

  if (!previewWall) {
    draw();
    return;
  }

  const now = Date.now();
  const insidePreview = isPointInsidePreviewWall(x, y);

  if (pendingWallRotateTimer) {
    clearPendingWallRotate();

    if (tryConfirmWallPlacement()) {
      return;
    }

    draw();
    return;
  }

  if (now - lastWallFreeTapTime <= DOUBLE_TAP_TIME) {
    lastWallFreeTapTime = 0;

    if (tryConfirmWallPlacement()) {
      return;
    }

    draw();
    return;
  }

  if (insidePreview) {
    scheduleSingleTapWallRotate();
    lastWallFreeTapTime = now;
    draw();
    return;
  }

  lastWallFreeTapTime = now;
  draw();
}

function scheduleSingleTapWallRotate() {
  clearPendingWallRotate();

  pendingWallRotateTimer = setTimeout(() => {
    if (!selectedWall) {
      pendingWallRotateTimer = null;
      return;
    }

    selectedWall.orientation = selectedWall.orientation === "H" ? "V" : "H";
    pendingWallRotateTimer = null;
    lastWallFreeTapTime = 0;

    draw();
  }, DOUBLE_TAP_TIME);
}

function clearPendingWallRotate() {
  if (pendingWallRotateTimer) {
    clearTimeout(pendingWallRotateTimer);
    pendingWallRotateTimer = null;
  }
}

function tryConfirmWallPlacement() {
  if (!selectedWall || !previewWall) return false;

  if (!canPlaceWallClient(selectedWall.orientation, previewWall.r, previewWall.c)) {
    return false;
  }

  socket.emit("placeWall", {
    orientation: selectedWall.orientation,
    r: previewWall.r,
    c: previewWall.c
  });

  clearLocalSelections();
  return true;
}

function recordTap(type) {
  lastTap = {
    type,
    time: Date.now()
  };
}

function isDoubleTap(type) {
  const now = Date.now();

  const result =
    lastTap.type === type &&
    now - lastTap.time <= DOUBLE_TAP_TIME;

  lastTap = {
    type,
    time: now
  };

  return result;
}

function clearLocalSelections() {
  clearPendingWallRotate();

  selectedWall = null;
  previewWall = null;
  selectedPawn = false;
  pendingPawnMove = null;
  lastWallFreeTapTime = 0;

  lastTap = {
    type: null,
    time: 0
  };
}

function getMoveByViewDirection(direction) {
  if (myPlayer === 1) {
    if (direction === "up") return { dr: -1, dc: 0 };
    if (direction === "down") return { dr: 1, dc: 0 };
    if (direction === "left") return { dr: 0, dc: -1 };
    if (direction === "right") return { dr: 0, dc: 1 };
  }

  if (myPlayer === 2) {
    if (direction === "up") return { dr: 1, dc: 0 };
    if (direction === "down") return { dr: -1, dc: 0 };
    if (direction === "left") return { dr: 0, dc: -1 };
    if (direction === "right") return { dr: 0, dc: 1 };
  }

  return null;
}

function isPlayerTwoView() {
  return myPlayer === 2;
}

function bottomPlayerInView() {
  return myPlayer === 2 ? 2 : 1;
}

function isBottomInventory(pid) {
  return pid === bottomPlayerInView();
}

function getInventoryY(pid) {
  return isBottomInventory(pid) ? CANVAS_HEIGHT - 22 : 20;
}

function getInventoryHitZone(pid) {
  const boardLeft = MARGIN_X;
  const boardRight = MARGIN_X + BOARD_SIZE * CELL;

  if (isBottomInventory(pid)) {
    return {
      x1: boardLeft,
      x2: boardRight,
      y1: CANVAS_HEIGHT - INVENTORY_HIT_HEIGHT,
      y2: CANVAS_HEIGHT
    };
  }

  return {
    x1: boardLeft,
    x2: boardRight,
    y1: 0,
    y2: INVENTORY_HIT_HEIGHT
  };
}

function viewRowForPawn(logicalRow) {
  if (!isPlayerTwoView()) return logicalRow;

  if (logicalRow === OUTSIDE_TOP) return OUTSIDE_BOTTOM;
  if (logicalRow === OUTSIDE_BOTTOM) return OUTSIDE_TOP;

  return BOARD_SIZE - 1 - logicalRow;
}

function logicalRowFromViewRow(viewRow) {
  if (!isPlayerTwoView()) return viewRow;
  return BOARD_SIZE - 1 - viewRow;
}

function getMousePos(e) {
  const rect = canvas.getBoundingClientRect();

  return {
    x: ((e.clientX - rect.left) * canvas.width) / rect.width,
    y: ((e.clientY - rect.top) * canvas.height) / rect.height
  };
}

function getTouchPos(touch) {
  const rect = canvas.getBoundingClientRect();

  return {
    x: ((touch.clientX - rect.left) * canvas.width) / rect.width,
    y: ((touch.clientY - rect.top) * canvas.height) / rect.height
  };
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawWallInventory();
  drawBoard();

  if (gameState) {
    drawPlacedWalls();
    drawPlayers();
    drawPreviewWall();
    drawInfo();
  }
}

function drawBoard() {
  ctx.strokeStyle = "black";
  ctx.lineWidth = 1;

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const x = MARGIN_X + c * CELL;
      const y = MARGIN_Y + r * CELL;
      ctx.strokeRect(x, y, CELL, CELL);
    }
  }
}

function drawWallInventory() {
  if (!gameState) return;

  const totalWidth = WALL_COUNT * INV_WALL_WIDTH + (WALL_COUNT - 1) * INV_GAP;
  const startX = (canvas.width - totalWidth) / 2;

  for (const pid of [1, 2]) {
    const y = getInventoryY(pid);

    for (let i = 0; i < WALL_COUNT; i++) {
      const x = startX + i * (INV_WALL_WIDTH + INV_GAP);

      let fill = "lightgray";

      if (i < gameState.players[pid].walls) {
        if (pid === gameState.currentPlayer) {
          fill = pid === 1 ? colors.p1Wall : colors.p2Wall;
        } else {
          fill = colors.inactive;
        }
      }

      ctx.fillStyle = fill;
      ctx.strokeStyle = "black";
      ctx.lineWidth = 1;
      ctx.fillRect(x, y, INV_WALL_WIDTH, INV_WALL_HEIGHT);
      ctx.strokeRect(x, y, INV_WALL_WIDTH, INV_WALL_HEIGHT);
    }
  }
}

function drawPlacedWalls() {
  ctx.fillStyle = colors.placedWall;
  ctx.strokeStyle = "black";
  ctx.lineWidth = 1;

  for (const wall of gameState.horizontalWalls) {
    const rect = getWallRect("H", wall.r, wall.c);
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  }

  for (const wall of gameState.verticalWalls) {
    const rect = getWallRect("V", wall.r, wall.c);
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  }
}

function drawPlayers() {
  for (const pid of [1, 2]) {
    const data = gameState.players[pid];

    let logicalR = data.pos.r;
    let logicalC = data.pos.c;

    const isLocalPendingPawn =
      selectedPawn &&
      pendingPawnMove &&
      pid === myPlayer &&
      myPlayer === gameState.currentPlayer;

    if (isLocalPendingPawn) {
      logicalR = pendingPawnMove.targetR;
      logicalC = pendingPawnMove.targetC;
    }

    const cx = MARGIN_X + logicalC * CELL + CELL / 2;
    const vr = viewRowForPawn(logicalR);

    let cy;

    if (vr === OUTSIDE_TOP) {
      cy = MARGIN_Y - CELL / 2;
    } else if (vr === OUTSIDE_BOTTOM) {
      cy = MARGIN_Y + BOARD_SIZE * CELL + CELL / 2;
    } else {
      cy = MARGIN_Y + vr * CELL + CELL / 2;
    }

    const active = pid === gameState.currentPlayer;
    const fill = active ? (pid === 1 ? colors.p1 : colors.p2) : colors.inactive;
    const highlight = selectedPawn && pid === myPlayer && active;

    drawSmoothPiece(cx, cy, fill, String(pid), highlight);
  }
}

function drawSmoothPiece(cx, cy, fill, text, highlight = false) {
  ctx.save();

  ctx.beginPath();
  ctx.arc(cx, cy, 18, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();

  ctx.lineWidth = highlight ? 4 : 2.5;
  ctx.strokeStyle = highlight ? colors.preview : "black";
  ctx.stroke();

  ctx.fillStyle = "white";
  ctx.font = "bold 20px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cx, cy + 0.5);

  ctx.restore();
}

function getWallRect(orientation, r, c) {
  if (orientation === "H") {
    const boundaryIndex = isPlayerTwoView() ? BOARD_SIZE - (r + 1) : r + 1;

    return {
      x: MARGIN_X + c * CELL,
      y: MARGIN_Y + boundaryIndex * CELL - WALL_THICKNESS / 2,
      w: CELL * 2,
      h: WALL_THICKNESS
    };
  }

  const startViewRow = isPlayerTwoView() ? BOARD_SIZE - 2 - r : r;

  return {
    x: MARGIN_X + (c + 1) * CELL - WALL_THICKNESS / 2,
    y: MARGIN_Y + startViewRow * CELL,
    w: WALL_THICKNESS,
    h: CELL * 2
  };
}

function drawPreviewWall() {
  if (!selectedWall || !previewWall) return;

  const rect = getWallRect(selectedWall.orientation, previewWall.r, previewWall.c);
  const fill = selectedWall.player === 1 ? colors.p1Wall : colors.p2Wall;
  const valid = canPlaceWallClient(selectedWall.orientation, previewWall.r, previewWall.c);

  ctx.fillStyle = fill;
  ctx.strokeStyle = valid ? "gold" : "red";
  ctx.lineWidth = valid ? 3 : 5;

  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
}

function updatePreviewWall(x, y) {
  if (!selectedWall) return;

  let best = null;
  let bestDist = Infinity;

  if (selectedWall.orientation === "H") {
    for (let r = OUTSIDE_TOP; r <= BOARD_SIZE - 1; r++) {
      for (let c = 0; c <= BOARD_SIZE - 2; c++) {
        const rect = getWallRect("H", r, c);
        const cx = rect.x + rect.w / 2;
        const cy = rect.y + rect.h / 2;
        const dist = (x - cx) * (x - cx) + (y - cy) * (y - cy);

        if (dist < bestDist) {
          bestDist = dist;
          best = { r, c };
        }
      }
    }
  } else {
    for (let r = 0; r <= BOARD_SIZE - 2; r++) {
      for (let c = 0; c <= BOARD_SIZE - 2; c++) {
        const rect = getWallRect("V", r, c);
        const cx = rect.x + rect.w / 2;
        const cy = rect.y + rect.h / 2;
        const dist = (x - cx) * (x - cx) + (y - cy) * (y - cy);

        if (dist < bestDist) {
          bestDist = dist;
          best = { r, c };
        }
      }
    }
  }

  previewWall = best;
}

function clickedInventory(x, y) {
  if (!gameState) return null;

  for (const pid of [1, 2]) {
    const zone = getInventoryHitZone(pid);

    if (
      x >= zone.x1 &&
      x <= zone.x2 &&
      y >= zone.y1 &&
      y <= zone.y2
    ) {
      if (gameState.players[pid].walls > 0) {
        return pid;
      }
    }
  }

  return null;
}

function isTouchOnMyPawn(x, y) {
  if (!gameState || !myPlayer) return false;

  const pos = getDisplayedPawnPosition(myPlayer);
  if (!pos) return false;

  const dx = x - pos.x;
  const dy = y - pos.y;

  return dx * dx + dy * dy <= 24 * 24;
}

function getDisplayedPawnPosition(pid) {
  if (!gameState) return null;

  let logicalR = gameState.players[pid].pos.r;
  let logicalC = gameState.players[pid].pos.c;

  if (
    selectedPawn &&
    pendingPawnMove &&
    pid === myPlayer &&
    myPlayer === gameState.currentPlayer
  ) {
    logicalR = pendingPawnMove.targetR;
    logicalC = pendingPawnMove.targetC;
  }

  const cx = MARGIN_X + logicalC * CELL + CELL / 2;
  const vr = viewRowForPawn(logicalR);

  let cy;

  if (vr === OUTSIDE_TOP) {
    cy = MARGIN_Y - CELL / 2;
  } else if (vr === OUTSIDE_BOTTOM) {
    cy = MARGIN_Y + BOARD_SIZE * CELL + CELL / 2;
  } else {
    cy = MARGIN_Y + vr * CELL + CELL / 2;
  }

  return { x: cx, y: cy };
}

function getBoardCellFromPoint(x, y) {
  const c = Math.floor((x - MARGIN_X) / CELL);
  const viewR = Math.floor((y - MARGIN_Y) / CELL);

  if (c < 0 || c >= BOARD_SIZE) {
    return null;
  }

  if (viewR < 0 || viewR >= BOARD_SIZE) {
    return null;
  }

  return {
    logicalR: logicalRowFromViewRow(viewR),
    logicalC: c
  };
}

function getMoveFromTappedCell(targetR, targetC) {
  if (!gameState || !myPlayer) return null;

  const current = gameState.players[myPlayer].pos;
  const dr = targetR - current.r;
  const dc = targetC - current.c;

  if (Math.abs(dr) + Math.abs(dc) !== 1) {
    return null;
  }

  if (!canMoveToClient(myPlayer, targetR, targetC)) {
    return null;
  }

  return {
    dr,
    dc,
    targetR,
    targetC
  };
}

function canMoveToClient(pid, row, col) {
  const player = gameState.players[pid];
  const opponent = gameState.players[pid === 1 ? 2 : 1];

  const r = player.pos.r;
  const c = player.pos.c;

  if (col < 0 || col >= BOARD_SIZE) {
    return false;
  }

  if (row < OUTSIDE_TOP || row > OUTSIDE_BOTTOM) {
    return false;
  }

  if (row === OUTSIDE_TOP && pid !== 1) {
    return false;
  }

  if (row === OUTSIDE_BOTTOM && pid !== 2) {
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

  return !isBlockedWithWalls(
    gameState.horizontalWalls,
    gameState.verticalWalls,
    r,
    c,
    row,
    col
  );
}

function isPointInsidePreviewWall(x, y) {
  if (!selectedWall || !previewWall) return false;

  const rect = getWallRect(selectedWall.orientation, previewWall.r, previewWall.c);

  return (
    x >= rect.x - 10 &&
    x <= rect.x + rect.w + 10 &&
    y >= rect.y - 10 &&
    y <= rect.y + rect.h + 10
  );
}

function wallExists(list, r, c) {
  return list.some((w) => w.r === r && w.c === c);
}

function wallSegments(orientation, r, c) {
  if (orientation === "H") {
    return [`H-${r}-${c}`, `H-${r}-${c + 1}`];
  }

  return [`V-${r}-${c}`, `V-${r + 1}-${c}`];
}

function isWallConflictClient(orientation, r, c, horizontalWalls, verticalWalls) {
  const newSegments = new Set(wallSegments(orientation, r, c));

  for (const wall of horizontalWalls) {
    for (const seg of wallSegments("H", wall.r, wall.c)) {
      if (newSegments.has(seg)) return true;
    }
  }

  for (const wall of verticalWalls) {
    for (const seg of wallSegments("V", wall.r, wall.c)) {
      if (newSegments.has(seg)) return true;
    }
  }

  if (orientation === "H") {
    if (r >= 0 && r <= BOARD_SIZE - 2 && wallExists(verticalWalls, r, c)) {
      return true;
    }
  }

  if (orientation === "V") {
    if (wallExists(horizontalWalls, r, c)) {
      return true;
    }
  }

  return false;
}

function isBlockedWithWalls(horizontalWalls, verticalWalls, r1, c1, r2, c2) {
  if (r2 === r1 - 1) {
    return (
      wallExists(horizontalWalls, r2, c1) ||
      wallExists(horizontalWalls, r2, c1 - 1)
    );
  }

  if (r2 === r1 + 1) {
    return (
      wallExists(horizontalWalls, r1, c1) ||
      wallExists(horizontalWalls, r1, c1 - 1)
    );
  }

  if (r1 < 0 || r1 >= BOARD_SIZE) {
    return false;
  }

  if (c2 === c1 - 1) {
    return (
      wallExists(verticalWalls, r1, c2) ||
      wallExists(verticalWalls, r1 - 1, c2)
    );
  }

  if (c2 === c1 + 1) {
    return (
      wallExists(verticalWalls, r1, c1) ||
      wallExists(verticalWalls, r1 - 1, c1)
    );
  }

  return false;
}

function validNeighborFromClient(current, nr, nc) {
  if (nc < 0 || nc >= BOARD_SIZE) return false;

  if (nr >= 0 && nr < BOARD_SIZE) return true;

  if (nr === OUTSIDE_TOP || nr === OUTSIDE_BOTTOM) {
    return nc === current.c;
  }

  return false;
}

function hasPathClient(playerNum, horizontalWalls, verticalWalls) {
  const start = gameState.players[playerNum].pos;
  const goal = playerNum === 1 ? OUTSIDE_TOP : OUTSIDE_BOTTOM;

  const queue = [{ r: start.r, c: start.c }];
  const visited = new Set();

  while (queue.length > 0) {
    const current = queue.shift();
    const key = `${current.r},${current.c}`;

    if (current.r === goal) return true;
    if (visited.has(key)) continue;

    visited.add(key);

    const dirs = [
      { dr: -1, dc: 0 },
      { dr: 1, dc: 0 },
      { dr: 0, dc: -1 },
      { dr: 0, dc: 1 }
    ];

    for (const d of dirs) {
      const nr = current.r + d.dr;
      const nc = current.c + d.dc;

      if (!validNeighborFromClient(current, nr, nc)) continue;

      if (!isBlockedWithWalls(horizontalWalls, verticalWalls, current.r, current.c, nr, nc)) {
        queue.push({ r: nr, c: nc });
      }
    }
  }

  return false;
}

function canPlaceWallClient(orientation, r, c) {
  if (!gameState) return false;

  if (c < 0 || c > BOARD_SIZE - 2) return false;

  if (orientation === "H") {
    if (r < OUTSIDE_TOP || r > BOARD_SIZE - 1) return false;
  } else if (orientation === "V") {
    if (r < 0 || r > BOARD_SIZE - 2) return false;
  } else {
    return false;
  }

  const horizontalWalls = gameState.horizontalWalls.map((w) => ({ ...w }));
  const verticalWalls = gameState.verticalWalls.map((w) => ({ ...w }));

  if (isWallConflictClient(orientation, r, c, horizontalWalls, verticalWalls)) {
    return false;
  }

  if (orientation === "H") {
    horizontalWalls.push({ r, c, owner: myPlayer });
  } else {
    verticalWalls.push({ r, c, owner: myPlayer });
  }

  return hasPathClient(1, horizontalWalls, verticalWalls) &&
         hasPathClient(2, horizontalWalls, verticalWalls);
}

function drawInfo() {
  if (!gameState) return;

  const p1Connected = gameState.players[1].connected;
  const p2Connected = gameState.players[2].connected;

  if (!myPlayer) {
    waitingInfo.textContent = "目前你是觀戰者，等待有玩家位置空出。";
  } else if (!p1Connected || !p2Connected) {
    waitingInfo.textContent = "等待第二位玩家加入。";
  } else {
    waitingInfo.textContent = "";
  }

  turnInfo.textContent = `目前回合：玩家 ${gameState.currentPlayer}`;

  if (gameState.gameOver) {
    winnerInfo.textContent = `玩家 ${gameState.winner} 獲勝！`;
  } else {
    winnerInfo.textContent = "";
  }
}
