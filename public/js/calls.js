// ============================================================
//   LLAMADAS WEBRTC (VOZ)
// ============================================================
// ============================================================

let peerConnection = null;
let localStream = null;
let callTarget = null;
let isCaller = false;
let callTimerInterval = null;
let callStartTime = null;
let isMuted = false;

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

async function iniciarLlamada() {
    if (!currentChat || !socket) return;

    // Resolver destinatario: puede ser username (online) o phone: (offline)
    const isOfflineChat = currentChat.startsWith('phone:');
    const offlinePhone = isOfflineChat ? currentChat.replace('phone:', '') : null;

    // Para offline: obtener username del contacto desde la BD via servidor
    // El servidor resuelve el username al recibir call_offer con toPhone
    // Aquí simplemente enviamos la oferta — el servidor la guarda como missed call y devuelve call_rejected
    if (isOfflineChat) {
        // Llamada a offline: el servidor guardará missed call automáticamente
        const contact = myContacts.get(offlinePhone);
        const displayName = contact ? contact.customName : offlinePhone;
        // Necesitamos el username del destinatario para enviar la oferta
        // Buscamos si lo tenemos en caché (puede que lo hayamos visto online antes)
        let targetUsername = contact && contact.username ? contact.username : null;
        if (!targetUsername) {
            addInfo(`📵 Llamada perdida enviada a ${displayName}. Le llegará la notificación al conectarse.`);
            // Guardar missed call via mensaje especial
            socket.send(JSON.stringify({
                type: 'message',
                toPhone: offlinePhone,
                message: '__missed_call__'
            }));
            return;
        }
        callTarget = targetUsername;
    } else {
        callTarget = currentChat;
    }

    isCaller = true;

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch(e) {
        alert('No se pudo acceder al micrófono: ' + e.message);
        return;
    }

    peerConnection = crearPeer();
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    socket.send(JSON.stringify({
        type: 'call_offer',
        to: callTarget,
        from: username,
        sdp: offer.sdp
    }));

    mostrarCallOverlay(callTarget, 'Llamando…');
}

async function recibirLlamada(data) {
    callTarget = data.from;
    isCaller = false;

    // Guardar oferta para cuando se acepte
    window._pendingOffer = data;

    // Mostrar banner de llamada entrante
    document.getElementById('incomingName').textContent = data.from;
    document.getElementById('incomingAvatar').src = `https://api.dicebear.com/7.x/initials/svg?seed=${data.from}`;
    document.getElementById('incomingCall').classList.add('visible');
    playRingtone();
}

async function aceptarLlamada() {
    stopRingtone();
    document.getElementById('incomingCall').classList.remove('visible');

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch(e) {
        alert('No se pudo acceder al micrófono: ' + e.message);
        return;
    }

    peerConnection = crearPeer();
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    const offer = window._pendingOffer;
    await peerConnection.setRemoteDescription({ type: 'offer', sdp: offer.sdp });

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.send(JSON.stringify({
        type: 'call_answer',
        to: callTarget,
        from: username,
        sdp: answer.sdp
    }));

    mostrarCallOverlay(callTarget, 'Conectando…');
}

function rechazarLlamada() {
    stopRingtone();
    document.getElementById('incomingCall').classList.remove('visible');
    socket.send(JSON.stringify({ type: 'call_rejected', to: callTarget }));
    callTarget = null;
    window._pendingOffer = null;
}

async function recibirRespuesta(data) {
    if (!peerConnection) return;
    await peerConnection.setRemoteDescription({ type: 'answer', sdp: data.sdp });
}

async function recibirICE(data) {
    if (!peerConnection || !data.candidate) return;
    try {
        await peerConnection.addIceCandidate(data.candidate);
    } catch(e) {}
}

function terminarLlamada() {
    socket.send(JSON.stringify({ type: 'call_ended', to: callTarget }));
    limpiarLlamada();
}

function llamadaRechazada() {
    addInfo(`${callTarget} rechazó la llamada.`);
    limpiarLlamada();
}

function llamadaTerminada() {
    addInfo(`Llamada con ${callTarget} finalizada.`);
    limpiarLlamada();
}

function limpiarLlamada() {
    stopRingtone();
    if (callTimerInterval) { clearInterval(callTimerInterval); callTimerInterval = null; }
    if (peerConnection) { peerConnection.close(); peerConnection = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    document.getElementById('callOverlay').classList.remove('visible');
    document.getElementById('incomingCall').classList.remove('visible');
    document.getElementById('remoteAudio').srcObject = null;
    callTarget = null;
    isMuted = false;
    isCaller = false;
}

function crearPeer() {
    const pc = new RTCPeerConnection(rtcConfig);

    pc.onicecandidate = (e) => {
        if (e.candidate && callTarget) {
            socket.send(JSON.stringify({
                type: 'call_ice',
                to: callTarget,
                candidate: e.candidate
            }));
        }
    };

    pc.ontrack = (e) => {
        const audio = document.getElementById('remoteAudio');
        audio.srcObject = e.streams[0];
    };

    pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
            document.getElementById('callStatusText').textContent = 'En llamada';
            document.getElementById('callTimer').style.display = 'block';
            callStartTime = Date.now();
            callTimerInterval = setInterval(actualizarTimer, 1000);
        }
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            llamadaTerminada();
        }
    };

    return pc;
}

function mostrarCallOverlay(name, status) {
    document.getElementById('callName').textContent = name;
    document.getElementById('callStatusText').textContent = status;
    document.getElementById('callAvatar').src = userAvatars[name] || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name)}`;
    document.getElementById('callTimer').style.display = 'none';
    document.getElementById('callTimer').textContent = '00:00';
    const overlay = document.getElementById('callOverlay');
    // Resetear posición al inicio de cada llamada
    overlay.style.left   = '';
    overlay.style.bottom = '';
    overlay.style.right  = '16px';
    overlay.classList.add('visible');
    activarDragPanel(overlay);
}

function actualizarTimer() {
    if (!callStartTime) return;
    const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
    const m = String(Math.floor(elapsed / 60)).padStart(2,'0');
    const s = String(elapsed % 60).padStart(2,'0');
    document.getElementById('callTimer').textContent = `${m}:${s}`;
}

function toggleMute() {
    if (!localStream) return;
    isMuted = !isMuted;
    localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
    const btn = document.getElementById('btnMute');
    btn.textContent = isMuted ? '🔇' : '🎤';
    btn.classList.toggle('muted', isMuted);
}

// ============================================================
