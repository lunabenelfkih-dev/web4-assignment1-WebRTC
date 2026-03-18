let socket, peer;
const targetSocketId = new URLSearchParams(window.location.search).get('id');

function init() {
    if (!targetSocketId) {
        alert('Missing ?id= in URL. Scan the QR code from the game screen.');
        return;
    }

    socket = io();

    socket.on('signal', (fromId, data) => {
        if (peer) {
            peer.signal(data);
        }
    });

    socket.on('connect', startWebRTC);

    window.addEventListener('touchstart', () => {
        if (peer && peer.connected) {
            peer.send(JSON.stringify({ type: 'fire' }));
        }
    }, { passive: true });

    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
        const btn = document.createElement('button');
        btn.textContent = 'Tap to enable gyroscope';
        btn.classList.add('gyro-permission-btn');
        document.body.appendChild(btn);
        btn.addEventListener('click', () => {
            DeviceOrientationEvent.requestPermission()
                .then(state => {
                    if (state === 'granted') startGyro();
                    btn.remove();
                })
                .catch(console.error);
        });
    } else {
        startGyro();
    }
}

function startWebRTC() {
    peer = new SimplePeer({ initiator: true, trickle: false });

    peer.on('signal', data => {
        socket.emit('signal', targetSocketId, data);
    });

    peer.on('connect', () => {
        console.log('WebRTC connected — tilt to play!');
    });

    peer.on('data', rawData => {
        try {
            const data = JSON.parse(rawData);
            if (data.type === 'game_over') {
                showGameOverScreen();
            }
        } catch (e) {
        }
    });

    peer.on('close', () => {
        console.log('WebRTC connection closed');
    });

    peer.on('error', err => {
        console.error('WebRTC error:', err);
    });
}

function showGameOverScreen() {
    const overlay = document.createElement('div');
    overlay.id = 'game-over-screen';
    overlay.classList.add('game-over-overlay');

    const title = document.createElement('h1');
    title.textContent = 'GAME OVER';
    overlay.appendChild(title);

    const btn = document.createElement('button');
    btn.textContent = 'RESTART';
    btn.classList.add('game-over-restart-btn');
    btn.addEventListener('click', () => {
        overlay.remove();
        if (peer && peer.connected) {
            peer.send(JSON.stringify({ type: 'restart_request' }));
        }
    });
    overlay.appendChild(btn);

    document.body.appendChild(overlay);
}

function startGyro() {
    window.addEventListener('deviceorientation', (e) => {
        if (peer && peer.connected) {
            const roundedBeta = Math.round(event.beta);
            peer.send(JSON.stringify({ type: 'move', x: roundedBeta }));
        }
    });
}

init();