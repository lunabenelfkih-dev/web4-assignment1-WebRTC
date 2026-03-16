let socket, pc, dataChannel;
const targetSocketId = new URLSearchParams(window.location.search).get('id');
const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

function init() {
    if (!targetSocketId) {
        alert('Missing ?id= in URL. Scan the QR code from the game screen.');
        return;
    }

    socket = io();

    // Signal handler must live inside init() — socket is undefined before this point
    socket.on('signal', async (fromId, data) => {
        if (data.type === 'answer') {
            await pc.setRemoteDescription(new RTCSessionDescription(data));
        } else if (data.type === 'candidate') {
            try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); }
            catch (e) { console.warn('ICE candidate error:', e); }
        }
    });

    socket.on('connect', startWebRTC);

    // Click/Touch to fire
    window.addEventListener('touchstart', () => {
        if (dataChannel?.readyState === 'open') {
            dataChannel.send(JSON.stringify({ type: 'fire' }));
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

async function startWebRTC() {
    pc = new RTCPeerConnection(RTC_CONFIG);
    dataChannel = pc.createDataChannel('controls');

    dataChannel.onopen = () => console.log('Data channel open — tilt to play!');
    dataChannel.onclose = () => console.log('Data channel closed');

    pc.onicecandidate = ({ candidate }) => {
        if (candidate) socket.emit('signal', targetSocketId, { type: 'candidate', candidate });
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('signal', targetSocketId, { type: 'offer', sdp: offer.sdp });
}

function startGyro() {
    window.addEventListener('deviceorientation', (e) => {
        if (dataChannel?.readyState === 'open') {
            dataChannel.send(JSON.stringify({ type: 'move', x: e.gamma }));
        }
    });
}

init();