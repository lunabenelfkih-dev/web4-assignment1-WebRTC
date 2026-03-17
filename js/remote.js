let socket, peer;
const targetSocketId = new URLSearchParams(window.location.search).get('id');

function init() {
    if (!targetSocketId) {
        alert('Missing ?id= in URL. Scan the QR code from the game screen.');
        return;
    }

    socket = io();

    // Signal handler for incoming WebRTC signals
    socket.on('signal', (fromId, data) => {
        if (peer) {
            peer.signal(data);
        }
    });

    socket.on('connect', startWebRTC);

    // Click/Touch to fire
    window.addEventListener('touchstart', () => {
        if (peer && peer.connected) {
            peer.send(JSON.stringify({ type: 'fire' }));
        }
    }, { passive: true });

    // iOS 13+ requires a user-gesture permission request for DeviceOrientationEvent
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
        // Create a one-time button so the user can grant permission
        const btn = document.createElement('button');
        btn.textContent = 'Tap to enable gyroscope';
        btn.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);padding:1rem 2rem;font-size:1.2rem';
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
            // Ignore parse errors
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
    // Create full-screen game over overlay with RESTART button
    const overlay = document.createElement('div');
    overlay.id = 'game-over-screen';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(5,12,18,0.95);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9999;color:white;text-align:center;';

    const title = document.createElement('h1');
    title.textContent = 'GAME OVER';
    title.style.cssText = 'font-size:3rem;margin:0 0 2rem;font-weight:bold;letter-spacing:2px;';
    overlay.appendChild(title);

    const btn = document.createElement('button');
    btn.textContent = 'RESTART';
    btn.style.cssText = 'padding:1.5rem 3rem;font-size:1.5rem;font-weight:bold;letter-spacing:2px;text-transform:uppercase;background:linear-gradient(135deg,#ff7c00,#ea580c);color:white;border:3px solid rgba(234,88,12,0.8);border-radius:12px;cursor:pointer;box-shadow:0 0 30px rgba(255,124,0,0.5);';
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
            // Use beta for landscape mode tilt (left/right rotation)
            peer.send(JSON.stringify({ type: 'move', x: e.beta }));
        }
    });
}

init();