const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const $status = document.getElementById('status');

// WebRTC State
let pc;
// No STUN needed — phone and PC are on the same LAN
const RTC_CONFIG = {};

/**
 * Resolves when ICE gathering reaches 'complete', or after 3 seconds —
 * whichever comes first. LAN (host) candidates are gathered in <100 ms;
 * the timeout only fires if the browser is waiting on an unreachable STUN server.
 */
function waitForIceGathering(pc) {
    return new Promise(resolve => {
        if (pc.iceGatheringState === 'complete') { resolve(); return; }
        const timer = setTimeout(resolve, 3000);
        pc.addEventListener('icegatheringstatechange', () => {
            if (pc.iceGatheringState === 'complete') {
                clearTimeout(timer);
                resolve();
            }
        });
    });
}

// Game State
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
const ship = { x: canvas.width / 2, y: canvas.height - 80, size: 40 };
const bullets = [];
const meteorites = [];

// ── 1. WebRTC Signaling ────────────────────────────────────────────────────────

socket.on('connect', () => {
    // Update both the game UI and the #info panel
    const $idDisplay = document.getElementById('id-display');
    if ($idDisplay) $idDisplay.textContent = `ID: ${socket.id}`;

    const $socketId = document.getElementById('socketId');
    if ($socketId) $socketId.textContent = socket.id;

    showControllerUrl(socket.id);
});

/**
 * controller URL and QR code popup
 * Requires the qrcode-generator library to be loaded before game.js.
 */
function showControllerUrl(id) {
    const $rtcStatus = document.getElementById('rtcStatus');
    const $url = document.getElementById('url');
    const $qr = document.getElementById('qr');

    const url = new URL(`/controller.html?id=${id}`, window.location);
    if ($url) $url.textContent = url;
    if ($rtcStatus) $rtcStatus.textContent = 'Waiting for controller…';

    if ($qr && typeof qrcode !== 'undefined') {
        const qr = qrcode(4, 'L');
        qr.addData(url.toString());
        qr.make();
        $qr.innerHTML = qr.createImgTag(4);
    }
}

socket.on('signal', async (fromId, data) => {
    if (!pc) createPeerConnection(fromId);

    if (data.type === 'offer') {
        const $rtcStatus = document.getElementById('rtcStatus');
        if ($rtcStatus) $rtcStatus.textContent = 'Offer received — gathering ICE…';

        await pc.setRemoteDescription(new RTCSessionDescription(data));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        // Wait until all our candidates are gathered, then send one complete answer
        await waitForIceGathering(pc);
        socket.emit('signal', fromId, pc.localDescription);

        if ($rtcStatus) $rtcStatus.textContent = 'Answer sent — waiting for data channel…';
    }
    // No 'candidate' handling needed — all candidates are embedded in the SDP
});

function createPeerConnection(targetId) {
    pc = new RTCPeerConnection(RTC_CONFIG);

    // No trickle ICE — candidates are embedded in the SDP, so onicecandidate is unused
    pc.onicecandidate = () => { };

    pc.oniceconnectionstatechange = () => {
        console.log('[game] ICE:', pc.iceConnectionState);
        const $rtcStatus = document.getElementById('rtcStatus');
        if ($rtcStatus) $rtcStatus.textContent = `ICE: ${pc.iceConnectionState}`;
    };

    pc.onconnectionstatechange = () => {
        const $rtcStatus = document.getElementById('rtcStatus');
        if ($rtcStatus) $rtcStatus.textContent = `WebRTC: ${pc.connectionState}`;
    };

    // The controller (offerer) creates the data channel; we receive it here
    pc.ondatachannel = ({ channel }) => {
        channel.onmessage = handleRemoteInput;

        const onOpen = () => {
            if ($status) $status.textContent = 'Controller Connected!';
            const $rtcStatus = document.getElementById('rtcStatus');
            if ($rtcStatus) $rtcStatus.textContent = 'Data channel open — playing!';
            const overlay = document.getElementById('connection-overlay');
            if (overlay) overlay.classList.add('hidden');
        };

        // The channel may already be open by the time ondatachannel fires
        if (channel.readyState === 'open') {
            onOpen();
        } else {
            channel.onopen = onOpen;
        }

        channel.onclose = () => {
            if ($status) $status.textContent = 'Controller disconnected';
            const overlay = document.getElementById('connection-overlay');
            if (overlay) overlay.classList.remove('hidden');
        };
    };
}

// ── 2. Handle commands from the phone ─────────────────────────────────────────

function handleRemoteInput(e) {
    const msg = JSON.parse(e.data);

    if (msg.type === 'move') {
        if (msg.x === null || msg.x === undefined) return; // sensor returned null, ignore
        // msg.x is raw gamma (-90..90); map to canvas width, clamped to [0, canvas.width]
        const normalised = Math.min(1, Math.max(0, (msg.x + 90) / 180));
        ship.x = normalised * canvas.width;
    } else if (msg.type === 'fire') {
        bullets.push({ x: ship.x, y: ship.y - 20 });
    }
}

// ── 3. Game Loop ───────────────────────────────────────────────────────────────

function gameLoop() {
    update();
    draw();
    requestAnimationFrame(gameLoop);
}

function update() {
    // Move bullets upward; remove any that have left the top of the canvas
    for (let i = bullets.length - 1; i >= 0; i--) {
        bullets[i].y -= 10;
        if (bullets[i].y < -10) bullets.splice(i, 1);
    }

    // Randomly spawn a meteorite
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
