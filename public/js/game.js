const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let peer = null;

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;


const backgroundImg = new Image();
backgroundImg.src = '/assets/background.svg';

const meteoriteImg = new Image();
meteoriteImg.src = '/assets/meteorite.svg';

const rocketImg = new Image();
rocketImg.src = '/assets/rocket.svg';


let audioUnlocked = false;
let musicEnabled = false;

function createAudioPool(src, count, volume) {
    return Array(count).fill(null).map(() => {
        const audio = new Audio(src);
        audio.volume = volume;
        audio.preload = 'auto';
        return audio;
    });
}

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
let countdownValue = 0;

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
    const gameOverOverlay = document.getElementById('game-over-overlay');
    if (gameOverOverlay) {
        gameOverOverlay.classList.add('hidden');
    }

    gameStarted = false;
    gameOver = false;
    countdownValue = 0;

    bullets.length = 0;
    meteorites.length = 0;

    const connectionOverlay = document.getElementById('connection-overlay');
    if (connectionOverlay) {
        connectionOverlay.classList.remove('hidden');
    }
}

function handleRemoteInput(rawData) {
    const msg = JSON.parse(rawData);

    if (msg.type === 'move') {
        if (msg.x === null || msg.x === undefined) return; // sensor returned null, ignore
        const clampedBeta = Math.min(45, Math.max(-45, msg.x));
        const normalised = Math.min(1, Math.max(0, (clampedBeta + 45) / 90));
        ship.x = normalised * canvas.width;
    } else if (msg.type === 'fire') {
        bullets.push({ x: ship.x - 10, y: ship.y - 100 });
    } else if (msg.type === 'gyro_ready') {
        startCountdown(3);
    } else if (msg.type === 'restart_request') {
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
    sendScoreToController();
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
    if (gameStarted && !gameOver) {
        update();
    }
    draw();
    requestAnimationFrame(gameLoop);
}

function update() {
    for (let i = 0; i < bullets.length; i++) {
        bullets[i].y -= 10;
    }
    for (let i = bullets.length - 1; i >= 0; i--) {
        if (bullets[i].y < 0) bullets.splice(i, 1);
    }

    
    const level = Math.floor(score / 200);
    const spawnChance = 0.002 + (level * 0.002);


    if (Math.random() < spawnChance && meteorites.length < 4) {

       
        const baseSpeed = 1.0 + (level * 0.5);
        const maxSpeed = 3.5 + (level * 0.8);
        const speed = baseSpeed + Math.random() * (maxSpeed - baseSpeed);

        meteorites.push({
            x: Math.random() * canvas.width,
            y: -20,
            s: Math.min(speed, 7) 
        });
    }

    for (let i = 0; i < meteorites.length; i++) {
        meteorites[i].y += meteorites[i].s;
    }

    for (let i = meteorites.length - 1; i >= 0; i--) {
        if (meteorites[i].y > canvas.height) meteorites.splice(i, 1);
    }

    for (let i = bullets.length - 1; i >= 0; i--) {
        for (let j = meteorites.length - 1; j >= 0; j--) {
            const dist = Math.hypot(bullets[i].x - meteorites[j].x, bullets[i].y - meteorites[j].y);
            if (dist < 20) { 
                meteorites.splice(j, 1);
                bullets.splice(i, 1);
                score += 10; 
                sendScoreToController(); 
                SoundManager.playExplosion();
                if (score > highScore) {
                    highScore = score;
                    localStorage.setItem('highScore', highScore);
                }
                break; 
            }
        }
    }

    // game over
    for (let i = meteorites.length - 1; i >= 0; i--) {
        if (meteorites[i].y >= ship.y) {
            endGame();
            return;
        }
    }
}

function endGame() {
    gameOver = true;
    gameStarted = false;

    const connectionOverlay = document.getElementById('connection-overlay');
    if (connectionOverlay) {
        connectionOverlay.classList.add('hidden');
    }

    if (peer && peer.connected) {
        peer.send(JSON.stringify({ type: 'game_over' }));
    }

    const gameOverOverlay = document.getElementById('game-over-overlay');
    const finalScoreSpan = document.getElementById('final-score');
    if (gameOverOverlay && finalScoreSpan) {
        finalScoreSpan.textContent = score;
        gameOverOverlay.classList.remove('hidden');
    }
}

function restartGame() {
    const gameOverOverlay = document.getElementById('game-over-overlay');
    if (gameOverOverlay) {
        gameOverOverlay.classList.add('hidden');
    }

    gameOver = false;
    score = 0;
    bullets.length = 0;
    meteorites.length = 0;
    ship.x = canvas.width / 2;

    if (peer && peer.connected) {
        const connectionOverlay = document.getElementById('connection-overlay');
        if (connectionOverlay) {
            connectionOverlay.classList.add('hidden');
        }
    }

    sendScoreToController();
    startCountdown(3);
}

function draw() {
    if (backgroundImg.complete) {
        const imgAspect = backgroundImg.width / backgroundImg.height;
        const canvasAspect = canvas.width / canvas.height;
        let drawWidth, drawHeight, drawX = 0, drawY = 0;

        if (imgAspect > canvasAspect) {
            drawHeight = canvas.height;
            drawWidth = drawHeight * imgAspect;
            drawX = (canvas.width - drawWidth) / 2;
        } else {
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
        ctx.drawImage(rocketImg, ship.x - 100, ship.y - 100, 180, 180);
    } else {
        // fallback
        ctx.fillStyle = 'white';
        ctx.fillRect(ship.x - 20, ship.y, 40, 20);
    }

    // Bullets
    ctx.fillStyle = 'orange';
    bullets.forEach(b => ctx.fillRect(b.x - 2, b.y, 4, 10));

    // Meteorites
    meteorites.forEach(m => {
        if (meteoriteImg.complete) {
            ctx.drawImage(meteoriteImg, m.x - 24, m.y - 122.5, 48, 245);
        } else {
            // fallback
            ctx.fillStyle = 'red';
            ctx.beginPath();
            ctx.arc(m.x, m.y, 15, 0, Math.PI * 2);
            ctx.fill();
        }
    });

    ctx.fillStyle = 'white';
    ctx.font = '20px Arial';
    ctx.fillText(`Score: ${score}`, 20, 30);
    ctx.fillText(`High Score: ${highScore}`, 20, 60);

    if (countdownValue > 0 && !gameStarted) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'white';
        ctx.font = 'bold 120px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(countdownValue, canvas.width / 2, canvas.height / 2);
        ctx.textAlign = 'left';
    }

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

document.getElementById('restart-btn').addEventListener('click', restartGame);

gameLoop();
