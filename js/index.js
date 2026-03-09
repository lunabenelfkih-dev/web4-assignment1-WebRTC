const express = require('express');
const app = express();
const https = require('https');
const fs = require('fs');
const server = https.createServer({
    key: fs.readFileSync('key.pem'),
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

    // WebRTC signalling relay — forward any signal to the target socket
    socket.on('signal', (targetSocketId, data) => {
        if (!clients[targetSocketId]) {
            console.log(`Signal target not found: ${targetSocketId}`);
            return;
        }
        // Forward the signal, including the sender's id so the receiver knows who to reply to
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
