const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let peer = null;

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// Load background image
const backgroundImg = new Image();
backgroundImg.src = '/assets/background.svg';
// Load meteorite sprite
const meteoriteImg = new Image();
meteoriteImg.src = '/assets/meteorite.svg';
// Load rocket sprite
const rocketImg = new Image();
rocketImg.src = '/assets/rocket.svg';

// ─────────────────────────────────────────────────────────────
// AUDIO SYSTEM
// ─────────────────────────────────────────────────────────────

let audioUnlocked = false; // Track if audio context is unlocked
let musicEnabled = false;  // Source of truth for music playback

// Helper: Create a pool of N identical audio elements
function createAudioPool(src, count, volume) {
    return Array(count).fill(null).map(() => {
        const audio = new Audio(src);
        audio.volume = volume;
        audio.preload = 'auto';
        return audio;
    });
}

// Sound Manager: Handles all audio playback with circular indexing
const SoundManager = {
    bgMusic: (() => {
        const audio = new Audio('/assets/sounds/interstellar-8bit.mp3');
        audio.loop = true;
        audio.volume = 0.4;
        audio.preload = 'auto';
        return audio;
    })(),

    explosions: createAudioPool('/assets/sounds/explosionsound.mp3', 3, 0.5),

    explosionIdx: 0,

    // Play a sound with single retry on failure
    playWithRetry(audio) {
        if (!audio) return;
        try {
            audio.currentTime = 0;
            const promise = audio.play();
            if (promise !== undefined) {
                promise.catch(() => {
                    setTimeout(() => {
                        try {
                            audio.currentTime = 0;
                            audio.play().catch(() => { });
                        } catch (e) { }
                    }, 50);
                });
            }
        } catch (e) { }
    },

    playExplosion() {
        this.playWithRetry(this.explosions[this.explosionIdx]);
        this.explosionIdx = (this.explosionIdx + 1) % this.explosions.length;
    },

    unlockContext() {
        if (audioUnlocked) return;
        audioUnlocked = true;

        try {
            // Prime all sound pools silently (skip bgMusic to avoid race condition)
            [this.explosions].flat().forEach(audio => {
                audio.currentTime = 0;
                const p = audio.play();
                if (p !== undefined) {
                    p.then(() => { audio.pause(); audio.currentTime = 0; }).catch(() => { });
                } else {
                    audio.pause();
                    audio.currentTime = 0;
                }
            });
        } catch (e) { }
    },

    toggleMusic() {
        musicEnabled = !musicEnabled;
        if (musicEnabled) {
            this.bgMusic.currentTime = 0;
            return this.bgMusic.play()
                .then(() => true)
                .catch(() => { musicEnabled = false; return false; });
        } else {
            this.bgMusic.pause();
            return Promise.resolve(true);
        }
    }
};

// Music Button Handler
const musicBtn = document.getElementById('music-toggle-btn');
if (musicBtn) {
    musicBtn.addEventListener('click', async () => {
        SoundManager.unlockContext();
        const success = await SoundManager.toggleMusic();

        if (success) {
            const isPlaying = musicEnabled;
            musicBtn.classList.toggle('paused', !isPlaying);
            musicBtn.classList.toggle('playing', isPlaying);
        }
    });
}

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
        // Don't start countdown yet; wait for gyro_ready message from phone
    });

    peer.on('data', rawData => {
        handleRemoteInput(rawData);
    });

    peer.on('close', () => {
        resetOnDisconnect();
        peer = null;
    });

    peer.on('error', err => {
        console.error('[game] peer error:', err);
        resetOnDisconnect();
        peer = null;
    });

    peer.signal(data);
});

function resetOnDisconnect() {
    // Hide game over overlay
    const gameOverOverlay = document.getElementById('game-over-overlay');
    if (gameOverOverlay) {
        gameOverOverlay.classList.add('hidden');
    }

    // Reset game state
    gameStarted = false;
    gameOver = false;
    countdownValue = 0;

    // Clear physics arrays
    bullets.length = 0;
    meteorites.length = 0;

    // Show connection overlay with QR code
    const connectionOverlay = document.getElementById('connection-overlay');
    if (connectionOverlay) {
        connectionOverlay.classList.remove('hidden');
    }
}

function handleRemoteInput(rawData) {
    const msg = JSON.parse(rawData);

    if (msg.type === 'move') {
        if (msg.x === null || msg.x === undefined) return; // sensor returned null, ignore
        // msg.x is beta (-45..45) for landscape mode; map to canvas width, clamped to [0, canvas.width]
        // Clamp beta to -45..45 range for sensitivity and edge behavior
        const clampedBeta = Math.min(45, Math.max(-45, msg.x));
        const normalised = Math.min(1, Math.max(0, (clampedBeta + 45) / 90));
        ship.x = normalised * canvas.width;
    } else if (msg.type === 'fire') {
        bullets.push({ x: ship.x - 10, y: ship.y - 100 });
    } else if (msg.type === 'gyro_ready') {
        // Phone has confirmed gyroscope access; start countdown (music controlled separately by button)
        startCountdown(3);
    } else if (msg.type === 'restart_request') {
        // Phone requested restart; call restartGame
        restartGame();
    }
}

function sendScoreToController() {
    if (peer && peer.connected) {
        peer.send(JSON.stringify({ type: 'score', value: score }));
    }
}

function startCountdown(duration = 3) {
    countdownValue = duration;
    sendScoreToController(); // send initial score when game starts
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
    // Every 200 points, the game gets slightly harder
    const level = Math.floor(score / 200);

    // VERY LOW STARTING CHANCE
    // Starts at 2% chance. Adds 0.2% per level.
    const spawnChance = 0.002 + (level * 0.002);

    // We only spawn if random is met AND we have fewer than 10 meteorites on screen
    // This "Population Cap" prevents the screen from being covered in red circles
    if (Math.random() < spawnChance && meteorites.length < 10) {

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
                sendScoreToController(); // send updated score to controller
                // Play explosion sound
                SoundManager.playExplosion();
                if (score > highScore) {
                    highScore = score;
                    localStorage.setItem('highScore', highScore);
                }
                break; // bullet destroyed, move to next bullet
            }
        }
    }

    // Game over condition: meteorite reached ship level (y position)
    for (let i = meteorites.length - 1; i >= 0; i--) {
        if (meteorites[i].y >= ship.y) {
            endGame();
            return;
        }
    }
}

function endGame() {
    gameOver = true;
    gameStarted = false; // Stop the game

    // Hide the QR code connection overlay
    const connectionOverlay = document.getElementById('connection-overlay');
    if (connectionOverlay) {
        connectionOverlay.classList.add('hidden');
    }

    // Send game over message to controller so it can show restart button
    if (peer && peer.connected) {
        peer.send(JSON.stringify({ type: 'game_over' }));
    }

    // Show the game over overlay with final score
    const gameOverOverlay = document.getElementById('game-over-overlay');
    const finalScoreSpan = document.getElementById('final-score');
    if (gameOverOverlay && finalScoreSpan) {
        finalScoreSpan.textContent = score;
        gameOverOverlay.classList.remove('hidden');
    }
}

function restartGame() {
    // Hide the game over overlay
    const gameOverOverlay = document.getElementById('game-over-overlay');
    if (gameOverOverlay) {
        gameOverOverlay.classList.add('hidden');
    }

    // Reset game state
    gameOver = false;
    score = 0;
    bullets.length = 0;
    meteorites.length = 0;
    ship.x = canvas.width / 2;

    // Music state is controlled solely by musicEnabled flag and button
    // Do not modify bgMusic playback here

    // Ensure connection overlay stays hidden if peer is still connected
    if (peer && peer.connected) {
        const connectionOverlay = document.getElementById('connection-overlay');
        if (connectionOverlay) {
            connectionOverlay.classList.add('hidden');
        }
    }

    sendScoreToController(); // send reset score to controller
    startCountdown(3); // Start 3-second countdown before game begins
}

function draw() {
    // Draw background image with aspect ratio preservation
    if (backgroundImg.complete) {
        const imgAspect = backgroundImg.width / backgroundImg.height;
        const canvasAspect = canvas.width / canvas.height;
        let drawWidth, drawHeight, drawX = 0, drawY = 0;

        // Calculate dimensions to fill canvas without distortion (like CSS background-size: cover)
        if (imgAspect > canvasAspect) {
            // Image is wider, scale by height
            drawHeight = canvas.height;
            drawWidth = drawHeight * imgAspect;
            drawX = (canvas.width - drawWidth) / 2;
        } else {
            // Image is taller, scale by width
            drawWidth = canvas.width;
            drawHeight = drawWidth / imgAspect;
            drawY = (canvas.height - drawHeight) / 2;
        }

        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(backgroundImg, drawX, drawY, drawWidth, drawHeight);
    } else {
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Ship
    if (rocketImg.complete) {
        // Draw rocket sprite, centered at ship position
        ctx.drawImage(rocketImg, ship.x - 100, ship.y - 100, 180, 180);
    } else {
        // Fallback: draw lime rectangle if sprite not loaded
        ctx.fillStyle = 'white';
        ctx.fillRect(ship.x - 20, ship.y, 40, 20);
    }

    // Bullets
    ctx.fillStyle = 'orange';
    bullets.forEach(b => ctx.fillRect(b.x - 2, b.y, 4, 10));

    // Meteorites
    meteorites.forEach(m => {
        if (meteoriteImg.complete) {
            // Draw meteorite sprite (48px wide x 245px tall), centered at position
            ctx.drawImage(meteoriteImg, m.x - 24, m.y - 122.5, 48, 245);
        } else {
            // Fallback: draw red circle if sprite not loaded
            ctx.fillStyle = 'red';
            ctx.beginPath();
            ctx.arc(m.x, m.y, 15, 0, Math.PI * 2);
            ctx.fill();
        }
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

    // Show waiting state while connected but not started
    if (peer && peer.connected && !gameStarted && countdownValue === 0 && !gameOver) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'white';
        ctx.font = '24px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('CONNECTED. ENABLE SENSORS ON PHONE TO START.', canvas.width / 2, canvas.height / 2);
        ctx.textAlign = 'left';
    }
}

// Add event listener for restart button
document.getElementById('restart-btn').addEventListener('click', restartGame);

gameLoop();
