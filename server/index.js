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
app.use('/assets', express.static('assets'));

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
