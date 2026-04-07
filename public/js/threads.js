let _threadId   = null;
let _threadInputListenerAttached = false;

function _attachThreadInputListener() {
    const threadInputEl = document.getElementById('threadInput');
    if (!threadInputEl || _threadInputListenerAttached) return;
    _threadInputListenerAttached = true;

    threadInputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            enviarEnHilo();
        } else if (e.key === 'Escape') {
            if (_threadEditState) {
                e.preventDefault();
                _cancelarEdicionHilo();
            }
        }
    });

    threadInputEl.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 90) + 'px';
    });

    threadInputEl.addEventListener('touchstart', (e) => {
        e.stopPropagation();
        threadInputEl.focus();
    }, { passive: true });

    threadInputEl.addEventListener('click', (e) => {
        e.stopPropagation();
    });
}

function abrirHilo(msgId) {
    _threadId = msgId;

    // Intentar obtener el mensaje raíz del DOM (puede no estar si no está en pantalla)
    const bubble = document.getElementById(msgId);
    const row    = bubble ? bubble.closest('.msg-row') : null;
    const from   = row ? (row.querySelector('.msg-avatar')?.alt || '') : '';
    const textEl = bubble ? bubble.querySelector('.msg-text') : null;
    const text   = textEl ? (textEl.textContent || textEl.innerText || '').trim() : '';

    // Mostrar lo que tenemos (puede actualizarse cuando llegue thread_history)
    document.getElementById('threadRootFrom').textContent = from || '…';
    document.getElementById('threadRootText').textContent = text ? text.slice(0, 200) : '…';

    // Limpiar mensajes anteriores del hilo
    document.getElementById('threadMessages').innerHTML = '';

    // Abrir el panel
    const panel = document.getElementById('threadPanel');
    panel.classList.add('open');

    // En móvil: empujar estado al historial para que el botón atrás cierre el hilo
    if (_esMobile()) {
        history.pushState({ kvs: 'thread' }, '');
    }

    // Adjuntar listener (solo una vez)
    _attachThreadInputListener();

    // Dar foco al input con pequeño delay para que la transición CSS termine
    setTimeout(() => {
        const threadInputEl = document.getElementById('threadInput');
        if (threadInputEl) {
            threadInputEl.removeAttribute('disabled');
            threadInputEl.focus();
        }
    }, 320);

    // Pedir historial del hilo al servidor (siempre, para ambos dispositivos)
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'loadThread', threadId: msgId }));
    }
}

function cerrarHilo() {
    _threadId = null;
    _cerrarMenuHilo();
    _cancelarEdicionHilo();
    document.getElementById('threadPanel').classList.remove('open');
    // Limpiar el input al cerrar
    const threadInputEl = document.getElementById('threadInput');
    if (threadInputEl) {
        threadInputEl.value = '';
        threadInputEl.style.height = 'auto';
        threadInputEl.style.borderColor = '';
        threadInputEl.placeholder = 'Responder en el hilo…';
        threadInputEl.blur();
    }
}

function enviarEnHilo() {
    const threadInputEl = document.getElementById('threadInput');
    if (!threadInputEl) return;
    const text = threadInputEl.value.trim();
    if (!text || !_threadId) return;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        mostrarToast('Sin conexión. Inténtalo de nuevo.', true);
        return;
    }

    // ── Modo edición ────────────────────────────────────────────
    if (_threadEditState) {
        const editId = _threadEditState.id;
        socket.send(JSON.stringify({ type: 'editMessage', id: editId, newText: text }));
        _onThreadMsgEditado(editId, text);
        _cancelarEdicionHilo();
        return;
    }

    // ── Envío normal con renderizado optimista ───────────────────
    const localId = 'local_thread_' + Date.now();
    const localMsg = {
        id:       localId,
        from:     username,
        message:  text,
        avatar:   myAvatarDataUrl,
        time:     new Date(),
        threadId: _threadId,
        self:     true
    };

    // Actualizar threadCount optimistamente en conversations[] y en el DOM
    let newCount = 1;
    Object.values(conversations).forEach(arr => {
        if (!Array.isArray(arr)) return;
        const m = arr.find(m => m.id === _threadId);
        if (m) {
            m.threadCount = (m.threadCount || 0) + 1;
            newCount = m.threadCount;
        }
    });
    const threadDiv = document.getElementById('thread_' + _threadId);
    if (threadDiv) {
        const tid = _threadId;
        threadDiv.innerHTML = `<button class="thread-btn" onclick="abrirHilo('${tid}')">🧵 ${newCount} respuesta${newCount > 1 ? 's' : ''}</button>`;
    }

    // Mostrar inmediatamente en el panel del hilo
    const ul = document.getElementById('threadMessages');
    if (ul) {
        ul.appendChild(_renderThreadMsg(localMsg));
        ul.scrollTop = ul.scrollHeight;
    }

    // Enviar al servidor
    socket.send(JSON.stringify({ type: 'threadMessage', threadId: _threadId, message: text }));

    threadInputEl.value = '';
    threadInputEl.style.height = 'auto';
    threadInputEl.focus();
}

// El listener del threadInput se registra en DOMContentLoaded (ver más abajo)

function _renderThreadMsg(msg) {
    const isMe      = msg.from === username || msg.self === true;
    const isDeleted = !!msg.deletedAt;
    const isEdited  = !!msg.editedAt && !isDeleted;
    const avatarSrc = msg.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(msg.from)}`;

    const li = document.createElement('li');
    li.className = 'thread-msg-item' + (isMe ? ' me' : '');
    li.id = 'thread_item_' + msg.id;
    li.dataset.msgid = msg.id;

    const textContent = isDeleted
        ? '🗑 Mensaje eliminado'
        : escapeHTML(msg.message || '');
    const editedBadge = isEdited ? '<span class="thread-msg-edited">(editado)</span>' : '';
    const timeStr     = horaActual(msg.time);

    li.innerHTML = `
        <img class="thread-msg-avatar" src="${avatarSrc}" alt="${escapeHTML(msg.from)}">
        <div class="thread-msg-body">
            <div class="thread-msg-from">${escapeHTML(msg.from)}</div>
            <div class="thread-msg-text${isDeleted ? ' deleted' : ''}">${textContent}${editedBadge}</div>
            <div class="thread-msg-time">${timeStr}</div>
        </div>`;

    // Menú contextual al hacer click (solo si no está eliminado o es el autor)
    if (!isDeleted || isMe) {
        li.addEventListener('click', (e) => {
            e.stopPropagation();
            _abrirMenuHilo(e, msg.id, isMe, isDeleted);
        });
    }

    return li;
}

/* ── Menú contextual dentro del hilo ─────────────────────── */
let _openThreadMenu = null;

function _cerrarMenuHilo() {
    if (_openThreadMenu) {
        _openThreadMenu.remove();
        _openThreadMenu = null;
    }
}

function _abrirMenuHilo(e, msgId, isMe, isDeleted) {
    _cerrarMenuHilo();

    const menu = document.createElement('div');
    menu.className = 'msg-ctx-menu visible';
    menu.id = 'threadCtxMenu';
    menu.style.cssText = 'position:fixed;z-index:9999;min-width:160px;';
    _openThreadMenu = menu;

    const ops = [];
    if (!isDeleted) ops.push({ icon: '✏️', label: 'Editar',   fn: () => _editarEnHilo(msgId),   show: isMe });
    if (!isDeleted) ops.push({ icon: '🗑',  label: 'Eliminar', fn: () => _eliminarEnHilo(msgId), show: isMe, danger: true });
    if (!isDeleted) ops.push({ icon: '👁',  label: 'Ocultar para mí', fn: () => _ocultarEnHilo(msgId), show: true, danger: true });

    const visibleOps = ops.filter(o => o.show);
    if (visibleOps.length === 0) return;

    visibleOps.forEach((op, i) => {
        if (op.danger && i > 0) {
            const sep = document.createElement('div');
            sep.className = 'ctx-sep';
            menu.appendChild(sep);
        }
        const btn = document.createElement('button');
        btn.className = 'ctx-item' + (op.danger ? ' danger' : '');
        btn.innerHTML = `<span>${op.icon}</span><span>${op.label}</span>`;
        btn.onclick = (ev) => { ev.stopPropagation(); _cerrarMenuHilo(); op.fn(); };
        menu.appendChild(btn);
    });

    document.body.appendChild(menu);

    // Posicionar
    const rect = e.currentTarget ? e.currentTarget.getBoundingClientRect() : { bottom: e.clientY, left: e.clientX };
    let top = rect.bottom + 4;
    let left = isMe ? rect.right - menu.offsetWidth : rect.left;
    if (top + menu.offsetHeight > window.innerHeight - 10) top = rect.top - menu.offsetHeight - 4;
    if (left < 4) left = 4;
    if (left + menu.offsetWidth > window.innerWidth - 4) left = window.innerWidth - menu.offsetWidth - 4;
    menu.style.top  = top  + 'px';
    menu.style.left = left + 'px';

    // Cerrar al hacer click fuera
    setTimeout(() => {
        document.addEventListener('click', _cerrarMenuHilo, { once: true });
    }, 0);
}

/* ── Editar mensaje dentro del hilo ────────────────────────── */
let _threadEditState = null;

function _editarEnHilo(msgId) {
    // Obtener texto actual del DOM del hilo
    const li     = document.getElementById('thread_item_' + msgId);
    const textEl = li ? li.querySelector('.thread-msg-text') : null;
    const current = textEl ? (textEl.textContent || '').replace('(editado)', '').trim() : '';

    _threadEditState = { id: msgId };

    const threadInputEl = document.getElementById('threadInput');
    if (threadInputEl) {
        threadInputEl.value = current;
        threadInputEl.style.height = 'auto';
        threadInputEl.style.height = Math.min(threadInputEl.scrollHeight, 90) + 'px';
        threadInputEl.focus();
        threadInputEl.selectionStart = threadInputEl.selectionEnd = threadInputEl.value.length;
        threadInputEl.style.borderColor = '#f59e0b'; // naranja = modo edición
        threadInputEl.placeholder = '✏️ Editando mensaje del hilo…';
    }
}

function _cancelarEdicionHilo() {
    _threadEditState = null;
    const threadInputEl = document.getElementById('threadInput');
    if (threadInputEl) {
        threadInputEl.value = '';
        threadInputEl.style.height = 'auto';
        threadInputEl.style.borderColor = '';
        threadInputEl.placeholder = 'Responder en el hilo…';
    }
}

/* ── Eliminar mensaje dentro del hilo ──────────────────────── */
function _eliminarEnHilo(msgId) {
    if (!confirm('¿Eliminar este mensaje del hilo?')) return;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        mostrarToast('Sin conexión', true); return;
    }
    socket.send(JSON.stringify({ type: 'deleteMessage', id: msgId }));
    // Actualización optimista
    _onThreadMsgEliminado(msgId);
}

function _ocultarEnHilo(msgId) {
    try {
        const hidden = JSON.parse(localStorage.getItem('kvs_hidden_msgs') || '[]');
        if (!hidden.includes(msgId)) { hidden.push(msgId); localStorage.setItem('kvs_hidden_msgs', JSON.stringify(hidden)); }
    } catch(_) {}
    const li = document.getElementById('thread_item_' + msgId);
    if (li) li.remove();
    mostrarToast('Mensaje ocultado para ti');
}

function _onThreadMsgEliminado(msgId) {
    const li     = document.getElementById('thread_item_' + msgId);
    const textEl = li ? li.querySelector('.thread-msg-text') : null;
    if (textEl) {
        textEl.textContent = '🗑 Mensaje eliminado';
        textEl.classList.add('deleted');
        // Quitar badge (editado) si lo había
        const badge = li.querySelector('.thread-msg-edited');
        if (badge) badge.remove();
    }
    if (li) li.removeEventListener('click', li._menuHandler);
}

function _onThreadMsgEditado(msgId, newText) {
    const li     = document.getElementById('thread_item_' + msgId);
    const textEl = li ? li.querySelector('.thread-msg-text') : null;
    if (textEl) {
        textEl.innerHTML = escapeHTML(newText) + '<span class="thread-msg-edited">(editado)</span>';
    }
}

function onHistorialHilo(data) {
    if (data.threadId !== _threadId) return;
    // Actualizar el mensaje raíz con los datos del servidor (fiable en ambos dispositivos)
    if (data.rootMsg) {
        const root = data.rootMsg;
        document.getElementById('threadRootFrom').textContent = root.from || '';
        document.getElementById('threadRootText').textContent =
            (root.deletedAt ? '🗑 Mensaje eliminado' : (root.message || '')).slice(0, 200);
    }
    const ul = document.getElementById('threadMessages');
    ul.innerHTML = '';
    (data.messages || []).forEach(msg => ul.appendChild(_renderThreadMsg(msg)));
    ul.scrollTop = ul.scrollHeight;
}

function onMensajeHilo(data) {
    // Actualizar threadCount en conversations[] (fuente de verdad para recargas)
    Object.values(conversations).forEach(arr => {
        if (!Array.isArray(arr)) return;
        const m = arr.find(m => m.id === data.threadId);
        if (m) m.threadCount = data.threadCount;
    });

    // Actualizar el botón "🧵 N respuestas" en el chat principal si el div está en el DOM
    const threadDiv = document.getElementById('thread_' + data.threadId);
    if (threadDiv) {
        const count = data.threadCount;
        threadDiv.innerHTML = `<button class="thread-btn" onclick="abrirHilo('${data.threadId}')">🧵 ${count} respuesta${count > 1 ? 's' : ''}</button>`;
    }

    // Si el panel está abierto para este hilo
    if (_threadId === data.threadId) {
        const ul = document.getElementById('threadMessages');
        if (!ul) return;

        const incoming = data.msg;
        const isMyMsg  = incoming.from === username;

        if (isMyMsg) {
            // Confirmación del servidor: reemplazar el mensaje optimista local
            const localItems = ul.querySelectorAll('[id^="thread_item_local_thread_"]');
            let replaced = false;
            localItems.forEach(li => {
                if (!replaced) {
                    const textEl = li.querySelector('.thread-msg-text');
                    if (textEl && textEl.textContent.trim() === (incoming.message || '').trim()) {
                        const newLi = _renderThreadMsg(incoming);
                        li.replaceWith(newLi);
                        replaced = true;
                    }
                }
            });
            // Si no encontramos el optimista, añadir solo si no existe ya
            if (!replaced && !ul.querySelector('#thread_item_' + incoming.id)) {
                ul.appendChild(_renderThreadMsg(incoming));
                ul.scrollTop = ul.scrollHeight;
            }
        } else {
            // Mensaje del otro usuario: añadir si no existe ya
            if (!ul.querySelector('#thread_item_' + incoming.id)) {
                ul.appendChild(_renderThreadMsg(incoming));
                ul.scrollTop = ul.scrollHeight;
            }
        }
    }
}

// ============================================================
// IDIOMA DEL TECLADO
// ============================================================


// ============================================================
