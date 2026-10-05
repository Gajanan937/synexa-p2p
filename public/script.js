const socket = io();
let peer;
let roomCode;
let connectedPeers = {};
let myUserInfo = {};

// STUN + TURN Servers added to bypass Hotspot / Mobile Data Blocks
const peerConfig = {
    config: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            {
                urls: "turn:openrelay.metered.ca:80",
                username: "openrelayproject",
                credential: "openrelayproject"
            },
            {
                urls: "turn:openrelay.metered.ca:443",
                username: "openrelayproject",
                credential: "openrelayproject"
            }
        ]
    }
};

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

let startTime;
let incomingFileInfo = {};
let receiveBuffer = [];
let receivedSize = 0;
let currentEncryptionKey = null;

// --- WEB CRYPTO API FUNCTIONS ---
async function generateEncryptionKey() {
    return await window.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}
async function exportKey(key) {
    return await window.crypto.subtle.exportKey("jwk", key);
}
async function importKey(jwkKey) {
    return await window.crypto.subtle.importKey("jwk", jwkKey, { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
}
async function encryptChunk(key, buffer) {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, buffer);
    const combined = new Uint8Array(iv.byteLength + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.byteLength);
    return combined.buffer;
}
async function decryptChunk(key, combinedBuffer) {
    let data = new Uint8Array(combinedBuffer instanceof Blob ? await combinedBuffer.arrayBuffer() : combinedBuffer);
    const iv = data.slice(0, 12);
    const encrypted = data.slice(12);
    return await window.crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, encrypted);
}

function addToSenderHistory(filename, fileSize) {
    historyPanel.classList.remove('hidden');
    const sizeMB = (fileSize / (1024 * 1024)).toFixed(2) + " MB";
    const item = document.createElement('div');
    item.className = "flex items-center justify-between bg-slate-900 p-2.5 rounded-xl border border-slate-800 text-xs";
    item.innerHTML = `<div class="flex items-center space-x-2 truncate"><span class="text-teal-400 font-bold">🔒 Encrypted Sent:</span><span class="text-slate-200 truncate font-medium">${filename}</span></div><span class="text-slate-500 shrink-0 ml-2">${sizeMB}</span>`;
    historyList.appendChild(item);
}

function addToReceiverHistoryWithActions(filename, fileSize, fileUrl) {
    historyPanel.classList.remove('hidden');
    const sizeMB = (fileSize / (1024 * 1024)).toFixed(2) + " MB";
    const item = document.createElement('div');
    item.className = "flex items-center justify-between bg-slate-900 p-3 rounded-xl border border-slate-800 text-xs gap-2";
    item.innerHTML = `<div class="flex items-center space-x-2 truncate flex-1"><span class="text-teal-400 font-bold shrink-0">🔓 Decrypted:</span><span class="text-slate-200 truncate font-medium">${filename} (${sizeMB})</span></div><div class="flex items-center space-x-2 shrink-0"><a href="${fileUrl}" download="${filename}" class="bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1.5 rounded-lg font-semibold transition-all cursor-pointer">Download</a></div>`;
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
        statusText.innerText = `Room ${autoRoom} detected. Apna naam daal kar Join karein.`;
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

    // FIXED ID SYSTEM (Prevents mismatched connections)
    const myPeerId = 'synexa-sender-' + roomCode;
    peer = new Peer(myPeerId, peerConfig);

    peer.on('open', () => {
        const joinUrl = window.location.href.split('?')[0] + "?room=" + roomCode;
        document.getElementById("qrcode").innerHTML = "";
        new QRCode(document.getElementById("qrcode"), { text: joinUrl, width: 160, height: 160 });
    });

    peer.on('connection', (conn) => {
        conn.on('data', (data) => {
            if (data.type === 'metadata') {
                connectedPeers[conn.peer] = { conn, info: data.userInfo, socketId: data.socketId };
                renderPeerList();
            }
        });
        conn.on('close', () => {
            delete connectedPeers[conn.peer];
            renderPeerList();
        });
    });

    socket.on('peer-joined', (data) => {
        statusText.innerText = `${data.userInfo.name} joined!`;
    });

    socket.on('peer-left', (data) => {
        statusText.innerText = `${data.name} left.`;
        Object.keys(connectedPeers).forEach(key => {
            if (connectedPeers[key].socketId === data.socketId) delete connectedPeers[key];
        });
        renderPeerList();
    });
});

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
    else alert("Enter valid 4-digit code!");
});

uploadQrBtn.addEventListener('click', () => {
    if (!recName.value.trim()) { alert("Naam likho!"); return; }
    qrFileInput.click();
});

qrFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const name = recName.value.trim();
    if (!name) return;

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
                const url = new URL(codeData.data);
                const extRoom = url.searchParams.get('room');
                if (extRoom) {
                    myUserInfo = { name: name };
                    roomCode = extRoom;
                    receiverUi.classList.add('hidden');
                    statusBox.classList.remove('hidden');
                    statusText.innerText = `Joining Room ${roomCode}... ⏳`;
                    leaveBtn.classList.remove('hidden');
                    socket.emit('join-room', { roomId: roomCode, userInfo: myUserInfo });
                }
            } else { alert("QR Code detect nahi hua!"); }
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
});

socket.on('room-joined-success', (roomId) => {
    receiverUi.classList.add('hidden');
    statusBox.classList.remove('hidden');
    statusText.innerText = "Connecting devices... ⏳";
    leaveBtn.classList.remove('hidden');

    peer = new Peer(peerConfig);
    peer.on('open', () => {
        // MATCHING THE FIXED ID SYSTEM
        const senderPeerId = 'synexa-sender-' + roomId;
        const conn = peer.connect(senderPeerId);

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
                statusText.innerText = `Receiving: ${data.filename}`;
            } else if (data.type === 'chunk') {
                const decryptedChunk = await decryptChunk(currentEncryptionKey, data.data);
                receiveBuffer.push(decryptedChunk);
                receivedSize += decryptedChunk.byteLength;
                updateSpeed(receivedSize, incomingFileInfo.size, incomingFileInfo.filename, incomingFileInfo.size, false);
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

leaveBtn.addEventListener('click', () => { window.location.href = window.location.pathname; });

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
        div.innerHTML = `<label class="flex items-center space-x-2 cursor-pointer w-full"><input type="checkbox" class="peer-checkbox w-4 h-4 accent-teal-400" value="${id}" checked><strong class="text-sm font-medium text-slate-200">${peerObj.info.name}</strong></label>`;
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
            previewFilesize.textContent = sizeInMB < 1 ? `${(file.size / 1024).toFixed(0)} KB` : `${sizeInMB} MB`;
            fileThumbnail.textContent = file.type.startsWith('image/') ? 'IMG' : (file.type === 'application/pdf' ? 'PDF' : (file.type.startsWith('video/') ? 'VID' : 'FILE'));
            filePreviewContainer.classList.remove('hidden');
        }
    }

    const checkboxes = document.querySelectorAll('.peer-checkbox:checked');
    if (!file || checkboxes.length === 0) return;

    for (const cb of checkboxes) {
        const conn = connectedPeers[cb.value]?.conn;
        if (!conn || !conn.open) {
            alert("Connection open ho raha hai! Kripya 1 second baad dobara try karein.");
            return;
        }
    }

    statusBox.classList.remove('hidden');
    statusText.innerText = `Encrypting & Sending to ${checkboxes.length} device(s)...`;

    const aesKey = await generateEncryptionKey();
    const exportedKey = await exportKey(aesKey);
    const chunkSize = 128 * 1024;
    startTime = Date.now();

    for (const cb of checkboxes) {
        const conn = connectedPeers[cb.value].conn;
        conn.send({ type: 'header', filename: file.name, size: file.size, fileType: file.type || 'application/octet-stream', key: exportedKey });

        let offset = 0;
        const readSlice = async (o) => {
            const slice = file.slice(o, o + chunkSize);
            const reader = new FileReader();
            reader.onload = async (event) => {
                const encryptedChunkBuffer = await encryptChunk(aesKey, event.target.result);
                conn.send({ type: 'chunk', data: new Uint8Array(encryptedChunkBuffer) });
                offset += event.target.result.byteLength;
                updateSpeed(offset, file.size, file.name, file.size, true);
                if (offset < file.size) setTimeout(() => readSlice(offset), 0);
                else conn.send({ type: 'eof' });
            };
            reader.readAsArrayBuffer(slice);
        };
        readSlice(0);
    }
});