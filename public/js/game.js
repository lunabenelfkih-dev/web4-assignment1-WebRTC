const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let peer = null;

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
const ship = { x: canvas.width / 2, y: canvas.height - 80, size: 40 };
const bullets = [];
const meteorites = [];

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

function gameLoop() {
    update();
    draw();
    requestAnimationFrame(gameLoop);
}

function update() {
    // Move bullets upward and remove any that have left the top of the canvas
    for (let i = bullets.length - 1; i >= 0; i--) {
        bullets[i].y -= 10;
        if (bullets[i].y < -10) bullets.splice(i, 1);
    }

    // Randomly spawn meteorites
    if (Math.random() < 0.03) {
        meteorites.push({ x: Math.random() * canvas.width, y: -20, s: 2 + Math.random() * 3 });
    }

    // Move meteorites downward; remove any that have left the bottom of the canvas
    for (let i = meteorites.length - 1; i >= 0; i--) {
        meteorites[i].y += meteorites[i].s;
        if (meteorites[i].y > canvas.height + 30) meteorites.splice(i, 1);
    }
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
}

gameLoop();
