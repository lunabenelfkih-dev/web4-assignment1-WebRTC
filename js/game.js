const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const $status = document.getElementById('status');

// WebRTC State
let pc;
const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// Game State
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
const ship = { x: canvas.width / 2, y: canvas.height - 80, size: 40 };
const bullets = [];
const meteorites = [];

// 1. WebRTC Signaling Logic
socket.on('connect', () => {
    document.getElementById('id-display').textContent = `ID: ${socket.id}`;
});

socket.on('signal', async (fromId, data) => {
    if (!pc) createPeerConnection(fromId);

    if (data.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(data));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('signal', fromId, { type: 'answer', sdp: answer.sdp });
    } else if (data.type === 'candidate') {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
});

function createPeerConnection(targetId) {
    pc = new RTCPeerConnection(RTC_CONFIG);
    pc.onicecandidate = ({ candidate }) => {
        if (candidate) socket.emit('signal', targetId, { type: 'candidate', candidate });
    };
    pc.ondatachannel = (event) => {
        const channel = event.channel;
        channel.onmessage = handleRemoteInput;
        channel.onopen = () => $status.textContent = "Controller Connected!";
    };
}

// 2. Handle commands coming from the phone
function handleRemoteInput(e) {
    const msg = JSON.parse(e.data);
    if (msg.type === 'move') {
        // Map tilt (gamma -90 to 90) to screen width
        ship.x = ((msg.x + 90) / 180) * canvas.width;
    } else if (msg.type === 'fire') {
        bullets.push({ x: ship.x, y: ship.y - 20 });
    }
}

// 3. Simple Space Game Loop
function gameLoop() {
    update();
    draw();
    requestAnimationFrame(gameLoop);
}

function update() {
    bullets.forEach((b, i) => b.y -= 10);
    if (Math.random() < 0.03) meteorites.push({ x: Math.random() * canvas.width, y: -20, s: 2 + Math.random() * 3 });
    meteorites.forEach(m => m.y += m.s);
}

function draw() {
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw Ship
    ctx.fillStyle = 'lime';
    ctx.fillRect(ship.x - 20, ship.y, 40, 20);

    // Draw Bullets
    ctx.fillStyle = 'yellow';
    bullets.forEach(b => ctx.fillRect(b.x - 2, b.y, 4, 10));

    // Draw Meteorites
    ctx.fillStyle = 'red';
    meteorites.forEach(m => ctx.beginPath() || ctx.arc(m.x, m.y, 15, 0, Math.PI * 2) || ctx.fill());
}

gameLoop();