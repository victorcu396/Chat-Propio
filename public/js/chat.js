// SELECCIONAR USUARIO
// ============================================================
// Limpia todos los estados transitorios al cambiar de chat
function _mostrarWelcomePanel(visible) {
    const wp = document.getElementById('welcomePanel');
    if (!wp) return;
    if (visible) {
        wp.classList.remove('hidden');
    } else {
        wp.classList.add('hidden');
    }
}

function _limpiarEstadoChat() {
    // Cerrar menú contextual abierto
    cerrarMenuMensaje();
    // Salir del modo selección si estaba activo
    salirModoSeleccion();
    // Resetear paginación
    _historyHasMore  = false;
    _historyLoading  = false;
    _historyOldestId = null;
    // Cancelar edición o respuesta activa sin pedir confirmación
    if (_editState || _replyState) {
        _editState  = null;
        _replyState = null;
        input.value = '';
        input.style.height = 'auto';
        btnEnviar.onclick = enviar;
        btnEnviar.disabled = true;
        document.getElementById('replyBar').classList.remove('visible');
        document.getElementById('replyBarName').textContent = '';
        document.getElementById('replyBarText').textContent = '';
    }
    // Cerrar panel de emojis/favoritos
    cerrarSGPanel();
    // Cerrar panel de hilo si está abierto
    if (_threadId) cerrarHilo();
}

function seleccionarUsuario(user) {
    if (!user) return;

    // ── Bloquear chat con desconocidos (el admin puede chatear con todos) ──
    // Resolver el phone del usuario por todas las fuentes disponibles:
    // _phoneToUsername (solo online), _allContactsPhoneToUsername (todos los registrados)
    let phoneOfUser = window._phoneToUsername
        ? Object.entries(window._phoneToUsername).find(([ph, un]) => un === user)?.[0]
        : null;
    if (!phoneOfUser && window._allContactsPhoneToUsername) {
        phoneOfUser = Object.entries(window._allContactsPhoneToUsername).find(([ph, un]) => un === user)?.[0] || null;
    }
    const _isAdminUser = loginPhone && (loginPhone === '+34693001834' || loginPhone.endsWith('693001834'));
    // Solo bloquear si conocemos el phone Y no está en myContacts.
    // Si no conocemos el phone (phoneOfUser===null), permitir — puede ser un contacto recién
    // agregado cuyo phone aún no está en ningún mapa; el servidor gestionará los permisos.
    if (phoneOfUser && !myContacts.has(phoneOfUser) && !_isAdminUser) return;

    if (currentChat === user) return;
    _limpiarEstadoChat();
    _mostrarWelcomePanel(false);
    currentChat = user;
    unreadCounts[user] = 0;
    // Limpiar también la clave phone: si existía
    if (window._phoneToUsername) {
        const phoneKey = Object.entries(window._phoneToUsername).find(([,un]) => un === user)?.[0];
        if (phoneKey) {
            unreadCounts['phone:' + phoneKey] = 0;
            unreadCounts[phoneKey] = 0;
        }
    }
    _actualizarBadgeGlobal();
    // Cerrar notificaciones de la bandeja del sistema para este chat
    _cerrarNotificacionesDeChat(user);
    // Actualizar botones de cabecera
    document.getElementById('btnArchiveChat').classList.toggle('active', _archivedChats.has(user));
    _actualizarBtnAutoDestruct();
    // Cerrar barra de búsqueda si estaba abierta
    if (_searchActive) toggleSearchBar();
    // Cerrar lista de menciones
    _cerrarMentionList();
    chat.innerHTML = '';

    // Check if this user is a contact and get custom name.
    // Buscar phone en _phoneToUsername (online) y en _allContactsPhoneToUsername (todos).
    let phone = window._phoneToUsername
        ? Object.entries(window._phoneToUsername).find(([ph, un]) => un === user)?.[0]
        : null;
    if (!phone && window._allContactsPhoneToUsername) {
        phone = Object.entries(window._allContactsPhoneToUsername).find(([ph, un]) => un === user)?.[0] || null;
    }
    const contact = phone ? myContacts.get(phone) : null;
    const displayName = contact ? contact.customName : user;

    document.getElementById('chatName').textContent = displayName;
    document.getElementById('chatName').style.color = '';
    document.getElementById('chatName').style.fontWeight = '';
    document.getElementById('chatName').style.fontSize = '';
    const av = document.getElementById('chatAvatar');
    av.src = userAvatars[user] || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(user)}`;
    av.style.display = 'block';

    // Mostrar teléfono del contacto si lo tenemos
    const chatPhoneEl = document.getElementById('chatPhone');
    if (phone) {
        chatPhoneEl.textContent = formatearTelefono(phone);
        chatPhoneEl.style.display = 'block';
    } else {
        chatPhoneEl.style.display = 'none';
    }

    // Ocultar avatar de grupo; configurar botón unificado para llamada 1:1
    document.getElementById('chatGroupAvatar').classList.remove('visible');

    // Restaurar placeholder normal
    input.placeholder = 'Escribe un mensaje...';
    input.disabled = false;
    document.getElementById('btnMic').style.display = 'flex';

    const isOnline = lastKnownUsers.includes(user);
    const isAway   = isOnline && window._awayUsers && window._awayUsers.has(user);
    let statusText, statusColor;
    if (isOnline && !isAway)  { statusText = '● En línea'; statusColor = 'var(--online)'; }
    else if (isAway)          { statusText = '🌙 Ausente'; statusColor = '#f59e0b'; }
    else {
        const ls = userLastSeen[user];
        statusText = ls ? _formatLastSeen(ls) : '○ Desconectado';
        statusColor = 'var(--text-muted)';
        // Fetch lastSeen from server if not cached
        if (!ls && phone) {
            fetch(`/api/user?phone=${encodeURIComponent(phone)}`)
                .then(r => r.ok ? r.json() : null)
                .then(u => {
                    if (u && u.lastSeen) {
                        userLastSeen[user] = u.lastSeen;
                        if (currentChat === user) _actualizarChatStatusPresencia();
                    }
                }).catch(() => {});
        }
    }
    document.getElementById('chatStatus').textContent = statusText;
    document.getElementById('chatStatus').style.color = statusColor;
    const btnU = document.getElementById('btnCallUnified');
    // El botón de llamada siempre está disponible en chats 1:1.
    // Si el contacto está offline, iniciarLlamada() deja una llamada perdida.
    btnU.disabled = false;
    btnU.dataset.mode = '1to1';
    btnU.title = isOnline ? 'Llamada de voz' : 'Llamar (dejará notificación de llamada perdida)';

    // Siempre pedir historial fresco al abrir un chat 1:1 para tener
    // los estados read/delivered actualizados desde la BD.
    delete conversations[user];
    socket.send(JSON.stringify({ type: 'loadConversation', with: user }));

    renderUsers(lastKnownUsers);
    renderContactsList();
    // Cerrar sidebar en móvil y tablet al seleccionar usuario
    if (window.innerWidth <= 900 || document.documentElement.classList.contains('is-mobile')) {
        const sidebar = document.getElementById('sidebar');
        if (sidebar.classList.contains('visible')) toggleSidebar();
        _pushChatState();
    }
}

// ============================================================
// SELECCIONAR CONTACTO OFFLINE (chatKey = 'phone:XXXXX')
// ============================================================
function seleccionarContactoOffline(phone) {
    const chatKey = 'phone:' + phone;
    if (currentChat === chatKey) return;
    _limpiarEstadoChat();
    _mostrarWelcomePanel(false);
    currentChat = chatKey;
    unreadCounts[chatKey] = 0;
    unreadCounts[phone] = 0;
    // Limpiar también por username si lo conocemos
    if (window._phoneToUsername && window._phoneToUsername[phone]) {
        unreadCounts[window._phoneToUsername[phone]] = 0;
    }
    _actualizarBadgeGlobal();
    // Cerrar notificaciones de la bandeja del sistema para este chat
    _cerrarNotificacionesDeChat(chatKey);
    chat.innerHTML = '';

    const contact = myContacts.get(phone);
    const displayName = contact ? contact.customName : phone;
    const seedName = contact ? (contact.username || contact.customName) : phone;
    const avatarUrl = contact
        ? (contact.avatar || userAvatars['__phone__' + phone] || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(seedName)}`)
        : `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(seedName)}`;

    document.getElementById('chatName').textContent = displayName;
    document.getElementById('chatName').style.color = '';
    document.getElementById('chatName').style.fontWeight = '';
    document.getElementById('chatName').style.fontSize = '';

    const av = document.getElementById('chatAvatar');
    av.src = avatarUrl;
    av.style.display = 'block';
    document.getElementById('chatGroupAvatar').classList.remove('visible');

    // Mostrar teléfono siempre en chats offline (tenemos el phone directamente)
    const chatPhoneEl = document.getElementById('chatPhone');
    chatPhoneEl.textContent = formatearTelefono(phone);
    chatPhoneEl.style.display = 'block';

    document.getElementById('chatStatus').textContent = '○ Desconectado';
    document.getElementById('chatStatus').style.color = 'var(--text-muted)';

    // Botón de llamada habilitado — al llamar a offline se guarda missed call
    const btnU = document.getElementById('btnCallUnified');
    btnU.disabled = false;
    btnU.dataset.mode = '1to1';
    btnU.dataset.phone = phone;  // guardar phone para la llamada a offline
    btnU.title = 'Llamar (dejará notificación de llamada perdida)';

    // Habilitar escritura
    input.disabled = false;
    input.placeholder = 'Escribe un mensaje… (se entregará al conectarse)';
    document.getElementById('btnMic').style.display = 'flex';

    renderContactsList();
    renderGroupsList();

    // Siempre pedir historial fresco al abrir un chat por phone para tener
    // los estados read/delivered actualizados desde la BD.
    delete conversations[chatKey];
    socket.send(JSON.stringify({ type: 'loadConversation', withPhone: phone }));

    if (window.innerWidth <= 900 || document.documentElement.classList.contains('is-mobile')) {
        const sidebar = document.getElementById('sidebar');
        if (sidebar.classList.contains('visible')) toggleSidebar();
        _pushChatState();
    }
}

// ============================================================
// ENVIAR MENSAJE
// ============================================================
function enviar() {
    // Si estamos en modo edición, delegar a guardarEdicion
    if (_editState) { guardarEdicion(); return; }

    const text = input.value.trim();
    if (!text && !pendingImage) return;
    if (!currentChat) return;

    // ── Bloquear envío a desconocidos en chat 1:1 (el admin puede enviar a todos) ──
    if (!currentChat.startsWith('group_') && !currentChat.startsWith('phone:')) {
        // Resolver phone por todas las fuentes disponibles
        let chatPhone = window._phoneToUsername
            ? Object.entries(window._phoneToUsername).find(([ph, un]) => un === currentChat)?.[0]
            : null;
        if (!chatPhone && window._allContactsPhoneToUsername) {
            chatPhone = Object.entries(window._allContactsPhoneToUsername).find(([ph, un]) => un === currentChat)?.[0] || null;
        }
        const _isAdminSend = loginPhone && (loginPhone === '+34693001834' || loginPhone.endsWith('693001834'));
        // Solo bloquear si conocemos el phone Y no está en myContacts.
        if (chatPhone && !myContacts.has(chatPhone) && !_isAdminSend) return;
    }

    // ── Mensaje de grupo ──────────────────────────────
    if (currentChat.startsWith('group_')) {
        const groupId = currentChat.replace('group_', '');
        const grpChatKey = 'group_' + groupId;

        // Helper: añade mensaje local al conversations[] del grupo
        const _addLocalToGrpConversations = (localMsg) => {
            if (!conversations[grpChatKey]) conversations[grpChatKey] = [];
            conversations[grpChatKey].push(localMsg);
        };

        if (_replyState && _replyState.id) {
            const replySnap = { ..._replyState };
            socket.send(JSON.stringify({
                type: 'replyMessage',
                groupId,
                message: text || '',
                imageData: pendingImage ? pendingImage.dataUrl : undefined,
                replyToId: replySnap.id
            }));
            const localGrpReply = {
                id: 'local_' + Date.now(),
                from: username,
                to: groupId,
                groupId,
                message: text || '',
                imageData: pendingImage ? pendingImage.dataUrl : null,
                time: new Date(),
                avatar: myAvatarDataUrl,
                replyToId:   replySnap.id,
                replyToFrom: replySnap.from === 'Tú' ? username : replySnap.from,
                replyToText: replySnap.text
            };
            _addLocalToGrpConversations(localGrpReply);
            addGroupMessage(localGrpReply);
            if (pendingImage) cancelarImagen();
            cancelarRespuesta();
        } else if (pendingImage) {
            socket.send(JSON.stringify({ type: 'groupMessage', groupId, message: text || '', imageData: pendingImage.dataUrl }));
            const localGrpImg = { id: 'local_' + Date.now(), from: username, to: groupId, groupId, message: text || '', imageData: pendingImage.dataUrl, time: new Date(), avatar: myAvatarDataUrl };
            _addLocalToGrpConversations(localGrpImg);
            addGroupMessage(localGrpImg);
            cancelarImagen();
        } else {
            socket.send(JSON.stringify({ type: 'groupMessage', groupId, message: text }));
            const localGrpMsg = { id: 'local_' + Date.now(), from: username, to: groupId, groupId, message: text, time: new Date(), avatar: myAvatarDataUrl };
            _addLocalToGrpConversations(localGrpMsg);
            addGroupMessage(localGrpMsg);
        }
        input.value = '';
        input.style.height = 'auto';
        btnEnviar.disabled = true;
        cerrarSGPanel();
        return;
    }

    // ── Mensaje 1:1 (online o offline) ───────────────────────
    const isOfflineChat = currentChat.startsWith('phone:');
    const toPhone    = isOfflineChat ? currentChat.replace('phone:', '') : null;
    const toUsername = isOfflineChat ? null : currentChat;

    // Helper: añade un mensaje local al array conversations[] para que
    // iniciarEdicion() pueda encontrarlo antes de que llegue el eco del servidor.
    const _addLocalToConversations = (localMsg) => {
        const ck = toUsername || ('phone:' + toPhone);
        if (!conversations[ck]) conversations[ck] = [];
        conversations[ck].push(localMsg);
        if (toUsername && ck !== toUsername) {
            if (!conversations[toUsername]) conversations[toUsername] = conversations[ck];
        }
    };

    if (_replyState && _replyState.id) {
        const replySnap = { ..._replyState };
        socket.send(JSON.stringify({
            type: 'replyMessage',
            ...(toUsername ? { to: toUsername } : { toPhone }),
            message: text || '',
            imageData: pendingImage ? pendingImage.dataUrl : undefined,
            replyToId: replySnap.id
        }));
        const localReply = {
            id: 'local_' + Date.now(),
            from: username,
            to: toUsername || null,
            message: text || '',
            imageData: pendingImage ? pendingImage.dataUrl : null,
            time: new Date(),
            self: true,
            avatar: myAvatarDataUrl,
            replyToId:   replySnap.id,
            replyToFrom: replySnap.from === 'Tú' ? username : replySnap.from,
            replyToText: replySnap.text
        };
        _addLocalToConversations(localReply);
        addMessage(localReply);
        if (pendingImage) cancelarImagen();
        cancelarRespuesta();
    } else if (pendingImage) {
        socket.send(JSON.stringify({
            type: 'message',
            ...(toUsername ? { to: toUsername } : { toPhone }),
            message: text || '',
            imageData: pendingImage.dataUrl
        }));
        const localImg = { id: 'local_' + Date.now(), from: username, to: toUsername, toPhone, message: text || '', imageData: pendingImage.dataUrl, time: new Date(), self: true, avatar: myAvatarDataUrl };
        _addLocalToConversations(localImg);
        addMessage(localImg);
        cancelarImagen();
    } else {
        socket.send(JSON.stringify({
            type: 'message',
            ...(toUsername ? { to: toUsername } : { toPhone }),
            message: text
        }));
        const localMsg = { id: 'local_' + Date.now(), from: username, to: toUsername, toPhone, message: text, time: new Date(), self: true, avatar: myAvatarDataUrl };
        _addLocalToConversations(localMsg);
        addMessage(localMsg);
    }

    input.value = '';
    input.style.height = 'auto';
    btnEnviar.disabled = true;
    cerrarSGPanel();
    // Animación visual del botón enviar
    btnEnviar.style.transform = 'scale(0.85)';
    setTimeout(() => { btnEnviar.style.transform = ''; }, 150);
    // Feedback háptico en móvil
    _vibrarEnvio();
}

// ============================================================
// INPUT HANDLERS
// ============================================================
input.addEventListener('input', () => {
    actualizarBtnEnviar();
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    // Solo activar menciones en grupos
    if (currentChat && currentChat.startsWith('group_')) {
        _onInputMention();
    } else {
        _cerrarMentionList();
    }

    if (!socket || !currentChat) return;
    if (currentChat.startsWith('group_')) return; // no typing en grupos
    if (currentChat.startsWith('phone:')) return;  // no typing para contactos offline
    socket.send(JSON.stringify({ type: 'typing', to: currentChat, status: 'start' }));
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
        if (socket && socket.readyState === WebSocket.OPEN)
            socket.send(JSON.stringify({ type: 'typing', to: currentChat, status: 'stop' }));
    }, 1500);
});

input.addEventListener('keydown', (e) => {
    // Mention list intercepts arrow keys, Enter, Tab, Escape
    _onKeydownMention(e);
    if (e.defaultPrevented) return;
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        // enviar() ya detecta internamente si hay _editState activo
        enviar();
    }
});

// Cerrar mention list al hacer click fuera del input o del panel de menciones
document.addEventListener('click', (e) => {
    const list = document.getElementById('mentionList');
    if (!list || !list.classList.contains('visible')) return;
    if (!list.contains(e.target) && e.target !== input) {
        _cerrarMentionList();
    }
}, true);

// ============================================================
// ADD MESSAGE AL DOM
// ============================================================

// Adjunta el listener de click para el menú contextual a la burbuja de un mensaje.
// Click en la burbuja → abre/cierra el menú. Click en imagen → lightbox (no menú).
function _attachBubbleClickMenu(row, msgId, isMe, isDeleted, isGroup) {
    const bubble = row.querySelector('.bubble');
    if (!bubble) return;

    // Usar una propiedad en el elemento para guardar el handler y poder reemplazarlo.
    // Así si se llama de nuevo (al reemplazar local_ por id real) no acumulamos listeners.
    if (bubble._kvsMenuHandler) {
        bubble.removeEventListener('click', bubble._kvsMenuHandler);
    }

    // Si el mensaje está eliminado solo adjuntamos el handler si es propio
    // (para poder hacer "ocultar para mí")
    if (isDeleted && !isMe) {
        bubble._kvsMenuHandler = null;
        return;
    }

    const handler = (e) => {
        // En modo selección: seleccionar en lugar de abrir menú
        if (chat.classList.contains('chat-in-select-mode')) {
            if (bubble.classList.contains('deleted')) return;
            e.stopPropagation();
            _toggleSeleccion(msgId, row);
            return;
        }
        if (e.target.tagName === 'IMG' && e.target.classList.contains('img-msg')) return;
        if (e.target.closest('.msg-ctx-menu')) return;
        if (e.target.closest('.reply-preview')) return;
        e.stopPropagation();
        // Pasar isMe e isDeleted como señales — abrirMenuMensaje los recalcula del DOM internamente
        abrirMenuMensaje(e, msgId, isMe, isDeleted, isGroup);
    };

    bubble._kvsMenuHandler = handler;
    bubble.addEventListener('click', handler);

    // Checkbox de selección
    const check = row.querySelector('.msg-select-check');
    if (check && !check._kvsCheckHandler) {
        const checkHandler = (e) => {
            e.stopPropagation();
            if (bubble.classList.contains('deleted')) return;
            if (!chat.classList.contains('chat-in-select-mode')) {
                entrarModoSeleccion(msgId);
            } else {
                _toggleSeleccion(msgId, row);
            }
        };
        check._kvsCheckHandler = checkHandler;
        check.addEventListener('click', checkHandler);
    }
}

function _buildReactionsHtml(reactions, msgId) {
    if (!reactions || typeof reactions !== 'object') return '';
    const entries = reactions instanceof Map ? [...reactions.entries()] : Object.entries(reactions);
    if (!entries.length) return '';
    const chips = entries.map(([emoji, users]) => {
        if (!users || !users.length) return '';
        const mine = users.includes(username);
        return `<span class="reaction-chip${mine ? ' mine' : ''}" onclick="toggleReaccion('${msgId}','${emoji}')" title="${users.join(', ')}">
            ${emoji}<span class="rc-count">${users.length}</span>
        </span>`;
    }).join('');
    return chips ? `<div class="reactions-row">${chips}</div>` : '';
}

function _buildMsgActionsBtn(msgId, isMe, isDeleted, isGroup) {
    // Ya no usamos un botón flotante invisible.
    // El menú se abre haciendo click directamente en la burbuja (ver addMessage).
    return '';
}

function addMessage(msg) {
    const isMe = msg.self || msg.from === username;

    // Mensajes de hilo: pertenecen al panel de hilo, nunca al chat principal
    if (msg.threadId) return;

    // Saltar mensajes que el usuario ha ocultado localmente
    if (msg.id && !msg.id.startsWith('local_')) {
        try {
            const hidden = JSON.parse(localStorage.getItem('kvs_hidden_msgs') || '[]');
            if (hidden.includes(msg.id)) return;
        } catch(_) {}
    }

    // ── Llamada perdida ──
    if (msg.message === '__missed_call__') {
        const li = document.createElement('li');
        li.className = 'info-msg';
        li.innerHTML = isMe
            ? `📵 Llamada perdida enviada a <b>${escapeHTML(msg.to)}</b> · ${horaActual(msg.time)}`
            : `📵 Llamada perdida de <b>${escapeHTML(msg.from)}</b> · ${horaActual(msg.time)}`;
        li.style.cssText = 'color:#ef4444;background:rgba(239,68,68,0.08);border-radius:8px;padding:6px 12px;';
        chat.appendChild(li);
        if (autoScroll) { scrollChat(); } else if (window._scrollBtnNewMsg && !window._kvsLoadingHistory) { window._scrollBtnNewMsg(); }
        return;
    }

    const isDeleted  = !!msg.deletedAt;
    const isEdited   = !!msg.editedAt && !isDeleted;
    const isForward  = !!msg.forwardedFrom;
    const isGroup    = !!(msg.groupId || (currentChat && currentChat.startsWith('group_')));
    const isStarred  = msg.starredBy && msg.starredBy.includes(username);
    const row = document.createElement('li');
    row.className = `msg-row ${isMe ? 'me' : ''}`;
    row.dataset.msgid = msg.id;

    const avatarSrc  = msg.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${msg.from}`;
    const estadoHtml = isMe
        ? `<span class="estado" id="estado_${msg.id}">${msg.read ? '✔✔ leído' : msg.delivered ? '✔✔' : '✔'}</span>`
        : '';
    const onlyImage  = msg.imageData && !msg.message && !msg.audioData && !isDeleted;
    const bubbleClass = `bubble ${isMe ? 'me' : 'other'}${onlyImage ? ' img-only' : ''}${isDeleted ? ' deleted' : ''}`;

    // Reply preview
    let replyHtml = '';
    if (msg.replyToId && !isDeleted) {
        const rpName = msg.replyToFrom || '';
        const rpText = escapeHTML(msg.replyToText || '');
        replyHtml = `<div class="reply-preview" onclick="scrollToMsg('${msg.replyToId}')">
            <div class="rp-name">${escapeHTML(rpName)}</div>
            <div class="rp-text">${rpText}</div>
        </div>`;
    }

    // Forward label
    const forwardHtml = isForward && !isDeleted
        ? `<div class="forward-label">↗ Reenviado de <b>${escapeHTML(msg.forwardedFrom)}</b></div>` : '';

    // Edited label
    const editedHtml  = isEdited ? `<span class="edited-label">(editado)</span>` : '';

    // Star badge
    const starHtml    = isStarred ? `<span class="star-badge">⭐</span>` : '';

    // Thread button
    const threadHtml  = (!isDeleted && !isGroup && msg.threadCount)
        ? `<button class="thread-btn" onclick="abrirHilo('${msg.id}')">🧵 ${msg.threadCount} respuesta${msg.threadCount > 1 ? 's' : ''}</button>`
        : '';

    // Reactions
    const reactHtml = _buildReactionsHtml(msg.reactions, msg.id);

    // ── Audio ──
    if (msg.audioData && !isDeleted) {
        const audioId = 'aud_' + (msg.id || ('r' + Math.random().toString(36).slice(2)));
        const waveHeights = [10,16,8,20,14,18,10,22,12,16];
        const bars = waveHeights.map(h => `<span style="height:${h}px"></span>`).join('');

        row.innerHTML = `
            <div class="msg-select-check" title="Seleccionar">✓</div>
            ${_buildMsgActionsBtn(msg.id, isMe, false, isGroup)}
            <img class="msg-avatar" src="${avatarSrc}" alt="${msg.from}">
            <div class="bubble-wrap">
                ${forwardHtml}
                <div class="${bubbleClass}" id="${msg.id || audioId}">
                    ${replyHtml}
                    <span class="msg-text">
                        <div class="audio-msg-wrap">
                            <button class="btn-play-audio" id="playbtn_${audioId}">▶</button>
                            <div class="audio-progress-wrap">
                                <div class="audio-waveform" id="wave_${audioId}">${bars}</div>
                                <input class="audio-progress" type="range" min="0" max="100" value="0" id="prog_${audioId}">
                                <span class="audio-duration" id="dur_${audioId}">0:00</span>
                            </div>
                        </div>
                        ${msg.message ? `<div style="margin-top:6px">${escapeHTML(msg.message)}</div>` : ''}
                    </span>
                    <span class="meta">
                        ${starHtml}<span class="hora">${horaActual(msg.time)}</span>${editedHtml}${estadoHtml}
                    </span>
                </div>
                ${reactHtml ? `<div class="reactions-outer" id="react_${msg.id}">${reactHtml}</div>` : `<div class="reactions-outer" id="react_${msg.id}"></div>`}
                ${threadHtml ? `<div id="thread_${msg.id}">${threadHtml}</div>` : `<div id="thread_${msg.id}"></div>`}
            </div>`;

        const audioEl = document.createElement('audio');
        audioEl.id = audioId; audioEl.src = msg.audioData; audioEl.preload = 'metadata'; audioEl.style.display = 'none';
        row.appendChild(audioEl);

        const playBtn = row.querySelector('#playbtn_' + audioId);
        const progEl  = row.querySelector('#prog_'    + audioId);
        const waveEl  = row.querySelector('#wave_'    + audioId);
        const durEl   = row.querySelector('#dur_'     + audioId);
        playBtn.addEventListener('click', () => toggleAudioPlay(audioId));
        progEl.addEventListener('input',  () => seekAudio(audioId, progEl.value));
        audioEl.addEventListener('loadedmetadata', () => { if (durEl) durEl.textContent = formatAudioTime(audioEl.duration); });
        audioEl.addEventListener('timeupdate', () => {
            if (audioEl.duration) {
                if (progEl) progEl.value = (audioEl.currentTime / audioEl.duration) * 100;
                if (durEl)  durEl.textContent = formatAudioTime(audioEl.currentTime) + ' / ' + formatAudioTime(audioEl.duration);
            }
        });
        audioEl.addEventListener('ended', () => {
            if (playBtn) playBtn.textContent = '▶';
            if (waveEl)  waveEl.classList.remove('playing');
            if (progEl)  progEl.value = 0;
            if (durEl && audioEl.duration) durEl.textContent = formatAudioTime(audioEl.duration);
        });
        chat.appendChild(row);
        _attachBubbleClickMenu(row, msg.id, isMe, false, isGroup);
        if (autoScroll) { scrollChat(); } else if (window._scrollBtnNewMsg && !window._kvsLoadingHistory) { window._scrollBtnNewMsg(); }
        // Solo enviar read si: mensaje nuevo en tiempo real + chat visible + documento en primer plano
        if (!isMe && socket && !window._kvsLoadingHistory && !document.hidden && !window._appIsAway) {
            socket.send(JSON.stringify({ type: 'read', id: msg.id }));
        }
        return;
    }

    // ── Imagen / Texto / Sticker / Gift / Eliminado ──
    let content = '';
    if (isDeleted) {
        content = '🗑 Mensaje eliminado';
    } else if (msg.imageData) {
        content = `<img class="img-msg" src="${msg.imageData}" alt="imagen">`;
        if (msg.message) content += `<div style="margin-top:6px">${escapeHTML(msg.message)}</div>`;
    } else {
        content = renderMentions(escapeHTML(msg.message));
    }

    row.innerHTML = `
        <div class="msg-select-check" title="Seleccionar">✓</div>
        ${_buildMsgActionsBtn(msg.id, isMe, isDeleted, isGroup)}
        <img class="msg-avatar" src="${avatarSrc}" alt="${msg.from}">
        <div class="bubble-wrap">
            ${forwardHtml}
            <div class="${bubbleClass}" id="${msg.id}">
                ${replyHtml}
                <span class="msg-text">${content}</span>
                <span class="meta">
                    ${starHtml}<span class="hora">${horaActual(msg.time)}</span>${editedHtml}${estadoHtml}
                </span>
            </div>
            <div class="reactions-outer" id="react_${msg.id}">${reactHtml}</div>
            <div id="thread_${msg.id}">${threadHtml}</div>
        </div>
    `;

    if (!isDeleted && msg.imageData) {
        const imgEl = row.querySelector('.img-msg');
        if (imgEl) imgEl.addEventListener('click', () => openLightbox(msg.imageData));
    }

    chat.appendChild(row);
    _attachBubbleClickMenu(row, msg.id, isMe, isDeleted, isGroup);
    // Previsualización de enlace en mensajes de texto
    if (!isDeleted && !msg.imageData && !msg.audioData && msg.message) {
        const bubble = row.querySelector('.bubble');
        if (bubble) _adjuntarLinkPreview(bubble, msg.message);
    }
    if (autoScroll) { scrollChat(); } else if (window._scrollBtnNewMsg && !window._kvsLoadingHistory) { window._scrollBtnNewMsg(); }
    // Solo enviar read si: mensaje nuevo en tiempo real + chat visible + documento en primer plano
    if (!isMe && socket && !isDeleted && !window._kvsLoadingHistory && !document.hidden && !window._appIsAway) {
        socket.send(JSON.stringify({ type: 'read', id: msg.id }));
    }
}

function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
}

function renderMentions(html) {
    if (!html) return html || '';
    // Match @username — letras, números, guión bajo, caracteres acentuados
    return html.replace(/@([^\s<>&"']+)/g, (match, uname) => {
        let cls = 'mention-chip';
        if (uname === 'todos' || uname === 'all') {
            cls += ' all';
        } else if (uname === username) {
            cls += ' self';
        }
        return `<span class="${cls}">@${escapeHTML(uname)}</span>`;
    });
}

function addDaySeparator(day) {
    const li = document.createElement('li');
    li.className = 'info-msg';
    li.textContent = `— ${day} —`;
    chat.appendChild(li);
}

function addInfo(text) {
    const li = document.createElement('li');
    li.className = 'info-msg';
    li.textContent = text;
    chat.appendChild(li);
}

// Mostrar notificación de llamada perdida (recibida al reconectar)
function mostrarLlamadaPerdida(data) {
    // Añadir al historial de conversación
    const chatKey = currentChat && (currentChat === data.from || currentChat === 'phone:' + (window._phoneToUsername ? Object.entries(window._phoneToUsername).find(([,un]) => un === data.from)?.[0] : null))
        ? currentChat : data.from;

    if (!conversations[chatKey]) conversations[chatKey] = [];
    if (!conversations[chatKey].some(m => m.id === data.id)) conversations[chatKey].push(data);

    // Si el chat con ese usuario está abierto, renderizar inline
    if (currentChat === data.from || currentChat === chatKey) {
        addMessage(data);
    } else {
        // Notificación flotante
        unreadCounts[data.from] = (unreadCounts[data.from] || 0) + 1;
        playNotifSound();
        mostrarNotificacion('📵 Llamada perdida', data.from);
    }
    renderContactsList();
    renderUsers(lastKnownUsers);
}

function updateEstado(id, estado) {
    const el = document.getElementById(`estado_${id}`);
    if (el) el.textContent = estado;
    // Aunque el elemento no esté en el DOM (p.ej. aún es local_ o el chat no está visible),
    // actualizar la caché para que la próxima vez que se renderice muestre el estado correcto.
    if (estado === '✔✔ leído') {
        for (const arr of Object.values(conversations)) { if (!Array.isArray(arr)) continue;
            if (!Array.isArray(arr)) continue;
            const m = arr.find(m => m.id === id);
            if (m) { m.read = true; m.delivered = true; }
        }
    } else if (estado === '✔✔') {
        for (const arr of Object.values(conversations)) { if (!Array.isArray(arr)) continue;
            if (!Array.isArray(arr)) continue;
            const m = arr.find(m => m.id === id);
            if (m) { m.delivered = true; }
        }
    }
}


// ============================================================