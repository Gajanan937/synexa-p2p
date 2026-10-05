const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const roomSenders = {};

io.on('connection', (socket) => {
    console.log('🟢 User connected:', socket.id);

    socket.on('create-room', ({ roomCode, peerId }) => {
        socket.join(roomCode);
        roomSenders[roomCode] = peerId;
        console.log(`🏠 Room created: ${roomCode} with Peer ID: ${peerId}`);
    });

    socket.on('join-room', (data) => {
        const roomId = typeof data === 'object' ? data.roomId : data;
        const userInfo = typeof data === 'object' ? data.userInfo : { name: 'Guest' };

        const room = io.sockets.adapter.rooms.get(roomId);
        const roomSize = room ? room.size : 0;

        if (roomSize >= 20) {
            socket.emit('room-error', 'Room is full! Maximum 20 devices allowed.');
            return;
        }

        socket.join(roomId);
        console.log(`✅ User joined room ${roomId}:`, userInfo);

        io.to(roomId).emit('peer-joined', { socketId: socket.id, userInfo });

        const senderPeerId = roomSenders[roomId];
        socket.emit('room-joined-success', { roomId, senderPeerId });
    });

    socket.on('disconnect', () => {
        console.log('🔴 User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});