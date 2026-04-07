// GRABACIÓN Y ENVÍO DE AUDIOS
// ============================================================
let mediaRecorder = null;
let audioChunks = [];
let recTimerInterval = null;
let recSeconds = 0;
let isRecording = false;
let pendingAudio = null; // { dataUrl }

// Mapa de audios activos (id → HTMLAudioElement)
const audioElements = {};

function formatAudioTime(s) {
    if (!isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + ':' + String(sec).padStart(2,'0');
}

async function toggleGrabacion() {
    if (isRecording) {
        detenerGrabacion();
    } else {
        await iniciarGrabacion();
    }
}

async function iniciarGrabacion() {
    if (!currentChat) return;

    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch(e) {
        alert('No se pudo acceder al micrófono: ' + e.message);
        return;
    }

    // Elegir el formato más compatible
    const mimeType = getSupportedMimeType();
    const options = mimeType ? { mimeType } : {};

    mediaRecorder = new MediaRecorder(stream, options);
    audioChunks = [];
    isRecording = true;

    mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        // Usar el mimeType base sin ;codecs= para que el data URL sea limpio
        const blobType = (mimeType || 'audio/webm').split(';')[0];
        const blob = new Blob(audioChunks, { type: blobType });
        const reader = new FileReader();
        reader.onload = (ev) => {
            pendingAudio = { dataUrl: ev.target.result };
        };
        reader.readAsDataURL(blob);
    };

    mediaRecorder.start(200); // chunk cada 200ms

    // ── Visualización de forma de onda en tiempo real ──
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source   = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 32;
        source.connect(analyser);
        const dataArr   = new Uint8Array(analyser.frequencyBinCount);
        const waveEl    = document.getElementById('recWaveform');
        const bars      = waveEl ? [...waveEl.querySelectorAll('span')] : [];
        waveEl && waveEl.classList.add('live');
        let _waveRAF;
        const _animateWave = () => {
            analyser.getByteFrequencyData(dataArr);
            bars.forEach((bar, i) => {
                const val = dataArr[i % dataArr.length] || 0;
                const h = Math.max(4, Math.round((val / 255) * 24));
                bar.style.height = h + 'px';
            });
            _waveRAF = requestAnimationFrame(_animateWave);
        };
        _animateWave();
        // Guardar referencia para cancelar al detener
        window._recWaveRAF     = _waveRAF;
        window._recAudioCtx    = audioCtx;
        window._recWaveAnimate = _animateWave;
        window._recWaveRAFRef  = { raf: _waveRAF };
        // Actualizar referencia en cada frame
        const _wrapAnimate = () => {
            analyser.getByteFrequencyData(dataArr);
            bars.forEach((bar, i) => {
                const val = dataArr[i % dataArr.length] || 0;
                bar.style.height = Math.max(4, Math.round((val / 255) * 24)) + 'px';
            });
            window._recWaveRAFRef.raf = requestAnimationFrame(_wrapAnimate);
        };
        cancelAnimationFrame(_waveRAF);
        window._recWaveRAFRef.raf = requestAnimationFrame(_wrapAnimate);
    } catch(_) { /* si falla la visualización, no bloquear la grabación */ }

    // UI
    document.getElementById('audioRecordBar').classList.add('visible');
    document.getElementById('btnMic').textContent = '⏹️';
    document.getElementById('btnMic').style.background = '#fecaca';

    // Notificar al destinatario que estamos grabando
    _enviarEstadoGrabacion('start');

    recSeconds = 0;
    actualizarRecTimer();
    recTimerInterval = setInterval(() => {
        recSeconds++;
        actualizarRecTimer();
        // Límite de 3 minutos
        if (recSeconds >= 180) detenerGrabacion();
    }, 1000);
}

function detenerGrabacion() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
    mediaRecorder.stop();
    isRecording = false;
    clearInterval(recTimerInterval);
    // Notificar que dejamos de grabar
    _enviarEstadoGrabacion('stop');
    // Detener animación de onda
    if (window._recWaveRAFRef) { cancelAnimationFrame(window._recWaveRAFRef.raf); window._recWaveRAFRef = null; }
    if (window._recAudioCtx)   { try { window._recAudioCtx.close(); } catch(_) {} window._recAudioCtx = null; }
    const waveEl = document.getElementById('recWaveform');
    if (waveEl) { waveEl.classList.remove('live'); [...waveEl.querySelectorAll('span')].forEach(s => s.style.height = ''); }
    document.getElementById('btnMic').textContent = '🎙️';
    document.getElementById('btnMic').style.background = '';
}

function actualizarRecTimer() {
    const m = Math.floor(recSeconds / 60);
    const s = String(recSeconds % 60).padStart(2,'0');
    document.getElementById('recTimer').textContent = m + ':' + s;
}

function cancelarAudio() {
    detenerGrabacion();
    pendingAudio = null;
    audioChunks = [];
    document.getElementById('audioRecordBar').classList.remove('visible');
}

function enviarAudio() {
    // Esperar a que onstop haya generado pendingAudio
    const esperar = () => {
        if (!pendingAudio) { setTimeout(esperar, 80); return; }
        doEnviarAudio();
    };

    detenerGrabacion();
    document.getElementById('audioRecordBar').classList.remove('visible');

    // Si ya tenemos el dataUrl listo (grabación muy corta puede no estar lista aún)
    if (pendingAudio) {
        doEnviarAudio();
    } else {
        setTimeout(esperar, 100);
    }
}

function doEnviarAudio() {
    if (!pendingAudio || !currentChat || !socket) return;
    if (socket.readyState !== WebSocket.OPEN) {
        mostrarToast('Sin conexión. Inténtalo de nuevo.', true);
        pendingAudio = null;
        return;
    }

    // Validar tamaño (~5MB máx)
    const approxBytes = pendingAudio.dataUrl.length * 0.75;
    if (approxBytes > 5 * 1024 * 1024) {
        alert('El audio es demasiado largo. Máximo 3 minutos.');
        pendingAudio = null;
        return;
    }

    if (currentChat.startsWith('group_')) {
        // ── Mensaje de grupo ──
        const groupId = currentChat.replace('group_', '');
        socket.send(JSON.stringify({
            type: 'groupMessage',
            groupId,
            message: '',
            audioData: pendingAudio.dataUrl
        }));
        // Preview local en el chat de grupo
        const grpKey = 'group_' + groupId;
        const localGrpAudio = {
            id: 'local_' + Date.now(),
            from: username,
            to: groupId,
            groupId,
            message: '',
            audioData: pendingAudio.dataUrl,
            time: new Date(),
            avatar: myAvatarDataUrl
        };
        if (!conversations[grpKey]) conversations[grpKey] = [];
        conversations[grpKey].push(localGrpAudio);
        addGroupMessage(localGrpAudio);
    } else if (currentChat.startsWith('phone:')) {
        // ── Contacto offline: enviar por teléfono ──
        const toPhone = currentChat.replace('phone:', '');
        socket.send(JSON.stringify({
            type: 'message',
            toPhone,
            message: '',
            audioData: pendingAudio.dataUrl
        }));
        // Preview local
        const localOffAudio = {
            id: 'local_' + Date.now(),
            from: username,
            to: null,
            toPhone,
            message: '',
            audioData: pendingAudio.dataUrl,
            time: new Date(),
            self: true,
            avatar: myAvatarDataUrl
        };
        if (!conversations[currentChat]) conversations[currentChat] = [];
        conversations[currentChat].push(localOffAudio);
        addMessage(localOffAudio);
    } else {
        // ── Chat 1:1 con usuario online ──
        socket.send(JSON.stringify({
            type: 'message',
            to: currentChat,
            message: '',
            audioData: pendingAudio.dataUrl
        }));
        // Preview local
        const localAudio = {
            id: 'local_' + Date.now(),
            from: username,
            to: currentChat,
            message: '',
            audioData: pendingAudio.dataUrl,
            time: new Date(),
            self: true,
            avatar: myAvatarDataUrl
        };
        if (!conversations[currentChat]) conversations[currentChat] = [];
        conversations[currentChat].push(localAudio);
        addMessage(localAudio);
    }

    pendingAudio = null;
    audioChunks = [];
}

function getSupportedMimeType() {
    // Preferimos tipos sin ;codecs= para que el base64 resultante
    // tenga un mime type limpio que el servidor pueda validar fácilmente.
    // Orden: webm > ogg > mp4 > sin especificar
    const types = [
        'audio/webm',
        'audio/ogg',
        'audio/mp4',
    ];
    for (const t of types) {
        if (MediaRecorder.isTypeSupported(t)) return t;
    }
    // Fallback: usar lo que el navegador elija
    return '';
}

// ============================================================
// REPRODUCTOR DE AUDIOS EN CHAT
// ============================================================
function toggleAudioPlay(audioId) {
    const audioEl = document.getElementById(audioId);
    const playBtn = document.getElementById('playbtn_' + audioId);
    const waveEl  = document.getElementById('wave_' + audioId);
    if (!audioEl) return;

    // Pausar cualquier otro audio en reproducción
    document.querySelectorAll('audio').forEach(a => {
        if (a.id !== audioId && !a.paused) {
            a.pause();
            const ob = document.getElementById('playbtn_' + a.id);
            const ow = document.getElementById('wave_' + a.id);
            if (ob) ob.textContent = '▶';
            if (ow) ow.classList.remove('playing');
        }
    });

    if (audioEl.paused) {
        audioEl.play();
        if (playBtn) playBtn.textContent = '⏸';
        if (waveEl) waveEl.classList.add('playing');
        // Notificar al servidor que escuchamos el audio (solo si no es nuestro)
        const msgId = audioId.startsWith('aud_') ? audioId.slice(4) : audioId;
        const row = audioEl.closest ? null : document.querySelector(`[data-msgid="${msgId}"]`);
        const isMine = row
            ? row.classList.contains('me')
            : !!document.querySelector(`.msg-row.me[data-msgid="${msgId}"]`);
        if (!isMine && socket && socket.readyState === WebSocket.OPEN && !audioEl._readSent) {
            audioEl._readSent = true;
            socket.send(JSON.stringify({ type: 'audioRead', id: msgId }));
        }
    } else {
        audioEl.pause();
        if (playBtn) playBtn.textContent = '▶';
        if (waveEl) waveEl.classList.remove('playing');
    }
}

function seekAudio(audioId, value) {
    const audioEl = document.getElementById(audioId);
    if (!audioEl || !audioEl.duration) return;
    audioEl.currentTime = (value / 100) * audioEl.duration;
}

// ============================================================
