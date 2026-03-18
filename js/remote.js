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

    peer.on('close', () => {
        console.log('WebRTC connection closed');
    });

    peer.on('error', err => {
        console.error('WebRTC error:', err);
    });
}

function startGyro() {
    window.addEventListener('deviceorientation', (e) => {
        if (peer && peer.connected) {
            peer.send(JSON.stringify({ type: 'move', x: e.beta }));
        }
    });
}

init();