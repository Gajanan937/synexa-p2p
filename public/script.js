const socket = io();
let peer;
let roomCode;
let connectedPeers = {};
let myUserInfo = {};

const senderBtn = document.getElementById('sender-btn');
const receiverBtn = document.getElementById('receiver-btn');
const roleSelection = document.getElementById('role-selection');
const senderUi = document.getElementById('sender-ui');
const roomCodeDisplay = document.getElementById('room-code');
const deviceCountDisplay = document.getElementById('device-count');
const peersContainer = document.getElementById('peers-container');
const peerListDiv = document.getElementById('peer-list');

const receiverUi = document.getElementById('receiver-ui');
const recName = document.getElementById('rec-name');
const joinCodeInput = document.getElementById('join-code-input');
const joinBtn = document.getElementById('join-btn');

const uploadQrBtn = document.getElementById('upload-qr-btn');
const qrFileInput = document.getElementById('qr-file-input');
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const statusBox = document.getElementById('status-box');
const statusText = document.getElementById('status-text');
const progressBar = document.getElementById('progress-bar');
const speedInfo = document.getElementById('speed-info');
const leaveBtn = document.getElementById('leave-btn');

const filePreviewContainer = document.getElementById('file-preview-container');
const previewFilename = document.getElementById('preview-filename');
const previewFilesize = document.getElementById('preview-filesize');
const fileThumbnail = document.getElementById('file-thumbnail');

const historyPanel = document.getElementById('history-panel');
const historyList = document.getElementById('history-list');

// --- FIXED PEER CONFIG FOR RENDER & LOCALHOST ---
const peerConfig = window.location.protocol === 'https:'
    ? { host: window.location.hostname, secure: true, path: '/peerjs' }
    : { host: window.location.hostname, port: 3000, path: '/peerjs' };
// ------------------------------------------------

let startTime;
let incomingFileInfo = {};
let receiveBuffer = [];
let receivedSize = 0;
let currentEncryptionKey = null;

// --- WEB CRYPTO API FUNCTIONS (E2EE) ---
async function generateEncryptionKey() {
    return await window.crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );
}

async function exportKey(key) {
    return await window.crypto.subtle.exportKey("jwk", key);
}

async function importKey(jwkKey) {
    return await window.crypto.subtle.importKey(
        "jwk",
        jwkKey,
        { name: "AES-GCM", length: 256 },
        true,
        ["decrypt"]
    );
}

async function encryptChunk(key, buffer) {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        key,
        buffer
    );
    const combined = new Uint8Array(iv.byteLength + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.byteLength);
    return combined.buffer;
}

async function decryptChunk(key, combinedBuffer) {
    if (combinedBuffer instanceof Blob) {
        combinedBuffer = await combinedBuffer.arrayBuffer();
    } else if (combinedBuffer instanceof Uint8Array) {
        combinedBuffer = combinedBuffer.buffer;
    } else if (!(combinedBuffer instanceof ArrayBuffer)) {
        combinedBuffer = new Uint8Array(Object.values(combinedBuffer)).buffer;
    }

    const data = new Uint8Array(combinedBuffer);
    const iv = data.slice(0, 12);
    const encrypted = data.slice(12);
    return await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv },
        key,
        encrypted
    );
}
// ----------------------------------------

function addToSenderHistory(filename, fileSize) {
    if (historyPanel) historyPanel.classList.remove('hidden');
    const sizeMB = (fileSize / (1024 * 1024)).toFixed(2) + " MB";
    const item = document.createElement('div');
    item.className = "flex items-center justify-between bg-slate-900 p-2.5 rounded-xl border border-slate-800 text-xs";
    item.innerHTML = `
        <div class="flex items-center space-x-2 truncate">
            <span class="text-teal-400 font-bold">🔒 Encrypted Sent:</span>
            <span class="text-slate-200 truncate font-medium">${filename}</span>
        </div>
        <span class="text-slate-500 shrink-0 ml-2">${sizeMB}</span>
    `;
    historyList.appendChild(item);
}

function addToReceiverHistoryWithActions(filename, fileSize, fileUrl) {
    if (historyPanel) historyPanel.classList.remove('hidden');
    const sizeMB = (fileSize / (1024 * 1024)).toFixed(2) + " MB";
    const item = document.createElement('div');
    item.className = "flex items-center justify-between bg-slate-900 p-3 rounded-xl border border-slate-800 text-xs gap-2";

    item.innerHTML = `
        <div class="flex items-center space-x-2 truncate flex-1">
            <span class="text-teal-400 font-bold shrink-0">🔓 Decrypted:</span>
            <span class="text-slate-200 truncate font-medium">${filename} (${sizeMB})</span>
        </div>
        <div class="flex items-center space-x-2 shrink-0">
            <a href="${fileUrl}" target="_blank" class="bg-teal-500/20 hover:bg-teal-500/30 text-teal-300 px-2.5 py-1.5 rounded-lg font-semibold transition-all cursor-pointer">Open</a>
            <a href="${fileUrl}" download="${filename}" class="bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1.5 rounded-lg font-semibold transition-all cursor-pointer">Download</a>
        </div>
    `;
    historyList.appendChild(item);
}

function updateSpeed(processedBytes, totalBytes, currentFilename, currentFileSize, isSender = true) {
    statusBox.classList.remove('hidden');
    const timeElapsed = (Date.now() - startTime) / 1000;
    const speedBps = processedBytes / timeElapsed;
    const speedMBps = (speedBps / (1024 * 1024)).toFixed(2);
    const remainingBytes = totalBytes - processedBytes;
    const timeLeft = speedBps > 0 ? Math.round(remainingBytes / speedBps) : 0;
    const percentage = Math.floor((processedBytes / totalBytes) * 100);

    progressBar.style.width = percentage + "%";
    progressBar.innerText = percentage + "%";
    speedInfo.classList.remove('hidden');
    speedInfo.innerText = `🚀 Speed: ${speedMBps} MB/s | ⏳ Time Left: ${timeLeft}s`;

    if (percentage >= 100 && isSender) {
        progressBar.classList.remove('from-teal-500', 'to-cyan-400');
        progressBar.classList.add('bg-emerald-500');
        statusText.innerText = "Encrypted File Sent! 🛡️✅";
        statusText.classList.remove('animate-pulse');

        addToSenderHistory(currentFilename, currentFileSize);

        setTimeout(() => {
            if (filePreviewContainer) filePreviewContainer.classList.add('hidden');
            progressBar.style.width = "0%";
            progressBar.classList.remove('bg-emerald-500');
            progressBar.classList.add('from-teal-500', 'to-cyan-400');
            document.querySelector('#drop-zone p').innerHTML = `📂 Click here to select file<br><span class="text-xs text-slate-500">or Drag & Drop</span>`;
            statusText.classList.add('animate-pulse');
            statusText.innerText = "Ready for next transfer...";
        }, 3000);
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const autoRoom = urlParams.get('room');

    if (autoRoom) {
        roleSelection.classList.add('hidden');
        receiverUi.classList.remove('hidden');
        joinCodeInput.value = autoRoom;
        statusBox.classList.remove('hidden');
        statusText.innerText = `QR Scanned! Room ${autoRoom} detected. Apna naam daal kar Join karein.`;
        leaveBtn.classList.remove('hidden');
    }
});

senderBtn.addEventListener('click', () => {
    roleSelection.classList.add('hidden');
    senderUi.classList.remove('hidden');
    statusBox.classList.remove('hidden');
    statusText.innerText = "Room created! Waiting for devices to join...";
    leaveBtn.classList.remove('hidden');

    roomCode = Math.floor(1000 + Math.random() * 9000).toString();
    roomCodeDisplay.innerText = roomCode;
    socket.emit('create-room', roomCode);

    const joinUrl = window.location.href.split('?')[0] + "?room=" + roomCode;
    document.getElementById("qrcode").innerHTML = "";
    new QRCode(document.getElementById("qrcode"), { text: joinUrl, width: 160, height: 160 });

    peer = new Peer('sender-' + roomCode, peerConfig);

    peer.on('connection', (conn) => {
        conn.on('data', (data) => {
            if (data.type === 'metadata') {
                connectedPeers[conn.peer] = { conn, info: data.userInfo, socketId: data.socketId };
                renderPeerList();
            }
        });
    });

    socket.on('peer-joined', (data) => {
        showActivityLog(`🟢 ${data.userInfo.name} joined the room!`);
    });

    socket.on('peer-left', (data) => {
        showActivityLog(`🔴 ${data.name} left the room.`);
        Object.keys(connectedPeers).forEach(key => {
            if (connectedPeers[key].socketId === data.socketId) {
                delete connectedPeers[key];
            }
        });
        renderPeerList();
    });
});

function showActivityLog(msg) {
    statusBox.classList.remove('hidden');
    statusText.innerText = msg;
    leaveBtn.classList.remove('hidden');
    setTimeout(() => {
        if (statusText.innerText === msg) {
            statusText.innerText = "Ready for transfer...";
        }
    }, 4000);
}

receiverBtn.addEventListener('click', () => {
    roleSelection.classList.add('hidden');
    receiverUi.classList.remove('hidden');
    statusBox.classList.remove('hidden');
    statusText.innerText = "Please enter your details to join.";
    leaveBtn.classList.remove('hidden');
});

function validateAndJoin(code) {
    if (!recName.value.trim()) {
        alert("Please enter your name!");
        recName.focus();
        return;
    }
    myUserInfo = { name: recName.value.trim() };
    roomCode = code;
    socket.emit('join-room', { roomId: roomCode, userInfo: myUserInfo });
}

joinBtn.addEventListener('click', () => {
    const code = joinCodeInput.value.trim();
    if (code.length === 4) validateAndJoin(code);
    else alert("Enter valid 4-digit room code!");
});

uploadQrBtn.addEventListener('click', () => {
    const name = recName.value.trim();
    if (!name) {
        alert("Pehle apna naam enter box mein likho, phir QR upload karo!");
        recName.focus();
        return;
    }
    qrFileInput.click();
});

qrFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const name = recName.value.trim();
    if (!name) {
        alert("Pehle apna naam enter karo!");
        return;
    }

    const reader = new FileReader();
    reader.onload = function (event) {
        const img = new Image();
        img.onload = function () {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);

            const codeData = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);

            if (codeData) {
                try {
                    const url = new URL(codeData.data);
                    const extRoom = url.searchParams.get('room');
                    if (extRoom) {
                        myUserInfo = { name: name };
                        roomCode = extRoom;
                        receiverUi.classList.add('hidden');
                        statusBox.classList.remove('hidden');
                        statusText.innerText = `QR Scanned! Joining Room ${roomCode}... ⏳`;
                        leaveBtn.classList.remove('hidden');
                        socket.emit('join-room', { roomId: roomCode, userInfo: myUserInfo });
                    } else {
                        alert("Invalid QR code! Sahi SYNEXA QR image select karein.");
                    }
                } catch (err) {
                    alert("QR link read nahi ho payi!");
                }
            } else {
                alert("QR Code detect nahi hua! Saaf image select karein.");
            }
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
});

socket.on('room-joined-success', (roomId) => {
    receiverUi.classList.add('hidden');
    statusBox.classList.remove('hidden');
    statusText.innerText = "Joined Room! Connected & waiting for files... 🟢";
    leaveBtn.classList.remove('hidden');

    peer = new Peer(peerConfig);
    peer.on('open', (id) => {
        const conn = peer.connect('sender-' + roomId);

        conn.on('open', () => {
            statusText.innerText = "Connected! Waiting for files... 🟢";
            leaveBtn.classList.remove('hidden');
            conn.send({ type: 'metadata', userInfo: myUserInfo, socketId: socket.id });
        });

        conn.on('data', async (data) => {
            if (data.type === 'header') {
                currentEncryptionKey = await importKey(data.key);
                incomingFileInfo = { filename: data.filename, size: data.size, fileType: data.fileType };
                receiveBuffer = []; receivedSize = 0; startTime = Date.now();
                statusText.innerText = `Receiving Encrypted File: ${data.filename} 🔒`;
            } else if (data.type === 'chunk') {
                try {
                    const decryptedChunk = await decryptChunk(currentEncryptionKey, data.data);
                    receiveBuffer.push(decryptedChunk);
                    receivedSize += decryptedChunk.byteLength;

                    const timeElapsed = (Date.now() - startTime) / 1000;
                    const speedBps = receivedSize / timeElapsed;
                    const speedMBps = (speedBps / (1024 * 1024)).toFixed(2);
                    const remainingBytes = incomingFileInfo.size - receivedSize;
                    const timeLeft = speedBps > 0 ? Math.round(remainingBytes / speedBps) : 0;
                    const percentage = Math.floor((receivedSize / incomingFileInfo.size) * 100);

                    progressBar.style.width = percentage + "%";
                    progressBar.innerText = percentage + "%";
                    speedInfo.classList.remove('hidden');
                    speedInfo.innerText = `🚀 Speed: ${speedMBps} MB/s | ⏳ Time Left: ${timeLeft}s`;
                } catch (err) {
                    console.error("Decryption failed:", err);
                    statusText.innerText = "Decryption Failed! ❌";
                }

            } else if (data.type === 'eof') {
                statusText.innerText = "File Decrypted Successfully! 🎉";
                progressBar.style.width = "100%";
                progressBar.innerText = "100%";
                progressBar.classList.add('bg-emerald-500');

                const blob = new Blob(receiveBuffer, { type: incomingFileInfo.fileType || 'application/octet-stream' });
                const url = URL.createObjectURL(blob);
                addToReceiverHistoryWithActions(incomingFileInfo.filename, incomingFileInfo.size, url);

                setTimeout(() => {
                    statusBox.classList.add('hidden');
                    progressBar.style.width = "0%";
                    progressBar.classList.remove('bg-emerald-500');
                    statusText.innerText = "Waiting for next file...";
                }, 3000);
            }
        });
    });
});

leaveBtn.addEventListener('click', () => {
    window.location.href = window.location.pathname;
});

function renderPeerList() {
    peerListDiv.innerHTML = "";
    const peerIds = Object.keys(connectedPeers);
    deviceCountDisplay.innerText = peerIds.length;

    if (peerIds.length > 0) {
        peersContainer.classList.remove('hidden');
        dropZone.classList.remove('hidden');
    } else {
        peersContainer.classList.add('hidden');
    }

    peerIds.forEach(id => {
        const peerObj = connectedPeers[id];
        const div = document.createElement('div');
        div.className = 'flex items-center space-x-3 bg-slate-900 p-3 rounded-xl border border-slate-800';
        div.innerHTML = `
            <label class="flex items-center space-x-2 cursor-pointer w-full">
                <input type="checkbox" class="peer-checkbox w-4 h-4 accent-teal-400" value="${id}" checked>
                <strong class="text-sm font-medium text-slate-200">${peerObj.info.name}</strong>
            </label>
        `;
        peerListDiv.appendChild(div);
    });
}

dropZone.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];

    if (file) {
        document.querySelector('#drop-zone p').innerHTML = `File Selected: <br><span class="text-teal-400 font-bold text-lg">${file.name}</span>`;

        if (filePreviewContainer) {
            previewFilename.textContent = file.name;
            const sizeInMB = (file.size / (1024 * 1024)).toFixed(2);
            if (sizeInMB < 1) {
                previewFilesize.textContent = `${(file.size / 1024).toFixed(0)} KB`;
            } else {
                previewFilesize.textContent = `${sizeInMB} MB`;
            }

            if (file.type.startsWith('image/')) {
                fileThumbnail.textContent = 'IMG';
                fileThumbnail.className = "w-12 h-12 bg-rose-500/20 text-rose-400 rounded-lg flex items-center justify-center overflow-hidden font-bold text-xs shrink-0 border border-rose-500/30";
            } else if (file.type === 'application/pdf') {
                fileThumbnail.textContent = 'PDF';
                fileThumbnail.className = "w-12 h-12 bg-red-500/20 text-red-400 rounded-lg flex items-center justify-center overflow-hidden font-bold text-xs shrink-0 border border-red-500/30";
            } else if (file.type.startsWith('video/')) {
                fileThumbnail.textContent = 'VID';
                fileThumbnail.className = "w-12 h-12 bg-blue-500/20 text-blue-400 rounded-lg flex items-center justify-center overflow-hidden font-bold text-xs shrink-0 border border-blue-500/30";
            } else {
                fileThumbnail.textContent = 'FILE';
                fileThumbnail.className = "w-12 h-12 bg-slate-800 text-teal-400 rounded-lg flex items-center justify-center overflow-hidden font-bold text-xs shrink-0 border border-slate-700";
            }

            filePreviewContainer.classList.remove('hidden');
        }
    }

    const checkboxes = document.querySelectorAll('.peer-checkbox:checked');
    if (!file || checkboxes.length === 0) return;

    statusBox.classList.remove('hidden');
    statusText.innerText = `Encrypting & Sending to ${checkboxes.length} device(s)... 🔒`;

    const aesKey = await generateEncryptionKey();
    const exportedKey = await exportKey(aesKey);

    const chunkSize = 128 * 1024;
    startTime = Date.now();

    for (const cb of checkboxes) {
        const peerId = cb.value;
        const conn = connectedPeers[peerId].conn;

        conn.send({
            type: 'header',
            filename: file.name,
            size: file.size,
            fileType: file.type || 'application/octet-stream',
            key: exportedKey
        });

        let offset = 0;
        const readSlice = async (o) => {
            const slice = file.slice(o, o + chunkSize);
            const reader = new FileReader();
            reader.onload = async (event) => {
                const encryptedChunkBuffer = await encryptChunk(aesKey, event.target.result);
                const uint8Chunk = new Uint8Array(encryptedChunkBuffer);
                conn.send({ type: 'chunk', data: uint8Chunk });

                offset += event.target.result.byteLength;
                updateSpeed(offset, file.size, file.name, file.size, true);

                if (offset < file.size) {
                    setTimeout(() => readSlice(offset), 0);
                } else {
                    conn.send({ type: 'eof' });
                }
            };
            reader.readAsArrayBuffer(slice);
        };
        readSlice(0);
    }
});