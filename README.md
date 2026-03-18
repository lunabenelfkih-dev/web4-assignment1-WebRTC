# web4-assignment1-WebRTC

## Day 00 - Planning

| Date | Topic | Description | Status |
| :--- | :--- | :--- | :---: |
| **February 28** | **Gyroscope** | Look into how to implement gyroscope logic | ✅ |
| **March 1** | **Make a ball move** | Make a ball move on the screen with the gyroscope | ✅ |
| **March 2** | **Prepare for consult** | Fix issues - Issue with gyroscope on Iphone| ✅ |
| **March 6** | **Refactor code** | Clean up the code so the game will go easier. | ✅ |
| **March 8** | **Falling stuff logic** | Start implementing the falling stuff logic | ✅ |
| **March 10** | **UX & Connection** | Create a connection overlay in `game.js` that auto-hides the qr code when a phone is connected. | ✅ |
| **March 11** | **Optimize game js** | Optimize `game.js` |  |
| **March 12** | **Core Gameplay** | Implement collision detection to destroy meteorites and bullets upon impact. | ✅ |
| **March 13** | **Scoring System** | Add global `score` state. Render current score to Canvas. | ✅ |
| **March 14** | **Game over** | Create a "Game Over" state that stops the loop and restores the connection overlay to restart. | ✅ |
| **March 15** | **Start gyro** | Add a "Start" button to handle gyro permissions and make it's style cleaner. | ✅ |
| **March 16** | **Visual Polish** | Replace primitive circles images | ✅  |
| **March 17** | **MILESTONE** | **End-to-End Testing:** Conduct full gameplay sessions to ensure the WebRTC DataChannel remains stable and the game loop is bug-free. | ✅ |
| **March 18** | **Optimization** | Optimise where needed. If time, implement extras. |  |
| **March 19** | **Extra** | Implement more extra features if time. |  |
| **March 22** | **FINAL DEADLINE** | Final code cleanup: remove all unecessary code, verify documentation, and prepare the final project submission. |  |

## Extra
- haptic feedback when firing or when catching a meteorite
- sound when firing, when touching meteorite, when game over, and background music
- webcam 

## Day 01 — Concept
### WebRTC Space Interceptor

The game is a cross-device arcade shooter where your desktop browser serves as the high-resolution game screen, and your smartphone acts as a wireless controller.

#### 1. The Hardware Roles

The Viewer (PC): Displays the actual game screen. A spaceship is positioned at the bottom of the screen, while alien ships and meteorites fall from the top. It handles all physics, collision detection, and scorekeeping.

The Controller (Phone): Becomes a physical extension of the spaceship. By utilizing the phone’s built-in gyroscope and touchscreen, the player interacts with the game without needing a keyboard or mouse.

#### 2. Core Mechanics

Motion Control: The spaceship's horizontal movement is mapped to the phone's tilt (gamma angle). Tilting the phone left or right moves the ship across the bottom of the PC screen in real-time.

Tactile Firing: Tapping the phone’s screen sends an instant "fire" command to the PC, triggering a laser blast from the spaceship to destroy incoming threats.

Objective: Players must intercept and destroy falling meteorites and alien ships. The goal is to survive as long as possible while accumulating a high score.

#### 3. The Technology (WebRTC + WebSockets)

Signaling: When the game starts, the PC generates a QR Code. Scanning this with a phone uses WebSockets to connect.

Peer-to-Peer Data: Once connected, the devices switch to a WebRTC DataChannel. This allows movement and firing data to travel directly from the phone to the PC with near-zero lag, ensuring the spaceship feels responsive during intense gameplay.

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
## Day 07 — Optimize game.js

Updated the loop from game.js to remove the bullets and meteorites from the arrays to prevent memory issues and lagging. There's no need for the array to keep all of them at all times. Bullets and meteorites will be removed when they go out of the screen.

## Day 08 — Detect overlapping and delete meteorites and bullets

### code from AI
I looked up how to check collision through JS and found that i could do so through `hypot()`. I then used AI to help me to implement this.

```js
    // Collision detection: bullets vs meteorites
    for (let i = bullets.length - 1; i >= 0; i--) {
        for (let j = meteorites.length - 1; j >= 0; j--) {
            const dist = Math.hypot(bullets[i].x - meteorites[j].x, bullets[i].y - meteorites[j].y);
            if (dist < 20) { // collision threshold (bullet ~2px + meteorite ~15px radius)
                meteorites.splice(j, 1);
                bullets.splice(i, 1);
                break; // bullet destroyed, move to next bullet
            }
        }
    }
```
## Day 09 — Score logic
Add score logic and show the current score and high score on the screen.

## Day 10 — Game over
Implement logic so that when a meteorite's y value is lower than the ship's y value, it's game over. I also added a count down before the game starts and some logic to make sure the game only starts when the user is connected. Because I noticed that otherwise the game would sometimes be over even without it having started.

## Day 11 — Make game more playable
I noticed that it was really hard to play because in the beginning they were immediately way too much meteorites so decided to look into that. I added a difficulty scale so the higher the score, the more difficult the game gets.

## Day 12 — Landscape Mode Refactoring
While testing the game i noticed that it does not feel natural to hold the phone vertically so i wanted to implement something so the user has to turn their phone in landscape to play the game. This would give more the feeling of a real game remote.

### what AI recommended
#### My prompt
"I think it might be better to use the phone in landscape mode to play the game, is that hard to implement?"
#### Gemini's response
Switching to landscape mode is a great idea for game ergonomics—it feels more like holding a traditional controller! It isn't hard to implement, but it requires changing which axis of the phone's gyroscope we listen to.

The Logic: Beta vs. Gamma
In your current code, you are using Gamma, which measures the "tilt" when holding the phone vertically (portrait). When you turn the phone sideways (landscape), that same side-to-side motion is now measured by the Beta axis.

Portrait: Gamma is side-to-side.

Landscape: Beta is side-to-side.


### Refactoring the game logic

**Gyroscope Axis Change:**
- Changed from **`gamma`** (portrait: left/right tilt) to **`beta`** (landscape: left/right rotation)
- Beta ranges ≈ −45° to +45° when phone is landscape

**Remote Input Mapping:**
```javascript
// Map landscape beta (-45..45) to canvas width
const clampedBeta = Math.min(45, Math.max(-45, msg.x));
const normalised = Math.min(1, Math.max(0, (clampedBeta + 45) / 90));
ship.x = normalised * canvas.width;
```
Result: More responsive steering (smaller angle range = larger movement ratio).

### Portrait Mode Warning Overlay

**In `controller.html`:**
- Added CSS overlay for portrait orientation detection
- Displays: **"📱 Rotate to Landscape"** message
- Monitors `orientationchange` and `resize` events
- Dynamically shows/hides based on screen dimensions

## Day 13 — Make it more visual
I added visuals for the desktop game as well as for the remote. I made them in Figma and then each time added them to the game in the JS code. I also made sure the typography matches the style of the game and is coherent over the whole application.

## Day 14 — State logic
Implement logic to restart the game from the desktop and the phone when the game is over. Also rethink the state logic so qr code only shows when player is disconnected, game over only shows when player is still connected, ...

## Day 15 — Implement sound
I added sound to the game. Now when the player shoots there's a lazer sound, when they hit a meteorite there's an explosion sound and in the background there's an 8bit version of the interstellar theme song.

First I implemented this without a button but this created some issues in the browser. Basically there's a user interaction needed for the browser to allow sound. So then i decided to work with a play/pause button for the sounds. This is also more UX friendly as not everyone likes sound while playing.

## Day 16 — Haptic Feedback
Looked into adding haptic feedback to the game. I tried some code which did not work at all. I then found out that it's Apple intentionally blocking that. I looked for a solution and Gemini recommended me to instead work with a sharp sound that might give the illustion to the user of a haptic tap. Then i thought maybe it will be more interesting if i just move the lazer sound to the phone. So then the lazer sound comes from the phone while shooting and the explosion sound and background music comes from the desktop. This will ensure a better user experience as well.



### clean up code - move css to css file? - NOT YET




