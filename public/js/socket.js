// WEBSOCKET
// ============================================================
let reconnectInterval = 500;
let _esSesionNueva = true; // true en login fresco, false en reconexión automática
let reconnectTimer = null;

function conectarWS() {

    // 🚫 Evitar múltiples conexiones
    if (socket && (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
    )) {
        return;
    }

    username = loginUsername;
    pedirPermisoNotificaciones();

    const wsProtocol = location.protocol === 'https:' ? 'wss://' : 'ws://';
    const wsHost     = location.host;

    socket = new WebSocket(wsProtocol + wsHost);

    socket.onopen = () => {
        console.log('✅ Conectado');

        conectado = true;
        reconnectInterval = 500; // reset
        _mostrarBannerOffline(false); // ocultar banner offline al reconectar
        window._kvsJoinTimestamp = Date.now(); // marcar el momento del join
        // Inicializar flag de presencia según el estado actual del documento
        window._appIsAway = (document.visibilityState === 'hidden');

        // Capturar si es sesión nueva ANTES de modificar el flag
        const _fueNuevaSesion = _esSesionNueva;

        if (_esSesionNueva) {
            // ── Login fresco: limpiar TODO el estado del usuario anterior ──
            _limpiarEstadoGlobal();
            _esSesionNueva = false; // próximas reconexiones no limpian
        } else {
            // ── Reconexión automática: solo invalidar caché de mensajes ──
            Object.keys(conversations).forEach(k => delete conversations[k]);
        }

        // Guardar el chat que estaba abierto para reabrirlo tras reconectar
        // (solo relevante en reconexión; en login fresco _limpiarEstadoGlobal ya borró currentChat)
        const _chatAnterior = currentChat;

        socket.send(JSON.stringify({
            type: 'join',
            username,
            phone: loginPhone,
            avatar: myAvatarDataUrl,
            deviceInfo: (() => {
                const ua = navigator.userAgent;
                if (/iPhone/.test(ua))  return 'iPhone';
                if (/iPad/.test(ua))    return 'iPad';
                if (/Android/.test(ua)) return 'Android';
                if (/Macintosh/.test(ua)) return 'Mac';
                if (/Windows/.test(ua)) return 'Windows';
                if (/Linux/.test(ua))   return 'Linux';
                return 'Dispositivo desconocido';
            })()
        }));

        // Si había un chat abierto y es una RECONEXIÓN (no login fresco), recargar historial
        if (_chatAnterior && !_fueNuevaSesion) {
            setTimeout(() => {
                if (!currentChat || !socket || socket.readyState !== WebSocket.OPEN) return;
                if (currentChat.startsWith('group_')) {
                    socket.send(JSON.stringify({ type: 'loadGroupConversation', groupId: currentChat.replace('group_', '') }));
                } else if (currentChat.startsWith('phone:')) {
                    socket.send(JSON.stringify({ type: 'loadConversation', withPhone: currentChat.replace('phone:', '') }));
                } else {
                    socket.send(JSON.stringify({ type: 'loadConversation', with: currentChat }));
                }
            }, 400);
        }

        // Informar presencia inicial (puede haberse conectado desde background)
        if (document.visibilityState === 'hidden') {
            socket.send(JSON.stringify({ type: 'set_presence', status: 'away' }));
        } else {
            // Iniciar heartbeat JS inmediatamente
            _iniciarHeartbeat();
        }

        input.disabled = false;
        input.focus();
        document.getElementById('btnMic').style.display = 'flex';

        cargarContactos();
        cargarGrupos();
        cargarConfiguracionUsuario();

        // Suscribir (o renovar suscripción) al push tras conectar
        _suscribirAPush().catch(() => {});

        // Si venimos de una notificación push con chat pendiente, abrirlo
        // en cuanto hayan cargado los contactos/grupos (sin timeout fijo)
        if (window._pendingOpenChat) {
            _abrirChatPendienteDesdeNotif();
        }
    };

    socket.onmessage = (event) => {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch(e) {
            console.warn('[WS] Mensaje JSON inválido:', e.message);
            return;
        }
        handleMessage(data);
    };

    socket.onerror = (error) => {
        console.warn('⚠️ Error WebSocket:', error);
    };

    socket.onclose = () => {
        console.log('❌ Desconectado');
        conectado = false;
        _pararHeartbeat();
        _mostrarBannerOffline(true);
        // Solo programar reconexión automática si la app está visible.
        // Si está en background, el visibilitychange lo hará al volver.
        if (document.visibilityState !== 'hidden') {
            intentarReconexion();
        }
    };
}

// ── Heartbeat JS: envía kvs_ping cada 15s mientras la app está en primer plano ──
// El servidor marca al usuario como "ausente" si no recibe ping en 25s,
// y como "desconectado" si no recibe ping en 55s.
// Esto es mucho más fiable que el TCP ping/pong porque solo el JS activo puede enviarlo.
let _heartbeatTimer = null;
const PING_INTERVAL = 15000; // 15s

function _iniciarHeartbeat() {
    _pararHeartbeat(); // limpiar cualquier timer previo
    _heartbeatTimer = setInterval(() => {
        if (socket && socket.readyState === WebSocket.OPEN
            && document.visibilityState !== 'hidden') {
            try {
                socket.send(JSON.stringify({ type: 'kvs_ping' }));
            } catch(_) {}
        }
    }, PING_INTERVAL);
    // Enviar uno inmediatamente para resetear el timer del servidor
    if (socket && socket.readyState === WebSocket.OPEN) {
        try { socket.send(JSON.stringify({ type: 'kvs_ping' })); } catch(_) {}
    }
}

function _pararHeartbeat() {
    if (_heartbeatTimer) {
        clearInterval(_heartbeatTimer);
        _heartbeatTimer = null;
    }
}
function intentarReconexion() {
    if (reconnectTimer) return;

    reconnectTimer = setTimeout(() => {
        console.log('🔄 Intentando reconectar...');
        reconnectTimer = null;
        reconnectInterval = Math.min(reconnectInterval * 1.5, 5000);
        conectarWS();
    }, reconnectInterval);
}

// ── Helper: actualiza el chatStatus del chat abierto cuando cambia presencia ──
function _formatLastSeen(isoDate) {
    if (!isoDate) return null;
    const d = new Date(isoDate);
    if (isNaN(d)) return null;
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    const diffH   = Math.floor(diffMs / 3600000);
    const diffD   = Math.floor(diffMs / 86400000);
    if (diffMin < 1)  return 'visto hace un momento';
    if (diffMin < 60) return `visto hace ${diffMin} min`;
    if (diffH < 24)   return `visto hoy a las ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
    if (diffD === 1)  return `visto ayer a las ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
    return `visto el ${d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })} a las ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
}

function _actualizarChatStatusPresencia() {
    if (!currentChat || currentChat.startsWith('group_')) return;
    let targetUsername = currentChat;
    if (currentChat.startsWith('phone:')) {
        const ph = currentChat.replace('phone:', '');
        targetUsername = window._phoneToUsername ? window._phoneToUsername[ph] : null;
        if (!targetUsername) return;
    }
    const isOnline = lastKnownUsers.includes(targetUsername);
    const isAway   = isOnline && window._awayUsers && window._awayUsers.has(targetUsername);
    let statusText, statusColor;
    if (isOnline && !isAway) {
        statusText  = '● En línea';
        statusColor = 'var(--online)';
    } else if (isAway) {
        statusText  = '🌙 Ausente';
        statusColor = '#f59e0b';
    } else {
        // Mostrar "última vez visto" si lo tenemos
        const lastSeen = userLastSeen[targetUsername];
        statusText  = lastSeen ? _formatLastSeen(lastSeen) : '○ Desconectado';
        statusColor = 'var(--text-muted)';
    }
    document.getElementById('chatStatus').textContent = statusText;
    document.getElementById('chatStatus').style.color = statusColor;
}

// ── Reconexión limpia + reporte de presencia al volver de background ──────────
// Al pasar a background:  parar heartbeat + notificar al servidor estado 'away'.
// Al volver al foreground: reanudar heartbeat + notificar 'active'.
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        // App va a background → parar heartbeat y marcar ausente
        window._appIsAway = true;
        _pararHeartbeat();
        if (socket && socket.readyState === WebSocket.OPEN) {
            try {
                socket.send(JSON.stringify({ type: 'set_presence', status: 'away' }));
            } catch(_) {}
        }
    } else {
        // App vuelve al foreground
        window._appIsAway = false;
        console.log('👀 Usuario volvió → reconexión limpia');

        // Si hay un chat activo, marcar sus mensajes como leídos ahora que el usuario los ve
        if (currentChat && socket && socket.readyState === WebSocket.OPEN) {
            try {
                const mkKey = currentChat.startsWith('phone:')
                    ? (window._phoneToUsername && window._phoneToUsername[currentChat.replace('phone:', '')]) || currentChat
                    : currentChat;
                socket.send(JSON.stringify({ type: 'markRead', chatKey: mkKey }));
            } catch(_) {}
        }

        // 1. Cancelar timer de reconexión pendiente
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }

        // 2. Si el socket no está OPEN, cerrarlo silenciosamente y reconectar
        if (socket && socket.readyState !== WebSocket.OPEN) {
            socket.onclose = null;
            socket.onerror = null;
            try { socket.close(); } catch(_) {}
            socket = null;
        }

        reconnectInterval = 500;

        if (socket && socket.readyState === WebSocket.OPEN) {
            // Socket sigue vivo → reanudar heartbeat y marcar activo
            try {
                socket.send(JSON.stringify({ type: 'set_presence', status: 'active' }));
            } catch(_) {}
            _iniciarHeartbeat();
        } else {
            // Socket muerto → reconectar (el onopen iniciará el heartbeat)
            conectarWS();
        }
    }
});

window.addEventListener('online', () => {
    console.log('🌐 Internet volvió');
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    if (socket && socket.readyState !== WebSocket.OPEN) {
        socket.onclose = null;
        socket.onerror = null;
        try { socket.close(); } catch(_) {}
        socket = null;
    }
    reconnectInterval = 500;
    conectarWS();
});

// ============================================================
// EMOJI PICKER
// ============================================================
emojiPicker.addEventListener('emoji-click', (e) => {
    const emoji = e.detail.unicode;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const before = input.value.slice(0, start);
    const after = input.value.slice(end);
    input.value = before + emoji + after;
    input.selectionStart = input.selectionEnd = start + emoji.length;
    input.focus();
    actualizarBtnEnviar();
});

function toggleEmoji() {
    // El emoji picker está ahora integrado en el panel unificado — abrir en pestaña emojis
    if (_sgOpen && _sgTab === 'emojis') {
        cerrarSGPanel();
    } else {
        _sgTab = 'emojis';
        _sgOpen = false; // forzar apertura limpia
        toggleStickerGiftPanel(null);
    }
}

// (El cierre del panel unificado lo gestiona el listener global en renderSGPanel)

// ============================================================
// IMAGEN
// ============================================================
// ── Comprimir imagen antes de enviarla ──────────────────────────────────────
// Redimensiona al máximo 1200px y comprime al 82% JPEG con Canvas.
// No requiere librerías externas. Si la imagen ya es pequeña, no la agranda.
function comprimirImagen(file, callback) {
    const MAX_PX   = 1200;
    const QUALITY  = 0.82;
    const reader   = new FileReader();
    reader.onload  = (ev) => {
        const img  = new Image();
        img.onload = () => {
            let { width, height } = img;
            // Solo reducir, nunca agrandar
            if (width > MAX_PX || height > MAX_PX) {
                const ratio = Math.min(MAX_PX / width, MAX_PX / height);
                width  = Math.round(width  * ratio);
                height = Math.round(height * ratio);
            }
            const canvas = document.createElement('canvas');
            canvas.width  = width;
            canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);
            callback(dataUrl);
        };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
}

function seleccionarImagen(event) {
    const file = event.target.files[0];
    if (!file) return;
    comprimirImagen(file, (dataUrl) => {
        pendingImage = { dataUrl, file };
        imgPreviewEl.src = dataUrl;
        document.getElementById('imgPreviewName').textContent = file.name;
        imgPreviewContainer.classList.add('visible');
        actualizarBtnEnviar();
    });
}

document.addEventListener('paste', (e) => {
    if (!conectado || !currentChat) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let item of items) {
        if (item.type.startsWith('image/')) {
            const file = item.getAsFile();
            comprimirImagen(file, (dataUrl) => {
                pendingImage = { dataUrl, file };
                imgPreviewEl.src = dataUrl;
                document.getElementById('imgPreviewName').textContent = 'Imagen del portapapeles';
                imgPreviewContainer.classList.add('visible');
                actualizarBtnEnviar();
            });
            break;
        }
    }
});

function cancelarImagen() {
    pendingImage = null;
    imgPreviewContainer.classList.remove('visible');
    document.getElementById('fileInput').value = '';
    actualizarBtnEnviar();
}

// ============================================================
// LIGHTBOX
// ============================================================
function openLightbox(src) {
    document.getElementById('lightboxImg').src = src;
    document.getElementById('lightbox').classList.add('visible');
}

function closeLightbox() {
    document.getElementById('lightbox').classList.remove('visible');
}

// ============================================================
// UTILS
// ============================================================
function horaActual(date) {
    return new Date(date || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function obtenerDia(date) {
    const d = new Date(date);
    const hoy = new Date();
    return d.toDateString() === hoy.toDateString() ? 'Hoy' : d.toLocaleDateString();
}

function _actualizarIndicadorPaginacion() {
    const el = document.getElementById('historyLoadingIndicator');
    if (!el) return;
    // Mostrar el indicador de "scroll para cargar más" solo si hay mensajes anteriores
    el.style.display = _historyHasMore ? 'flex' : 'none';
    el.textContent   = _historyHasMore ? '⬆ Cargando mensajes anteriores…' : '';
}

function scrollChat() {
    chat.scrollTop = chat.scrollHeight;
}

let _scrollRafId = null;
chat.addEventListener('scroll', () => {
    if (_scrollRafId) return;
    _scrollRafId = requestAnimationFrame(() => {
        autoScroll = (chat.scrollHeight - chat.scrollTop - chat.clientHeight) < 50;

        // Scroll infinito hacia arriba: cuando el usuario llega al top, cargar página anterior
        if (chat.scrollTop < 80 && _historyHasMore && !_historyLoading && _historyOldestId && socket && socket.readyState === WebSocket.OPEN) {
            _cargarHistorialAnterior();
        }

        _scrollRafId = null;
    });
}, { passive: true });

function _cargarHistorialAnterior() {
    if (_historyLoading || !_historyHasMore || !_historyOldestId) return;
    _historyLoading = true;
    // Mostrar indicador de carga al top
    const loadingEl = document.getElementById('historyLoadingIndicator');
    if (loadingEl) loadingEl.style.display = 'flex';

    if (currentChat && currentChat.startsWith('group_')) {
        socket.send(JSON.stringify({
            type:     'loadGroupConversation',
            groupId:  currentChat.replace('group_', ''),
            beforeId: _historyOldestId
        }));
    } else if (currentChat && currentChat.startsWith('phone:')) {
        socket.send(JSON.stringify({
            type:      'loadConversation',
            withPhone: currentChat.replace('phone:', ''),
            beforeId:  _historyOldestId
        }));
    } else if (currentChat) {
        socket.send(JSON.stringify({
            type:     'loadConversation',
            with:     currentChat,
            beforeId: _historyOldestId
        }));
    }
}

function actualizarBtnEnviar() {
    // Habilitado si: hay texto, hay imagen pendiente, o estamos editando con texto
    btnEnviar.disabled = (input.value.trim() === '' && !pendingImage && !_editState);
}

// ============================================================
// MANEJADOR MENSAJES WEBSOCKET
// ============================================================
function handleMessage(data) {

    if (data.type === 'history') {
        const chatKey = currentChat;
        const isLoadMore = !!data.isLoadMore;

        // Ocultar indicador de carga
        _historyLoading = false;
        const loadingEl = document.getElementById('historyLoadingIndicator');
        if (loadingEl) loadingEl.style.display = 'none';

        // Actualizar paginación
        _historyHasMore = !!data.hasMore;
        if (data.messages && data.messages.length > 0) {
            _historyOldestId = data.messages[0].id;
        }

        // Obtener lista de mensajes ocultos localmente
        let _hiddenMsgs;
        try { _hiddenMsgs = new Set(JSON.parse(localStorage.getItem('kvs_hidden_msgs') || '[]')); }
        catch(_) { _hiddenMsgs = new Set(); }

        if (!isLoadMore) {
            // Primera carga: reemplazar todo el historial
            // (incluye el caso donde el array existía con __onlyPending = true)
            conversations[chatKey] = data.messages;
            // Limpiar el flag __onlyPending ya que ahora tenemos el historial completo
            delete conversations[chatKey].__onlyPending;
            if (data.withUsername && currentChat.startsWith('phone:')) {
                conversations[data.withUsername] = data.messages;
            }
            chat.innerHTML = '';
            let lastDay = '';
            window._kvsLoadingHistory = true;
            data.messages.forEach(msg => {
                if (_hiddenMsgs.has(msg.id)) return;
                const day = obtenerDia(msg.time);
                if (day !== lastDay) { addDaySeparator(day); lastDay = day; }
                addMessage(msg);
            });
            window._kvsLoadingHistory = false;
            // Mostrar indicador de "más mensajes" al top si hay paginación
            _actualizarIndicadorPaginacion();
            // Informar al servidor que hemos leído esta conversación
            // (marca en BD + notifica a los remitentes + resetea contador push)
            if (socket && socket.readyState === WebSocket.OPEN && chatKey) {
                const markKey = chatKey.startsWith('phone:')
                    ? (window._phoneToUsername && window._phoneToUsername[chatKey.replace('phone:', '')])
                        || chatKey
                    : chatKey;
                try { socket.send(JSON.stringify({ type: 'markRead', chatKey: markKey })); } catch(_) {}
            }
            // Actualizar badge inmediatamente tras cargar el historial
            renderContactsList();
            renderGroupsList();
        } else {
            // Load more: PREPEND mensajes al inicio, conservando posición de scroll
            if (!conversations[chatKey]) conversations[chatKey] = [];
            conversations[chatKey].unshift(...data.messages);

            const scrollHeightBefore = chat.scrollHeight;
            const scrollTopBefore    = chat.scrollTop;

            // Crear un contenedor temporal, renderizar ahí, luego mover al inicio
            const tempList = document.createElement('ul');
            tempList.style.display = 'none';
            document.body.appendChild(tempList);

            // Guardar y redirigir temporalmente el chat target
            const realChat = chat;
            // Monkey-patch appendChild para redirigir a tempList
            const origAppendChild  = realChat.appendChild.bind(realChat);
            const origInsertBefore = realChat.insertBefore.bind(realChat);
            realChat.appendChild  = (n) => tempList.appendChild(n);
            realChat.insertBefore = (n, ref) => tempList.insertBefore(n, ref);

            let lastDay = '';
            window._kvsLoadingHistory = true;
            data.messages.forEach(msg => {
                if (_hiddenMsgs.has(msg.id)) return;
                const day = obtenerDia(msg.time);
                if (day !== lastDay) {
                    const sep = document.createElement('li');
                    sep.className = 'day-separator';
                    sep.textContent = day;
                    tempList.appendChild(sep);
                    lastDay = day;
                }
                addMessage(msg);
            });
            window._kvsLoadingHistory = false;

            // Restaurar métodos originales
            realChat.appendChild  = origAppendChild;
            realChat.insertBefore = origInsertBefore;

            // Mover los nodos renderizados al inicio del chat real
            const nodes = [...tempList.childNodes];
            nodes.reverse().forEach(n => {
                realChat.insertBefore(n, realChat.firstChild);
            });
            document.body.removeChild(tempList);

            // Restaurar posición de scroll para que no salte
            chat.scrollTop = scrollTopBefore + (chat.scrollHeight - scrollHeightBefore);

            _actualizarIndicadorPaginacion();
        }
        return;
    }

    if (data.type === 'message') {
        // Ignorar mensajes de llamada perdida aquí — se tratan por separado
        if (data.message === '__missed_call__') {
            mostrarLlamadaPerdida(data);
            return;
        }

        // Mensajes de hilo: se gestionan por thread_message, ignorar aquí
        if (data.threadId) return;

        // isEcho: true  → el servidor confirma que NOSOTROS enviamos este mensaje
        // isEcho: false → mensaje recibido DE otro usuario
        // Para compatibilidad con mensajes del historial (sin isEcho), usar from===username como fallback
        const isOwnMsg = data.isEcho === true || (data.isEcho === undefined && data.from === username);

        let otherUser = isOwnMsg ? data.to : (data.to === username ? data.from : null);
        // Fallback: si to no coincide con username pero from coincide, es eco
        if (!otherUser && data.from === username) { otherUser = data.to; }
        if (!otherUser) return;

        // Actualizar caché de avatar del remitente
        if (data.avatar && !isOwnMsg) {
            userAvatars[data.from] = data.avatar;
            if (window._phoneToUsername) {
                const senderPhone = Object.entries(window._phoneToUsername).find(([ph, un]) => un === data.from)?.[0];
                if (senderPhone && myContacts.has(senderPhone)) {
                    const c = myContacts.get(senderPhone);
                    c.avatar = data.avatar;
                    myContacts.set(senderPhone, c);
                    userAvatars['__phone__' + senderPhone] = data.avatar;
                }
            }
        }

        // Determinar el chatKey
        let chatKey = otherUser;
        if (window._phoneToUsername) {
            const phone = Object.entries(window._phoneToUsername).find(([ph, un]) => un === otherUser)?.[0];
            if (phone && currentChat === 'phone:' + phone) {
                chatKey = 'phone:' + phone;
            }
        }

        if (!conversations[chatKey]) {
            conversations[chatKey] = [];
            // __onlyPending solo para mensajes entrantes de otro usuario en ventana de join
            if (!isOwnMsg &&
                window._kvsJoinTimestamp && (Date.now() - window._kvsJoinTimestamp) < 4000) {
                conversations[chatKey].__onlyPending = true;
            }
        }
        if (!conversations[otherUser]) conversations[otherUser] = conversations[chatKey];

        // Gestión del array: evitar duplicados y sustituir local_ por ID real
        if (!conversations[chatKey].some(m => m.id === data.id)) {
            if (isOwnMsg) {
                // Eco propio: buscar local_ coincidente y sustituir
                const localIdx = conversations[chatKey].findIndex(m =>
                    typeof m.id === 'string' && m.id.startsWith('local_') && (
                        (data.imageData  && m.imageData)  ||
                        (data.audioData  && m.audioData)  ||
                        (!data.imageData && !data.audioData && (m.message || '') === (data.message || ''))
                    )
                );
                if (localIdx >= 0) {
                    if (conversations[chatKey][localIdx].editedAt && !data.editedAt) {
                        data.editedAt = conversations[chatKey][localIdx].editedAt;
                    }
                    conversations[chatKey][localIdx] = { ...data, delivered: true };
                } else {
                    conversations[chatKey].push(data);
                }
            } else {
                conversations[chatKey].push(data);
            }
        }

        const preview = data.imageData ? '📷 Imagen'
            : data.audioData ? '🎙️ Audio'
            : data.message;
        lastMessages[chatKey]   = preview;
        lastMessages[otherUser] = preview;

        // Registrar actividad reciente del contacto para ordenación
        if (!isOwnMsg) {
            window._contactLastActivity = window._contactLastActivity || {};
            if (window._phoneToUsername) {
                const senderPhone = Object.entries(window._phoneToUsername).find(([ph, un]) => un === data.from)?.[0];
                if (senderPhone) window._contactLastActivity[senderPhone] = Date.now();
            }
        }

        if (currentChat === chatKey || currentChat === otherUser) {
            // Limpiar contador de no leídos y notificaciones push ya que el chat está activo
            if (!isOwnMsg) {
                unreadCounts[chatKey]   = 0;
                unreadCounts[otherUser] = 0;
                if (window._phoneToUsername) {
                    const phone = Object.entries(window._phoneToUsername).find(([,un]) => un === data.from)?.[0];
                    if (phone) {
                        unreadCounts['phone:' + phone] = 0;
                        unreadCounts[phone] = 0;
                    }
                }
                _cerrarNotificacionesDeChat(chatKey);
            }
            if (isOwnMsg) {
                // Eco propio: actualizar el local_ en el DOM con el ID real
                const localRows = [...chat.querySelectorAll('.msg-row.me[data-msgid^="local_"]')];
                let matchedRow = null;
                for (const lr of localRows) {
                    const bubble = lr.querySelector('.bubble');
                    if (!bubble) continue;
                    const textEl = bubble.querySelector('.msg-text');
                    const imgEl  = bubble.querySelector('.img-msg');
                    const rowHasImg = !!imgEl;
                    let rowText = '';
                    if (textEl) {
                        const cloned = textEl.cloneNode(true);
                        cloned.querySelectorAll('.reply-preview,.forward-label,.meta,.edited-label,.star-badge,.estado,.hora,.audio-msg-wrap').forEach(el => el.remove());
                        rowText = cloned.textContent.trim();
                    }
                    if (data.imageData && rowHasImg) { matchedRow = lr; break; }
                    if (data.audioData && bubble.querySelector('.audio-msg-wrap')) { matchedRow = lr; break; }
                    if (!data.imageData && !data.audioData && rowText === (data.message || '').trim()) { matchedRow = lr; break; }
                }
                // Fallback: último local_ si no hay match por contenido
                if (!matchedRow && localRows.length > 0) {
                    matchedRow = localRows[localRows.length - 1];
                }
                if (matchedRow) {
                    const oldLocalId = matchedRow.dataset.msgid;
                    matchedRow.dataset.msgid = data.id;
                    const bubble = matchedRow.querySelector('.bubble');
                    if (bubble) bubble.id = data.id;
                    const estadoEl = bubble ? bubble.querySelector(`#estado_${oldLocalId}`) : null;
                    if (estadoEl) estadoEl.id = `estado_${data.id}`;
                    // Actualizar el id en todos los arrays de conversations
                    for (const arr of Object.values(conversations)) { if (!Array.isArray(arr)) continue;
                        if (!Array.isArray(arr)) continue;
                        const localIdx = arr.findIndex(m => m.id === oldLocalId);
                        if (localIdx >= 0) {
                            if (arr[localIdx].editedAt && !data.editedAt) {
                                data.editedAt = arr[localIdx].editedAt;
                            }
                            arr[localIdx].id        = data.id;
                            arr[localIdx].delivered = true;
                            if (data.read) arr[localIdx].read = true;
                            const dupIdx = arr.findIndex((m, i) => i !== localIdx && m.id === data.id);
                            if (dupIdx >= 0) arr.splice(dupIdx, 1);
                        } else {
                            // El local_ ya fue sustituido en el array: actualizar estado por ID real
                            const realIdx = arr.findIndex(m => m.id === data.id);
                            if (realIdx >= 0) {
                                arr[realIdx].delivered = true;
                                if (data.read) arr[realIdx].read = true;
                            }
                        }
                    }
                    // Aplicar estado correcto si read/delivered llegaron antes del eco
                    if (data.read) {
                        if (estadoEl) estadoEl.textContent = '✔✔ leído';
                    } else if (data.delivered) {
                        if (estadoEl) estadoEl.textContent = '✔✔';
                    }
                    _attachBubbleClickMenu(matchedRow, data.id, true, false,
                        currentChat.startsWith('group_'));

                    // Si había una eliminación pendiente para este mensaje local, enviarla ahora
                    if (window._pendingDeletes && window._pendingDeletes[oldLocalId]) {
                        delete window._pendingDeletes[oldLocalId];
                        if (socket && socket.readyState === WebSocket.OPEN) {
                            socket.send(JSON.stringify({ type: 'deleteMessage', id: data.id }));
                        }
                        const rowStill = document.querySelector(`[data-msgid="${data.id}"]`);
                        if (rowStill) rowStill.remove();
                        Object.values(conversations).forEach(arr => { if (!Array.isArray(arr)) return;
                            if (!Array.isArray(arr)) return;
                            const idx = arr.findIndex(m => m.id === data.id);
                            if (idx >= 0) arr.splice(idx, 1);
                        });
                        return;
                    }

                    // Si había una edición pendiente para este mensaje local, enviarla ahora
                    if (window._pendingEdits && window._pendingEdits[oldLocalId]) {
                        const pendingText = window._pendingEdits[oldLocalId];
                        delete window._pendingEdits[oldLocalId];
                        if (socket && socket.readyState === WebSocket.OPEN) {
                            socket.send(JSON.stringify({ type: 'editMessage', id: data.id, newText: pendingText }));
                        }
                    }
                } else {
                    // No hay local_ en el DOM: solo añadir si no está ya renderizado
                    const yaRenderizado = !!document.querySelector(`[data-msgid="${data.id}"]`);
                    if (!yaRenderizado) addMessage(data);
                }
            } else {
                addMessage(data);
            }
        } else {
            // Chat no activo: solo contar no leídos para mensajes de otros
            if (!isOwnMsg) {
                unreadCounts[chatKey] = (unreadCounts[chatKey] || 0) + 1;
                playNotifSound();
                mostrarNotificacion(data.from, preview);
            }
        }
        renderUsers(lastKnownUsers);
        renderContactsList();
        _actualizarChatStatusPresencia();
        return;
    }

    if (data.type === 'users') {
        // data.online es array de {username, avatar, phone, isAway}
        window._phoneToUsername = {};
        window._onlinePhones    = new Set();
        window._awayUsers       = window._awayUsers || new Set();
        window._awayUsers.clear();
        const list = data.online.map(u => {
            if (typeof u === 'object') {
                if (u.avatar && u.username) userAvatars[u.username] = u.avatar;
                if (u.phone && u.username) {
                    window._phoneToUsername[u.phone] = u.username;
                    window._onlinePhones.add(u.phone);
                    // Actualizar mapa auxiliar si este usuario es un contacto nuestro
                    if (typeof myContacts !== 'undefined' && myContacts.has(u.phone)) {
                        window._allContactsPhoneToUsername = window._allContactsPhoneToUsername || {};
                        window._allContactsPhoneToUsername[u.phone] = u.username;
                        const _c = myContacts.get(u.phone);
                        if (_c && !_c.username) { _c.username = u.username; myContacts.set(u.phone, _c); }
                    }
                }
                if (u.isAway && u.username) window._awayUsers.add(u.username);
                return u.username || null;
            }
            return u || null;
        // Eliminar entradas nulas, vacías o que no sean strings válidos
        }).filter(u => u && typeof u === 'string' && u.trim() !== '');
        lastKnownUsers = list;
        renderUsers(list);
        renderContactsList(); // actualizar estado online de contactos
        // Actualizar chatStatus si el chat activo es con alguien cuyo estado cambió
        _actualizarChatStatusPresencia();
        return;
    }

    if (data.type === 'typing') {
        if (data.username === username) return;
        if (currentChat !== data.username) return;
        if (data.status === 'stop') {
            typingDiv.classList.remove('visible');
        } else {
            typingText.textContent = `${data.username} está escribiendo`;
            typingDiv.classList.add('visible');
        }
        return;
    }
    if (data.type === 'recording') {
        if (data.username === username) return;
        if (currentChat !== data.username) return;
        if (data.status === 'stop') {
            typingDiv.classList.remove('visible');
        } else {
            typingText.textContent = `${data.username} está grabando audio 🎙️`;
            typingDiv.classList.add('visible');
        }
        return;
    }

    if (data.type === 'delivered') {
        updateEstado(data.id, '✔✔');
        // Actualizar en caché — buscar también en mensajes aún con id local_
        for (const arr of Object.values(conversations)) { if (!Array.isArray(arr)) continue;
            if (!Array.isArray(arr)) continue;
            const m = arr.find(m => m.id === data.id);
            if (m) { m.delivered = true; }
        }
        return;
    }
    if (data.type === 'read') {
        updateEstado(data.id, '✔✔ leído');
        // Actualizar en caché — ya lo hace updateEstado pero dejamos esto para seguridad
        for (const arr of Object.values(conversations)) { if (!Array.isArray(arr)) continue;
            if (!Array.isArray(arr)) continue;
            const m = arr.find(m => m.id === data.id);
            if (m) { m.read = true; m.delivered = true; }
        }
        return;
    }
    if (data.type === 'info') {
        const infoText = data.message || '';
        const esSistema = /se ha unido al chat|sali[oó] del chat/.test(infoText);
        if (!esSistema) addInfo(infoText);
        return;
    }
    if (data.type === 'kvs_pong')  { return; } // respuesta al heartbeat, ignorar

    // ── Acciones sobre mensajes ──────────────────────────────────────────
    if (data.type === 'message_edited') {
        onMensajeEditado(data.id, data.newText, data.editedAt);
        // También actualizar en el panel del hilo si está abierto
        _onThreadMsgEditado(data.id, data.newText);
        return;
    }
    if (data.type === 'message_deleted') {
        onMensajeEliminado(data.id);
        // También actualizar en el panel del hilo si está abierto
        _onThreadMsgEliminado(data.id);
        return;
    }
    // Borrado en batch (deleteMessages optimizado)
    if (data.type === 'messages_deleted') {
        if (Array.isArray(data.ids)) {
            data.ids.forEach(id => {
                onMensajeEliminado(id);
                _onThreadMsgEliminado(id);
            });
        }
        return;
    }
    if (data.type === 'message_reaction') {
        onReaccionActualizada(data.id, data.reactions);
        return;
    }
    if (data.type === 'message_starred') {
        onMensajeDestacado(data.id, data.starred);
        return;
    }
    if (data.type === 'thread_message') {
        onMensajeHilo(data);
        return;
    }
    if (data.type === 'thread_history') {
        onHistorialHilo(data);
        return;
    }

    // ── WebRTC signaling ──
    if (data.type === 'call_offer')    { recibirLlamada(data); return; }
    if (data.type === 'call_answer')   { recibirRespuesta(data); return; }
    if (data.type === 'call_ice')      { recibirICE(data); return; }
    if (data.type === 'call_rejected') { llamadaRechazada(); return; }
    if (data.type === 'call_ended')    { llamadaTerminada(); return; }

    if (data.type === 'contactAdded') {
        onContactAdded(data.contactPhone, data.customName, data.avatar, data.username);
        return;
    }
    if (data.type === 'contactRemoved') {
        onContactRemoved(data.contactPhone);
        return;
    }
    if (data.type === 'contactBlocked') {
        // El bloqueo fue exitoso: marcar el contacto como bloqueado (NO eliminarlo de la lista)
        if (myContacts.has(data.contactPhone)) {
            const c = myContacts.get(data.contactPhone);
            c.blocked = true;
            myContacts.set(data.contactPhone, c);
        }
        renderContactsList();
        mostrarToast('Contacto bloqueado 🚫');
        return;
    }
    if (data.type === 'contactUnblocked') {
        // Desbloqueo exitoso: quitar flag blocked
        if (myContacts.has(data.contactPhone)) {
            const c = myContacts.get(data.contactPhone);
            c.blocked = false;
            myContacts.set(data.contactPhone, c);
        }
        renderContactsList();
        mostrarToast('Contacto desbloqueado ✅');
        return;
    }
    if (data.type === 'youWereUnblocked') {
        // El otro usuario nos desbloqueó: quitar flag blockedUs
        if (myContacts.has(data.byPhone)) {
            const c = myContacts.get(data.byPhone);
            c.blockedUs = false;
            myContacts.set(data.byPhone, c);
        }
        renderContactsList();
        return;
    }
    if (data.type === 'youWereBlocked') {
        // El otro usuario nos ha bloqueado: marcarlo en nuestra lista como que nos bloqueó
        if (myContacts.has(data.byPhone)) {
            const c = myContacts.get(data.byPhone);
            c.blockedUs = true;
            myContacts.set(data.byPhone, c);
        }
        renderContactsList();
        mostrarToast('⚠️ ' + data.byUsername + ' te ha bloqueado', true);
        return;
    }
    if (data.type === 'contactRenamed') {
        onContactRenamed(data.contactPhone, data.newName);
        return;
    }
    if (data.type === 'conversation_cleared') {
        onConversacionBorrada(data.conversationId);
        return;
    }
    if (data.type === 'auto_destruct_set') {
        _onAutoDestructSet(data.conversationId, data.seconds);
        return;
    }
    if (data.type === 'chat_archived') {
        _onChatArchivado(data.conversationId, data.archived);
        return;
    }
    if (data.type === 'group_read') {
        // Alguien leyó un mensaje de grupo — registrar y actualizar tick
        if (data.id && data.by) {
            _registrarGrupoLectura(data.id, data.by);
        }
        return;
    }
    if (data.type === 'audio_read') {
        // Alguien escuchó nuestro audio: mostrar indicador en la burbuja
        const bubble = document.getElementById(data.id);
        if (bubble) {
            const meta = bubble.querySelector('.meta');
            if (meta && !meta.querySelector('.audio-listened')) {
                const span = document.createElement('span');
                span.className = 'audio-listened';
                span.title = 'Escuchado';
                span.textContent = '🎧';
                meta.appendChild(span);
            }
        }
        // Actualizar en conversations[]
        for (const arr of Object.values(conversations)) { if (!Array.isArray(arr)) continue;
            const m = arr.find(m => m.id === data.id);
            if (m) { if (!m.audioReadBy) m.audioReadBy = []; if (!m.audioReadBy.includes(data.by)) m.audioReadBy.push(data.by); break; }
        }
        return;
    }
    if (data.type === 'user_last_seen') {
        // Un contacto se desconectó: guardar su lastSeen y actualizar el header si su chat está abierto
        if (data.username && data.lastSeen) {
            userLastSeen[data.username] = data.lastSeen;
            if (currentChat === data.username || (currentChat && currentChat.startsWith('phone:'))) {
                _actualizarChatStatusPresencia();
            }
        }
        return;
    }
    if (data.type === 'contactError') {
        // Puede ser error de addContact o de renameContact: reactivar ambos botones
        const addErrEl = document.getElementById('addContactError');
        if (addErrEl) addErrEl.textContent = 'Error: ' + data.message;
        const btnGuardar = document.getElementById('btnGuardarContacto');
        if (btnGuardar) btnGuardar.disabled = false;
        const btnRenombre = document.getElementById('btnGuardarRenombre');
        if (btnRenombre) btnRenombre.disabled = false;
        // Revertir contactos optimistas si los hay (para que vuelvan a "Conectados ahora")
        myContacts.forEach((c, phone) => {
            if (c._optimistic) myContacts.delete(phone);
        });
        renderContactsList();
        renderUsers(lastKnownUsers);
        mostrarToast('⚠ ' + (data.message || 'Error al agregar contacto'), true);
        return;
    }

    // ── Solicitudes de contacto ──────────────────────────────────────────
    if (data.type === 'contact_request') {
        mostrarSolicitudContacto(data);
        return;
    }
    if (data.type === 'contactRequestSent') {
        // Confirmación de que la solicitud se envió correctamente
        mostrarToast('Solicitud enviada ✓');
        return;
    }
    if (data.type === 'contactRequestError') {
        mostrarToast('⚠ ' + data.message, true);
        return;
    }
    if (data.type === 'contactRequestAccepted') {
        // La otra persona aceptó nuestra solicitud — ya tenemos el contactAdded pero avisamos
        mostrarToast(data.byUsername + ' aceptó tu solicitud ✓');
        return;
    }
    if (data.type === 'contactRequestRejected') {
        // Rechazo silencioso — solo mostramos un toast discreto
        mostrarToast(data.byUsername + ' no aceptó la solicitud');
        return;
    }

    // ── Sesión expulsada (mismo número en otro dispositivo) ──
    if (data.type === 'session_kicked') {
        if (socket) { socket.onclose = null; socket.close(); socket = null; }
        mostrarToast('⚠️ Autorizaste el acceso desde otro dispositivo. Cerrando sesión…', true);
        setTimeout(() => logout(), 2000);
        return;
    }

    // ── Solicitud de autorización de nueva sesión ──
    if (data.type === 'session_auth_request') {
        mostrarModalAutorizacionSesion(data.reqId, data.username, data.deviceInfo);
        return;
    }

    // ── El nuevo dispositivo está esperando aprobación ──
    if (data.type === 'session_waiting_approval') {
        mostrarPantallaEsperandoAprobacion(data.message);
        return;
    }

    // ── Sesión rechazada por el dispositivo activo ──
    if (data.type === 'session_rejected') {
        ocultarPantallaEsperandoAprobacion();
        mostrarErrorSesionRechazada(data.message);
        return;
    }

    // ── Sesión aprobada: completar el login ──
    if (data.type === 'session_approved') {
        ocultarPantallaEsperandoAprobacion();
        completarLoginTrasSesionAprobada();
        return;
    }

    // ── Grupos ──
    if (data.type === 'groupCreated') {
        onGroupCreated(data);
        return;
    }
    if (data.type === 'groupDeleted') {
        onGroupDeleted(data.groupId);
        return;
    }
    if (data.type === 'groupLeft') {
        onGroupDeleted(data.groupId);
        return;
    }
    if (data.type === 'groupMemberLeft') {
        const g = myGroups.get(data.groupId);
        if (g) {
            g.members = g.members.filter(m => m !== data.phone);
            if (data.newOwner) g.ownerPhone = data.newOwner;
            myGroups.set(data.groupId, g);
            // Añadir mensaje de info en el chat si estamos en ese grupo
            if (currentChat === 'group_' + data.groupId) {
                addInfo(`${data.username} abandonó el grupo.`);
            }
        }
        return;
    }
    if (data.type === 'groupMessage') {
        onGroupMessage(data);
        return;
    }
    if (data.type === 'groupHistory') {
        onGroupHistory(data);
        return;
    }
    if (data.type === 'groupError') {
        const errEl = document.getElementById('createGroupError');
        if (errEl) errEl.textContent = 'Error: ' + data.message;
        const editErrEl = document.getElementById('editGroupError');
        if (editErrEl) editErrEl.textContent = 'Error: ' + data.message;
        const editBtn = document.getElementById('btnGuardarEditarGrupo');
        if (editBtn) editBtn.disabled = false;
        return;
    }
    if (data.type === 'groupUpdated') {
        onGroupUpdated(data);
        return;
    }
    if (data.type === 'groupAvatarUpdated') {
        const grp = myGroups.get(data.groupId);
        if (grp) { grp.avatar = data.avatar; myGroups.set(data.groupId, grp); }
        // Actualizar header si es el grupo activo
        if (currentChat === 'group_' + data.groupId) actualizarHeaderGrupo(grp || { groupId: data.groupId, avatar: data.avatar, name: '' });
        renderGroupsList();
        return;
    }
    if (data.type === 'group_call_offer')    { recibirLlamadaGrupal(data); return; }
    if (data.type === 'group_call_answer')   { onGroupCallAnswer(data); return; }
    if (data.type === 'group_call_ice')      { onGroupCallIce(data); return; }
    if (data.type === 'group_call_rejected') { onGroupCallRejected(data); return; }
    if (data.type === 'group_call_ended')    { onGroupCallEnded(data); return; }
}

let lastKnownUsers = [];