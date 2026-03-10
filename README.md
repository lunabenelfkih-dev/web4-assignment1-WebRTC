# web4-assignment1-WebRTC

## Day 01 — The Concept

## Day 02 — Initial Setup

Set up the project repository and branch structure.

## Day 03 — Basic WebRTC + WebSocket Logic

Built a real-time peer-to-peer controller experience using WebRTC and WebSockets.

### What was built

| File | Role |
|---|---|
| `index.js` | Node.js / Express server + socket.io signalling relay |
| `public/index.html` | Desktop viewer — renders a ball moved by the controller |
| `public/controller.html` | Mobile / remote controller — sends input over a WebRTC data channel |


### Key implementation notes

- I mainly used the logic from the exercises that i had done in class to achieve this structure.


## Day 04 — Gyroscope control + HTTPS

### Gyroscope input

Replaced the touch/mouse input on the controller with the phone's gyroscope using the `DeviceOrientation` API:

- **`gamma`** (left/right tilt, −90° → 90°) maps to **x** (0 → 1)
- **`beta`** (forward/back tilt, −90° → 90°) maps to **y** (0 → 1)

The mapped values are sent as `{x, y}` over the WebRTC data channel, same format as before, so the desktop side needed no changes.

### iOS permission handling

iOS 13+ requires an explicit user gesture to grant `DeviceOrientationEvent` permission. A **"Tap to enable gyroscope"** button is shown on page load. When tapped, `DeviceOrientationEvent.requestPermission()` is called. On Android no permission is needed and the gyro starts automatically.

### HTTPS requirement

iOS Safari only grants gyroscope permission over **HTTPS**. A self-signed certificate (`key.pem` / `cert.pem`) was generated with `openssl` and the server was switched from `http.createServer` to `https.createServer`. Both files are excluded from git via `.gitignore`.

### Code from AI

**HTTPS server** (`index.js`) — switched from `http` to `https` with a self-signed cert:
```js
const https = require('https');
const fs = require('fs');
const server = https.createServer({
    key: fs.readFileSync('key.pem'),
    cert: fs.readFileSync('cert.pem')
}, app);
```

**Gyroscope input** (`controller.html`) — maps tilt angles to x/y and sends over the data channel:
```js
const sendGyro = (gamma, beta) => {
    if (!dataChannel || dataChannel.readyState !== 'open') return;
    const x = Math.min(1, Math.max(0, (gamma + 90) / 180));
    const y = Math.min(1, Math.max(0, (beta + 90) / 180));
    dataChannel.send(JSON.stringify({ x, y }));
};

const startGyro = () => {
    window.addEventListener('deviceorientation', e => sendGyro(e.gamma, e.beta));
    $enableGyro.textContent = 'Gyroscope active ✅';
    $enableGyro.disabled = true;
};

const requestGyroPermission = () => {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission()
            .then(state => {
                if (state === 'granted') startGyro();
                else $enableGyro.textContent = 'Permission denied';
            });
    } else {
        startGyro();
    }
};

$enableGyro.addEventListener('click', requestGyroPermission);
```

```js

    cert: fs.readFileSync('cert.pem')
}, app);
const { Server } = require('socket.io');
const io = new Server(server);

const port = 3000;

app.use(express.static('public'));

const clients = {};

io.on('connection', socket => {
    console.log(`Connected: ${socket.id}`);
    clients[socket.id] = { id: socket.id };

    socket.on('signal', (targetSocketId, data) => {
        if (!clients[targetSocketId]) {
            console.log(`Signal target not found: ${targetSocketId}`);
            return;
        }
        socket.to(targetSocketId).emit('signal', socket.id, data);
    });

    socket.on('disconnect', () => {
        console.log(`Disconnected: ${socket.id}`);
        delete clients[socket.id];
    });
});

server.listen(port, () => {
    console.log(`App listening on port ${port}`);
});
```

**`public/index.html`** (desktop viewer)
```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WebRTC Desktop Viewer</title>
</head>
<body>
    <div id="info">
        <div>Your socket id: <span id="socketId">...</span></div>
        <div>WebRTC: <span id="rtcStatus">Waiting for controller…</span></div>
        <div>Controller URL: <span id="url">...</span></div>
        <div id="qr"></div>
    </div>
    <div class="cursor" id="cursor"></div>
    <script src="/socket.io/socket.io.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"></script>
    <script>
        const $cursor = document.getElementById('cursor');
        const $socketId = document.getElementById('socketId');
        const $rtcStatus = document.getElementById('rtcStatus');
        const $url = document.getElementById('url');
        const $qr = document.getElementById('qr');

        let socket;
        let pc;

        const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

        const updateCursor = data => {
            $cursor.style.left = `${data.x * window.innerWidth}px`;
            $cursor.style.top = `${data.y * window.innerHeight}px`;
        };

        const showControllerUrl = (id) => {
            const url = new URL(`/controller.html?id=${id}`, window.location);
            $url.textContent = url;
            const qr = qrcode(4, 'L');
            qr.addData(url.toString());
            qr.make();
            $qr.innerHTML = qr.createImgTag(4);
        };

        const setupPeerConnection = (remoteSocketId) => {
            pc = new RTCPeerConnection(RTC_CONFIG);
            pc.onicecandidate = ({ candidate }) => {
                if (candidate) socket.emit('signal', remoteSocketId, { type: 'candidate', candidate });
            };
            pc.onconnectionstatechange = () => {
                $rtcStatus.textContent = `WebRTC: ${pc.connectionState}`;
            };
            pc.ondatachannel = ({ channel }) => {
                channel.onmessage = ({ data }) => updateCursor(JSON.parse(data));
            };
        };

        const init = () => {
            socket = io.connect('/');
            socket.on('connect', () => {
                $socketId.textContent = socket.id;
                showControllerUrl(socket.id);
            });
            socket.on('signal', async (remoteSocketId, data) => {
                if (!pc) setupPeerConnection(remoteSocketId);
                if (data.type === 'offer') {
                    await pc.setRemoteDescription(new RTCSessionDescription(data));
                    const answer = await pc.createAnswer();
                    await pc.setLocalDescription(answer);
                    socket.emit('signal', remoteSocketId, { type: 'answer', sdp: answer.sdp });
                } else if (data.type === 'candidate') {
                    await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
                }
            });
        };
        init();
    </script>
</body>
</html>
```

**`public/controller.html`** (mobile gyroscope controller)
```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WebRTC Controller</title>
</head>
<body>
    <h1>WebRTC Controller</h1>
    <p>Status: <span id="status">Connecting to server…</span></p>
    <p>WebRTC: <span id="rtcStatus">Idle</span></p>
    <p id="instructions" style="display:none">Tilt your phone left/right and forward/back to move the ball.</p>
    <button id="enableGyro" style="padding:1rem 2rem; font-size:1.2rem">Tap to enable gyroscope</button>
    <script src="/socket.io/socket.io.js"></script>
    <script>
        const $status = document.getElementById('status');
        const $rtcStatus = document.getElementById('rtcStatus');
        const $instructions = document.getElementById('instructions');
        const $enableGyro = document.getElementById('enableGyro');

        let socket, pc, dataChannel, targetSocketId;

        const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

        const getUrlParam = name => {
            name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
            const regex = new RegExp('[\\?&]' + name + '=([^&#]*)');
            const results = regex.exec(location.search);
            return results === null ? false : decodeURIComponent(results[1].replace(/\+/g, ' '));
        };

        const sendGyro = (gamma, beta) => {
            if (!dataChannel || dataChannel.readyState !== 'open') return;
            const x = Math.min(1, Math.max(0, (gamma + 90) / 180));
            const y = Math.min(1, Math.max(0, (beta + 90) / 180));
            dataChannel.send(JSON.stringify({ x, y }));
        };

        const startGyro = () => {
            window.addEventListener('deviceorientation', e => sendGyro(e.gamma, e.beta));
            $enableGyro.textContent = 'Gyroscope active ✅';
            $enableGyro.disabled = true;
        };

        const requestGyroPermission = () => {
            if (typeof DeviceOrientationEvent !== 'undefined' &&
                typeof DeviceOrientationEvent.requestPermission === 'function') {
                DeviceOrientationEvent.requestPermission()
                    .then(state => {
                        if (state === 'granted') startGyro();
                        else $enableGyro.textContent = 'Permission denied';
                    });
            } else {
                startGyro();
            }
        };

        $enableGyro.addEventListener('click', requestGyroPermission);

        const startWebRTC = async () => {
            pc = new RTCPeerConnection(RTC_CONFIG);
            dataChannel = pc.createDataChannel('controls');
            dataChannel.onopen = () => {
                $rtcStatus.textContent = 'Data channel open — tilt to control!';
                $instructions.style.display = 'block';
            };
            pc.onicecandidate = ({ candidate }) => {
                if (candidate) socket.emit('signal', targetSocketId, { type: 'candidate', candidate });
            };
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('signal', targetSocketId, { type: 'offer', sdp: offer.sdp });
        };

        const init = () => {
            targetSocketId = getUrlParam('id');
            if (!targetSocketId) { alert('Missing target ID'); return; }
            socket = io.connect('/');
            socket.on('connect', () => {
                $status.textContent = `Connected (${socket.id})`;
                startWebRTC();
            });
            socket.on('signal', async (_, data) => {
                if (data.type === 'answer') {
                    await pc.setRemoteDescription(new RTCSessionDescription(data));
                } else if (data.type === 'candidate') {
                    await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
                }
            });
        };
        init();
    </script>
</body>
</html>
```
## Day 05 — Refactoring Code 

Re-organised the code a bit so it's more clear and easier to use. For example put the js in separate files.

## Day 06 — Falling stuff logic

Worked on a basic implementation for the falling stuff logic. 

### code from AI
Here is the basic logic from AI that was later implemented into game.js. This code handles the initialization, movement, and drawing of the falling meteorites:

```js
// 1. INITIALIZATION: The container for all active meteorites
const meteorites = [];

function update() {
    // 2. SPAWNING LOGIC: Decides when to create a new meteorite
    // Math.random() < 0.03 creates a ~3% chance per frame (about 2 per second)
    if (Math.random() < 0.03) {
        meteorites.push({ 
            x: Math.random() * canvas.width, // Random horizontal start
            y: -20,                          // Start just above the top edge
            s: 2 + Math.random() * 3         // Random speed between 2 and 5 pixels/frame
        });
    }

    // 3. MOVEMENT LOGIC: Updates the position of every meteorite in the list
    meteorites.forEach(m => {
        m.y += m.s; // Add the speed to the vertical position to make it fall
    });
}

function draw() {
    // 4. RENDERING LOGIC: Draws each meteorite as a red circle on the canvas
    ctx.fillStyle = 'red'; 
    meteorites.forEach(m => {
        ctx.beginPath();
        // ctx.arc(x, y, radius, startAngle, endAngle)
        ctx.arc(m.x, m.y, 15, 0, Math.PI * 2); 
        ctx.fill();
    });
}
```