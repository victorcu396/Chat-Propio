// LLAMADA GRUPAL (admin inicia, WebRTC mesh)
// ============================================================
// Estado de la llamada grupal
let groupCallState = {
    groupId: null,
    peers: {},       // username → { pc, stream, phone }
    localStream: null,
    timerInterval: null,
    startTime: null,
    isMuted: false
};

function iniciarLlamadaGrupal() {
    if (!currentChat || !currentChat.startsWith('group_')) return;
    const groupId = currentChat.replace('group_', '');
    const g = myGroups.get(groupId);
    if (!g) return;
    // Cualquier miembro puede iniciar la llamada

    // Obtener miembros online (excluir al propio admin)
    const onlineMembers = g.members.filter(phone => {
        if (phone === loginPhone) return false;
        return window._phoneToUsername && window._phoneToUsername[phone];
    });
    if (onlineMembers.length === 0) {
        alert('No hay miembros del grupo conectados en este momento.');
        return;
    }

    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        groupCallState.groupId = groupId;
        groupCallState.localStream = stream;
        groupCallState.peers = {};
        groupCallState.isMuted = false;

        mostrarOverlayLlamadaGrupal(g, onlineMembers);

        // Crear un peer por cada miembro online y enviar ofertas
        onlineMembers.forEach(memberPhone => {
            const memberUsername = window._phoneToUsername[memberPhone];
            if (!memberUsername) return;
            crearPeerGrupal(memberUsername, memberPhone, true, groupId);
        });
    }).catch(e => { alert('No se pudo acceder al micrófono: ' + e.message); });
}

function crearPeerGrupal(targetUsername, targetPhone, isInitiator, groupId) {
    const pc = new RTCPeerConnection(rtcConfig);
    groupCallState.peers[targetUsername] = { pc, phone: targetPhone };

    groupCallState.localStream.getTracks().forEach(t => pc.addTrack(t, groupCallState.localStream));

    pc.onicecandidate = (e) => {
        if (e.candidate) {
            socket.send(JSON.stringify({
                type: 'group_call_ice',
                to: targetUsername,
                groupId,
                candidate: e.candidate
            }));
        }
    };

    pc.ontrack = (e) => {
        // Reproducir audio del participante
        let audioEl = document.getElementById('groupAudio_' + targetUsername);
        if (!audioEl) {
            audioEl = document.createElement('audio');
            audioEl.id = 'groupAudio_' + targetUsername;
            audioEl.autoplay = true;
            audioEl.style.display = 'none';
            document.body.appendChild(audioEl);
        }
        audioEl.srcObject = e.streams[0];
        actualizarEstadoParticipante(targetUsername, 'connected');
    };

    pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
            actualizarEstadoParticipante(targetUsername, 'connected');
            // Iniciar timer cuando al menos uno conecte
            if (!groupCallState.startTime) {
                groupCallState.startTime = Date.now();
                groupCallState.timerInterval = setInterval(actualizarTimerGrupal, 1000);
                document.getElementById('groupCallTimer').style.display = 'block';
            }
        }
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            actualizarEstadoParticipante(targetUsername, 'rejected');
        }
    };

    if (isInitiator) {
        pc.createOffer().then(offer => pc.setLocalDescription(offer)).then(() => {
            socket.send(JSON.stringify({
                type: 'group_call_offer',
                groupId,
                sdp: pc.localDescription.sdp
            }));
        });
    }
}

function mostrarOverlayLlamadaGrupal(g, onlineMembers) {
    document.getElementById('groupCallTitle').textContent = '📞 ' + g.name;
    document.getElementById('groupCallSubtitle').textContent = 'Llamando a ' + onlineMembers.length + ' miembro(s)…';
    document.getElementById('groupCallTimer').style.display = 'none';
    document.getElementById('groupCallTimer').textContent = '00:00';

    const avatarsEl = document.getElementById('groupCallAvatars');
    avatarsEl.innerHTML = onlineMembers.map(phone => {
        const uname = window._phoneToUsername[phone] || phone;
        const contact = myContacts.get(phone);
        const displayName = contact ? contact.customName : uname;
        const avatarUrl = contact
            ? (contact.avatar || userAvatars['__phone__' + phone] || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(uname)}`)
            : (userAvatars['__phone__' + phone] || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(uname)}`);
        return `<div class="group-call-participant calling" id="gcpart_${uname}">
            <img src="${avatarUrl}" alt="${escapeHTML(displayName)}">
            <div class="group-call-participant-name">${escapeHTML(displayName)}</div>
        </div>`;
    }).join('');

    const overlay = document.getElementById('groupCallOverlay');
    // Resetear posición al inicio de cada llamada
    overlay.style.left   = '';
    overlay.style.bottom = '';
    overlay.style.right  = '16px';
    overlay.classList.add('visible');

    // Hacer el panel arrastrable
    activarDragPanel(overlay);
}

function actualizarEstadoParticipante(username, state) {
    const el = document.getElementById('gcpart_' + username);
    if (!el) return;
    el.className = 'group-call-participant ' + state;
    const connectedCount = document.querySelectorAll('.group-call-participant.connected').length;
    if (connectedCount > 0) {
        document.getElementById('groupCallSubtitle').textContent = connectedCount + ' conectado(s)';
    }
}

function actualizarTimerGrupal() {
    if (!groupCallState.startTime) return;
    const elapsed = Math.floor((Date.now() - groupCallState.startTime) / 1000);
    const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    document.getElementById('groupCallTimer').textContent = m + ':' + s;
}

function toggleGroupMute() {
    if (!groupCallState.localStream) return;
    groupCallState.isMuted = !groupCallState.isMuted;
    groupCallState.localStream.getAudioTracks().forEach(t => t.enabled = !groupCallState.isMuted);
    const btn = document.getElementById('btnGroupCallMute');
    btn.textContent = groupCallState.isMuted ? '🔇' : '🎤';
    btn.classList.toggle('muted', groupCallState.isMuted);
}

function terminarLlamadaGrupal() {
    if (groupCallState.groupId) {
        socket.send(JSON.stringify({ type: 'group_call_ended', groupId: groupCallState.groupId }));
    }
    limpiarLlamadaGrupal();
}

function limpiarLlamadaGrupal() {
    if (groupCallState.timerInterval) { clearInterval(groupCallState.timerInterval); }
    Object.values(groupCallState.peers).forEach(({ pc }) => { try { pc.close(); } catch(e) {} });
    document.querySelectorAll('[id^="groupAudio_"]').forEach(el => { el.srcObject = null; el.remove(); });
    if (groupCallState.localStream) groupCallState.localStream.getTracks().forEach(t => t.stop());
    groupCallState = { groupId: null, peers: {}, localStream: null, timerInterval: null, startTime: null, isMuted: false };
    document.getElementById('groupCallOverlay').classList.remove('visible');
}

// --- Recibir llamada grupal (miembro) ---
let _pendingGroupOffer = null;

function recibirLlamadaGrupal(data) {
    _pendingGroupOffer = data;
    document.getElementById('incomingGroupName').textContent = data.from + ' · ' + data.groupName;
    document.getElementById('incomingGroupCall').classList.add('visible');
    playRingtone();
}

function aceptarLlamadaGrupal() {
    stopRingtone();
    document.getElementById('incomingGroupCall').classList.remove('visible');
    const offer = _pendingGroupOffer;
    if (!offer) return;

    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        groupCallState.groupId = offer.groupId;
        groupCallState.localStream = stream;
        groupCallState.peers = {};

        // Crear peer con el admin que llama
        const pc = new RTCPeerConnection(rtcConfig);
        groupCallState.peers[offer.from] = { pc };

        stream.getTracks().forEach(t => pc.addTrack(t, stream));

        pc.onicecandidate = (e) => {
            if (e.candidate) {
                socket.send(JSON.stringify({ type: 'group_call_ice', to: offer.from, groupId: offer.groupId, candidate: e.candidate }));
            }
        };

        pc.ontrack = (e) => {
            let audioEl = document.getElementById('groupAudio_' + offer.from);
            if (!audioEl) {
                audioEl = document.createElement('audio');
                audioEl.id = 'groupAudio_' + offer.from;
                audioEl.autoplay = true;
                audioEl.style.display = 'none';
                document.body.appendChild(audioEl);
            }
            audioEl.srcObject = e.streams[0];
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'connected' && !groupCallState.startTime) {
                groupCallState.startTime = Date.now();
            }
            if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
                limpiarLlamadaGrupal();
                addInfo('La llamada grupal ha finalizado.');
            }
        };

        pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp })
            .then(() => pc.createAnswer())
            .then(answer => pc.setLocalDescription(answer))
            .then(() => {
                socket.send(JSON.stringify({ type: 'group_call_answer', to: offer.from, groupId: offer.groupId, sdp: pc.localDescription.sdp }));
            });

        _pendingGroupOffer = null;
    }).catch(e => { alert('No se pudo acceder al micrófono: ' + e.message); rechazarLlamadaGrupal(); });
}

function rechazarLlamadaGrupal() {
    stopRingtone();
    document.getElementById('incomingGroupCall').classList.remove('visible');
    if (_pendingGroupOffer) {
        socket.send(JSON.stringify({ type: 'group_call_rejected', to: _pendingGroupOffer.from, groupId: _pendingGroupOffer.groupId }));
        _pendingGroupOffer = null;
    }
}

function onGroupCallAnswer(data) {
    const peer = groupCallState.peers[data.from];
    if (!peer) return;
    peer.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp }).catch(e => console.error('setRemoteDesc error:', e));
}

function onGroupCallIce(data) {
    const peer = groupCallState.peers[data.from];
    if (!peer || !data.candidate) return;
    peer.pc.addIceCandidate(data.candidate).catch(e => {});
}

function onGroupCallRejected(data) {
    actualizarEstadoParticipante(data.from, 'rejected');
    const peer = groupCallState.peers[data.from];
    if (peer) { try { peer.pc.close(); } catch(e) {} delete groupCallState.peers[data.from]; }
}

function onGroupCallEnded(data) {
    limpiarLlamadaGrupal();
    addInfo('La llamada grupal ha finalizado.');
}

// ============================================================
// DRAG — hace arrastrable un panel flotante (touch + mouse)
// ============================================================
function activarDragPanel(el) {
    // Evitar doble-bind
    if (el._dragBound) return;
    el._dragBound = true;

    let startX, startY, origLeft, origBottom;

    function onDown(e) {
        // Solo arrastrar desde el propio fondo del panel (no los botones)
        if (e.target.closest('button') || e.target.closest('img')) return;
        const touch = e.touches ? e.touches[0] : e;
        startX = touch.clientX;
        startY = touch.clientY;
        const rect = el.getBoundingClientRect();
        origLeft   = rect.left;
        origBottom = window.innerHeight - rect.bottom;
        // Fijar posición absoluta en left/bottom para el drag
        el.style.right  = 'auto';
        el.style.left   = origLeft + 'px';
        el.style.bottom = origBottom + 'px';
        document.addEventListener(e.touches ? 'touchmove' : 'mousemove', onMove, { passive: false });
        document.addEventListener(e.touches ? 'touchend'  : 'mouseup',   onUp);
    }
    function onMove(e) {
        e.preventDefault();
        const touch = e.touches ? e.touches[0] : e;
        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;
        let newLeft   = origLeft   + dx;
        let newBottom = origBottom - dy;
        // Mantener dentro de la ventana
        newLeft   = Math.max(0, Math.min(window.innerWidth  - el.offsetWidth,  newLeft));
        newBottom = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, newBottom));
        el.style.left   = newLeft   + 'px';
        el.style.bottom = newBottom + 'px';
    }
    function onUp(e) {
        document.removeEventListener(e.type === 'touchend' ? 'touchmove' : 'mousemove', onMove);
        document.removeEventListener(e.type,  onUp);
    }
    el.addEventListener('mousedown',  onDown);
    el.addEventListener('touchstart', onDown, { passive: false });
}

// ============================================================
