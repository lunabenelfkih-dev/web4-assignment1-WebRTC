const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let peer = null;

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
const ship = { x: canvas.width / 2, y: canvas.height - 80, size: 40 };
const bullets = [];
const meteorites = [];

let score = 0;
let highScore = localStorage.getItem('highScore') ? parseInt(localStorage.getItem('highScore')) : 0;
let gameOver = false;
let gameStarted = false;
let countdownValue = 0; // 0 means no countdown, positive numbers display the countdown

socket.on('connect', () => {
    showControllerUrl(socket.id);
});

function showControllerUrl(id) {
    const $qr = document.getElementById('qr');
    const url = new URL(`/controller.html?id=${id}`, window.location);

    if ($qr && typeof qrcode !== 'undefined') {
        const qr = qrcode(4, 'L');
        qr.addData(url.toString());
        qr.make();
        $qr.innerHTML = qr.createImgTag(4);
    }
}

socket.on('signal', (fromId, data) => {
    const $rtcStatus = document.getElementById('rtcStatus');

    if (peer) {
        peer.destroy();
        peer = null;
    }

    if ($rtcStatus) $rtcStatus.textContent = 'Offer received — creating peer…';

    peer = new SimplePeer({ initiator: false, trickle: false });

    peer.on('signal', answerData => {
        socket.emit('signal', fromId, answerData);
    });

    peer.on('connect', () => {
        const overlay = document.getElementById('connection-overlay');
        if (overlay) overlay.classList.add('hidden');
        startCountdown(3); // Start 3-second countdown before game begins
    });

    peer.on('data', rawData => {
        handleRemoteInput(rawData);
    });

    peer.on('close', () => {
        const overlay = document.getElementById('connection-overlay');
        if (overlay) overlay.classList.remove('hidden');
        peer = null;
    });

    peer.on('error', err => {
        console.error('[game] peer error:', err);
        const overlay = document.getElementById('connection-overlay');
        if (overlay) overlay.classList.remove('hidden');
        peer = null;
    });

    peer.signal(data);
});

function handleRemoteInput(rawData) {
    const msg = JSON.parse(rawData);

    if (msg.type === 'move') {
        if (msg.x === null || msg.x === undefined) return; // sensor returned null, ignore
        // msg.x is raw gamma (-90..90); map to canvas width, clamped to [0, canvas.width]
        const normalised = Math.min(1, Math.max(0, (msg.x + 90) / 180));
        ship.x = normalised * canvas.width;
    } else if (msg.type === 'fire') {
        bullets.push({ x: ship.x, y: ship.y - 20 });
    }
}

function startCountdown(duration = 3) {
    countdownValue = duration;
    const countdownInterval = setInterval(() => {
        countdownValue--;
        if (countdownValue <= 0) {
            clearInterval(countdownInterval);
            countdownValue = 0;
            gameStarted = true;
        }
    }, 1000);
}

function gameLoop() {
    // Always draw, but only update if game has started and not over
    if (gameStarted && !gameOver) {
        update();
    }
    draw();
    requestAnimationFrame(gameLoop);
}

function update() {
    // Move bullets upward and remove any that have left the top of the canvas
    for (let i = 0; i < bullets.length; i++) {
        bullets[i].y -= 10;
    }
    // Filter out off-screen bullets to prevent memory leaks
    for (let i = bullets.length - 1; i >= 0; i--) {
        if (bullets[i].y < 0) bullets.splice(i, 1);
    }

    // CALCULATE DIFFICULTY (Slow progression)
    // Every 300 points, the game gets slightly harder
    const level = Math.floor(score / 300);

    // VERY LOW STARTING CHANCE
    // Starts at 1% chance. Adds 0.2% per level.
    const spawnChance = 0.001 + (level * 0.002);

    // We only spawn if random is met AND we have fewer than 15 meteorites on screen
    // This "Population Cap" prevents the screen from being covered in red circles
    if (Math.random() < spawnChance && meteorites.length < 15) {

        // SLOWER STARTING SPEED
        // Base speed is now 1. Randomness is reduced.
        const baseSpeed = 1 + (level * 0.3);
        const maxSpeed = 3 + (level * 0.5);
        const speed = baseSpeed + Math.random() * (maxSpeed - baseSpeed);

        meteorites.push({
            x: Math.random() * canvas.width,
            y: -20,
            s: Math.min(speed, 8) // Never faster than 8 pixels per frame
        });
    }

    // Move meteorites downward; remove any that have left the bottom of the canvas
    for (let i = 0; i < meteorites.length; i++) {
        meteorites[i].y += meteorites[i].s;
    }
    // Filter out off-screen meteorites to prevent memory leaks
    for (let i = meteorites.length - 1; i >= 0; i--) {
        if (meteorites[i].y > canvas.height) meteorites.splice(i, 1);
    }

    // Collision detection: bullets vs meteorites
    for (let i = bullets.length - 1; i >= 0; i--) {
        for (let j = meteorites.length - 1; j >= 0; j--) {
            const dist = Math.hypot(bullets[i].x - meteorites[j].x, bullets[i].y - meteorites[j].y);
            if (dist < 20) { // collision threshold (bullet ~2px + meteorite ~15px radius)
                meteorites.splice(j, 1);
                bullets.splice(i, 1);
                score += 10; // increment score on hit
                if (score > highScore) {
                    highScore = score;
                    localStorage.setItem('highScore', highScore);
                }
                break; // bullet destroyed, move to next bullet
            }
        }
    }

    // Collision detection: ship vs meteorites (game over condition)
    for (let i = meteorites.length - 1; i >= 0; i--) {
        const dist = Math.hypot(ship.x - meteorites[i].x, ship.y - meteorites[i].y);
        if (dist < 35) { // collision threshold (ship ~20px radius + meteorite ~15px radius)
            endGame();
            return;
        }
    }
}

function endGame() {
    gameOver = true;
    const overlay = document.getElementById('connection-overlay');
    if (overlay) overlay.classList.remove('hidden');
    draw(); // draw final state with game over text
}

function restartGame() {
    gameOver = false;
    score = 0;
    bullets.length = 0;
    meteorites.length = 0;
    ship.x = canvas.width / 2;
    gameLoop();
}

function draw() {
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Ship
    ctx.fillStyle = 'lime';
    ctx.fillRect(ship.x - 20, ship.y, 40, 20);

    // Bullets
    ctx.fillStyle = 'yellow';
    bullets.forEach(b => ctx.fillRect(b.x - 2, b.y, 4, 10));

    // Meteorites
    ctx.fillStyle = 'red';
    meteorites.forEach(m => {
        ctx.beginPath();
        ctx.arc(m.x, m.y, 15, 0, Math.PI * 2);
        ctx.fill();
    });

    // Render score and high score
    ctx.fillStyle = 'white';
    ctx.font = '20px Arial';
    ctx.fillText(`Score: ${score}`, 20, 30);
    ctx.fillText(`High Score: ${highScore}`, 20, 60);

    // Render countdown if active
    if (countdownValue > 0 && !gameStarted) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'white';
        ctx.font = 'bold 120px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(countdownValue, canvas.width / 2, canvas.height / 2);
        ctx.textAlign = 'left';
    }

    // Render game over message
    if (gameOver) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'white';
        ctx.font = 'bold 60px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('GAME OVER', canvas.width / 2, canvas.height / 2);
        ctx.font = '30px Arial';
        ctx.fillText(`Final Score: ${score}`, canvas.width / 2, canvas.height / 2 + 60);
        ctx.textAlign = 'left';
    }
}

gameLoop();
