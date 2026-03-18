const $status = document.getElementById('status');
const $rtcStatus = document.getElementById('rtcStatus');
const $instructions = document.getElementById('instructions');
const $startButton = document.getElementById('start-button');
const $statusMessage = document.getElementById('status-message');
const $gyroDebug = document.getElementById('gyro-debug');
const $portraitWarning = document.getElementById('portrait-warning');
const $startOverlay = document.getElementById('start-overlay');
const $controllerUi = document.getElementById('controller-ui');
const $tiltBar = document.getElementById('tilt-bar');
const $gameOverOverlayPhone = document.getElementById('game-over-overlay-phone');
const $finalScorePhone = document.getElementById('final-score-phone');
const $playAgainBtn = document.getElementById('play-again-btn');

let lastSendTime = 0;
let socket;
let peer;
let targetSocketId;
let gyroActive = false;

const lazerSound = new Audio('/assets/sounds/lazer.mp3');
lazerSound.preload = 'auto';
lazerSound.volume = 0.2;

const getUrlParam = name => {
    name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
    const regex = new RegExp('[\\?&]' + name + '=([^&#]*)');
    const results = regex.exec(location.search);
    return results === null ? false : decodeURIComponent(results[1].replace(/\+/g, ' '));
};

const sendGyro = (beta) => {
    $gyroDebug.textContent = `Beta: ${beta !== null ? beta.toFixed(1) + '°' : 'null (sensor not ready)'}`;
    if (beta === null || beta === undefined) return;
    if (!peer || !peer.connected) return;

    if ($tiltBar) {
        const clampedBeta = Math.min(45, Math.max(-45, beta));
        const tiltPercent = ((clampedBeta + 45) / 90) * 100;
        $tiltBar.style.setProperty('--tilt-width', tiltPercent + '%');
    }

    const now = Date.now();
    if (now - lastSendTime < 50) return;
    lastSendTime = now;

    peer.send(JSON.stringify({ type: 'move', x: beta }));
};

const startWebRTC = () => {
    peer = new SimplePeer({ initiator: true, trickle: false });
    $rtcStatus.textContent = 'Connecting — gathering ICE…';

    peer.on('signal', data => {
        socket.emit('signal', targetSocketId, data);
        $rtcStatus.textContent = 'Offer sent — waiting for answer…';
    });

    peer.on('connect', () => {
        $rtcStatus.textContent = 'Connected — tilt to control!';
        $instructions.style.display = 'block';
    });

    peer.on('data', rawData => {
        try {
            const data = JSON.parse(rawData);
            if (data.type === 'score') {
                const scoreDisplay = document.getElementById('score-display');
                if (scoreDisplay) {
                    scoreDisplay.textContent = `SCORE: ${data.value}`;
                }
            } else if (data.type === 'game_over') {
                if ($gameOverOverlayPhone) {
                    $gameOverOverlayPhone.classList.add('active');
                }
            }
        } catch (e) {
        }
    });

    peer.on('close', () => {
        $rtcStatus.textContent = 'Connection closed';
        $instructions.style.display = 'none';
    });

    peer.on('error', err => {
        console.error('[controller] peer error:', err);
        $rtcStatus.textContent = `Error: ${err.message}`;
    });
};

const startGyro = () => {
    window.addEventListener('deviceorientation', e => {
        sendGyro(e.beta);
    });
    $startButton.textContent = 'Gyroscope active ✅';
    $startButton.disabled = true;
    gyroActive = true;
    checkOrientation();
};

const checkOrientation = () => {
    if (window.innerHeight > window.innerWidth) {
        if (gyroActive) {
            $portraitWarning.classList.add('active');
            $controllerUi.classList.remove('active');
            $startOverlay.classList.remove('active');
        }
    } else {
        $portraitWarning.classList.remove('active');
        if (gyroActive) {
            $controllerUi.classList.add('active');
            $startOverlay.classList.remove('active');
        }
    }
};

window.addEventListener('orientationchange', checkOrientation);
window.addEventListener('resize', checkOrientation);

const requestGyroPermission = () => {
    $startButton.disabled = true;
    $statusMessage.textContent = 'Requesting permissions...';

    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {

        DeviceOrientationEvent.requestPermission()
            .then(state => {
                if (state === 'granted') {
                    $statusMessage.textContent = '';
                    startGyro();
                    checkOrientation();
                    if (peer && peer.connected) {
                        peer.send(JSON.stringify({ type: 'gyro_ready' }));
                    }
                } else {
                    $startButton.textContent = 'Permission denied - try again';
                    $startButton.disabled = false;
                    $statusMessage.textContent = 'Permission was denied';
                }
            })
            .catch(err => {
                console.error('Permission error:', err);
                $startButton.textContent = 'Error - try again';
                $startButton.disabled = false;
                $statusMessage.textContent = 'Error requesting permission';
            });
    } else {
        $statusMessage.textContent = '';
        startGyro();
        checkOrientation();
        if (peer && peer.connected) {
            peer.send(JSON.stringify({ type: 'gyro_ready' }));
        }
    }
};

$startButton.addEventListener('click', requestGyroPermission);

$playAgainBtn.addEventListener('click', () => {
    if ($gameOverOverlayPhone) {
        $gameOverOverlayPhone.classList.remove('active');
    }
    if (peer && peer.connected) {
        peer.send(JSON.stringify({ type: 'restart_request' }));
    }
});

const init = () => {
    targetSocketId = getUrlParam('id');

    if (!targetSocketId) {
        alert('Missing target desktop ID in the URL.\nExample: /controller.html?id=<desktop-socket-id>');
        return;
    }

    window.addEventListener('touchstart', () => {
        if (!peer || !peer.connected) return;
        lazerSound.cloneNode(true).play().catch(() => { });
        peer.send(JSON.stringify({ type: 'fire' }));
    }, { passive: true });

    socket = io.connect('/');

    socket.on('connect', () => {
        $status.textContent = `Connected (${socket.id})`;
        startWebRTC();
    });

    socket.on('disconnect', () => {
        $status.textContent = 'Disconnected';
    });

    socket.on('signal', (remoteSocketId, data) => {
        peer.signal(data);
        $rtcStatus.textContent = 'Answer received — finalising…';
    });
};

init();