const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const socketMap = {};

io.on('connection', (socket) => {
    console.log('🟢 User connected:', socket.id);

    // Simple room creation
    socket.on('create-room', (roomId) => {
        socket.join(roomId);
        console.log(`🏠 Room created: ${roomId}`);
    });

    socket.on('join-room', (data) => {
        const roomId = typeof data === 'object' ? data.roomId : data;
        const userInfo = typeof data === 'object' ? data.userInfo : { name: 'Guest' };

        const room = io.sockets.adapter.rooms.get(roomId);
        const roomSize = room ? room.size : 0;

        if (roomSize >= 20) {
            socket.emit('room-error', 'Room is full!');
            return;
        }

        socket.join(roomId);
        socketMap[socket.id] = { roomId, name: userInfo.name };
        console.log(`✅ User joined room ${roomId}:`, userInfo);

        io.to(roomId).emit('peer-joined', { socketId: socket.id, userInfo });
        socket.emit('room-joined-success', roomId);
    });

    socket.on('disconnect', () => {
        console.log('🔴 User disconnected:', socket.id);
        const userInfo = socketMap[socket.id];
        if (userInfo) {
            io.to(userInfo.roomId).emit('peer-left', { socketId: socket.id, name: userInfo.name });
            delete socketMap[socket.id];
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});