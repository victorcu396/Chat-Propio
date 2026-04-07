// TOAST (notificación flotante no intrusiva)
// ============================================================
let _toastTimer = null;
function mostrarToast(msg, esError = false) {
    let toast = document.getElementById('kvsToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'kvsToast';
        toast.style.cssText = [
            'position:fixed','bottom:28px','left:50%',
            'transform:translateX(-50%) translateY(20px)',
            'background:rgba(30,27,75,0.92)','color:#fff','border-radius:22px',
            'padding:11px 22px','font-size:14px','font-weight:600',
            "font-family:'DM Sans',sans-serif",
            'box-shadow:0 6px 28px rgba(0,0,0,0.28)','z-index:99999',
            'opacity:0','transition:opacity .22s, transform .22s',
            'white-space:nowrap','max-width:90vw','text-align:center',
            'pointer-events:none'
        ].join(';');
        document.body.appendChild(toast);
    }
    if (esError) toast.style.background = '#ef4444';
    else toast.style.background = 'rgba(30,27,75,0.92)';
    toast.textContent = msg;
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(20px)';
    }, 3000);
}

// ============================================================
// ACCIONES SOBRE MENSAJES
// ============================================================

// Estado de respuesta activa
let _replyState = null; // { id, from, text }
// Estado de edición activa
let _editState  = null; // { id }
// Menú contextual abierto
let _openMenuRow = null;

/* ─── Menú contextual ──────────────────────────────────────── */
const QUICK_EMOJIS = ['👍','❤️','😂','😮','😢','🔥'];
function abrirMenuMensaje(e, msgId, isMe, isDeleted, isGroup) {
    e.stopPropagation();
    e.preventDefault(); // Añadido para evitar comportamientos por defecto del navegador

    // Si el menú ya está abierto para este mensaje, cerrarlo (toggle)
    const existingMenu = document.getElementById('msgCtxMenu');
    if (existingMenu) {
        const wasThisMsg = existingMenu.dataset.formsgid === msgId;
        cerrarMenuMensaje();
        if (wasThisMsg) return; // toggle off
    }

    const row = document.querySelector(`[data-msgid="${msgId}"]`);
    if (!row) return;
    const bubble = row.querySelector('.bubble');

    // ── Determinar isMe e isDeleted directamente del DOM ──
    const isMeFinal      = row.classList.contains('me');
    const isDeletedFinal = bubble ? bubble.classList.contains('deleted') : isDeleted;

    row.classList.add('menu-open');
    _openMenuRow = row;

    // Construir menú
    const menu = document.createElement('div');
    menu.className = 'msg-ctx-menu visible';
    menu.id = 'msgCtxMenu';
    menu.dataset.formsgid = msgId;

    // Barra de reacciones rápidas (solo si no eliminado)
    if (!isDeletedFinal) {
        const reactBar = document.createElement('div');
        reactBar.className = 'react-quick-bar';
        QUICK_EMOJIS.forEach(emoji => {
            const btn = document.createElement('button');
            btn.className = 'react-quick-btn';
            btn.textContent = emoji;
            btn.title = emoji;
            btn.onclick = (ev) => { ev.stopPropagation(); toggleReaccion(msgId, emoji); cerrarMenuMensaje(); };
            reactBar.appendChild(btn);
        });
        menu.appendChild(reactBar);
    }

    // Opciones del menú (Mantenemos toda tu lógica original)
    const ops = [];
    if (!isDeletedFinal) ops.push({ icon: '↩', label: 'Responder',    fn: () => iniciarRespuesta(msgId) });
    if (!isDeletedFinal) ops.push({ icon: '🧵', label: 'Ver hilo',     fn: () => abrirHilo(msgId) });
    if (!isDeletedFinal) ops.push({ icon: '↗', label: 'Reenviar',    fn: () => abrirModalReenviar(msgId) });
    if (!isDeletedFinal) ops.push({ icon: '☑️', label: 'Seleccionar', fn: () => entrarModoSeleccion(msgId) });
    if (!isDeletedFinal) ops.push({ icon: '⭐', label: 'Destacar',    fn: () => destacarMensaje(msgId) });
    if (!isDeletedFinal && isMeFinal) ops.push({ icon: '✏️', label: 'Editar',               fn: () => iniciarEdicion(msgId) });
    if (!isDeletedFinal && isMeFinal) ops.push({ icon: '🗑',  label: 'Eliminar para todos', fn: () => eliminarMensaje(msgId), danger: true });
    if (isMeFinal)                     ops.push({ icon: '👁',  label: isDeletedFinal ? 'Ocultar para mí' : 'Ocultar solo para mí', fn: () => ocultarMensajeParaMi(msgId), danger: true });

    ops.forEach((op, i) => {
        if (op.danger && i > 0) {
            const sep = document.createElement('div');
            sep.className = 'ctx-sep';
            menu.appendChild(sep);
        }
        const btn = document.createElement('button');
        btn.className = 'ctx-item' + (op.danger ? ' danger' : '');
        btn.innerHTML = `<span>${op.icon}</span><span>${op.label}</span>`;
        btn.onclick = (ev) => { ev.stopPropagation(); cerrarMenuMensaje(); op.fn(); };
        menu.appendChild(btn);
    });

    // Añadir al BODY invisible para poder medir dimensiones reales
    menu.style.visibility = 'hidden';
    document.body.appendChild(menu);

    // Medir y posicionar correctamente antes de mostrar
    requestAnimationFrame(() => {
        const menuRect = menu.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const margin = 8;

        let posX = e.clientX;
        let posY = e.clientY;

        // No salirse por la derecha
        if (posX + menuRect.width + margin > vw) {
            posX = vw - menuRect.width - margin;
        }
        if (posX < margin) posX = margin;

        // Preferir abrir hacia abajo; si no cabe, abrir hacia arriba
        if (posY + menuRect.height + margin > vh) {
            posY = e.clientY - menuRect.height;
        }
        if (posY < margin) posY = margin;

        menu.style.left       = posX + 'px';
        menu.style.top        = posY + 'px';
        menu.style.visibility = 'visible';
    });

    // Cerrar al pulsar fuera (Mantenemos tu lógica de 300ms)
    const openedAt = Date.now();
    const _closeHandler = (ev) => {
        if (Date.now() - openedAt < 300) return; 
        const menu = document.getElementById('msgCtxMenu');
        if (menu && menu.contains(ev.target)) return; 
        document.removeEventListener('click', _closeHandler, true);
        document.removeEventListener('touchend', _closeHandler, true);
        cerrarMenuMensaje();
    };

    setTimeout(() => {
        document.addEventListener('click', _closeHandler, true);
        document.addEventListener('touchend', _closeHandler, true);
    }, 50);

    menu._closeHandler = _closeHandler;
}

function _onClickOutsideMenu(ev) {
    // Legacy — kept for safety but new menus use menu._closeHandler
    const menu = document.getElementById('msgCtxMenu');
    if (menu && menu.contains(ev.target)) return;
    document.removeEventListener('click', _onClickOutsideMenu);
    cerrarMenuMensaje();
}

function cerrarMenuMensaje() {
    document.removeEventListener('click', _onClickOutsideMenu);
    const existing = document.getElementById('msgCtxMenu');
    if (existing) {
        // Quitar el handler de cierre por click-fuera si existe
        if (existing._closeHandler) {
            document.removeEventListener('click',    existing._closeHandler, true);
            document.removeEventListener('touchend', existing._closeHandler, true);
        }
        existing.remove();
    }
    if (_openMenuRow) { _openMenuRow.classList.remove('menu-open'); _openMenuRow = null; }
}

/* ─── Scroll a mensaje referenciado ────────────────────────── */
function scrollToMsg(msgId) {
    const el = document.getElementById(msgId);
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.transition = 'background .2s';
        el.style.background = 'rgba(79,70,229,0.18)';
        setTimeout(() => { el.style.background = ''; }, 1200);
    }
}

/* ─── RESPONDER ─────────────────────────────────────────────── */
function iniciarRespuesta(msgId) {
    // Buscar el mensaje en conversations para obtener datos fiables
    let msgFrom = '', msgText = '';
    for (const arr of Object.values(conversations)) { if (!Array.isArray(arr)) continue;
        const m = arr.find(m => m.id === msgId);
        if (m) {
            msgFrom = m.from === username ? 'Tú' : m.from;
            if (m.deletedAt) { msgText = '🗑 Mensaje eliminado'; }
            else if (m.imageData) { msgText = '📷 Imagen'; }
            else if (m.audioData) { msgText = '🎙 Audio'; }
            else { msgText = (m.message || '').trim().slice(0, 80); }
            break;
        }
    }
    // Fallback al DOM si no está en conversations (mensaje local)
    if (!msgFrom) {
        const bubble = document.getElementById(msgId);
        const row = bubble ? bubble.closest('.msg-row') : null;
        msgFrom = row ? (row.querySelector('.msg-avatar')?.alt || 'Mensaje') : 'Mensaje';
        const textEl = bubble ? bubble.querySelector('.msg-text') : null;
        msgText = textEl ? (textEl.textContent || '').trim().slice(0, 80) : '';
    }

    _replyState = { id: msgId, from: msgFrom, text: msgText };
    document.getElementById('replyBarName').textContent = msgFrom;
    document.getElementById('replyBarText').textContent = msgText || '📷 Imagen';
    document.getElementById('replyBar').classList.add('visible');
    input.focus();
}

function cancelarRespuesta() {
    _replyState = null;
    // Si estábamos en modo edición, cancelar la edición completamente
    if (_editState) {
        _editState = null;
        input.value = '';
        input.style.height = 'auto';
        actualizarBtnEnviar();
        // Restaurar onclick al enviar normal
        btnEnviar.onclick = enviar;
    }
    document.getElementById('replyBar').classList.remove('visible');
    document.getElementById('replyBarName').textContent = '';
    document.getElementById('replyBarText').textContent = '';
}

/* ─── EDITAR ────────────────────────────────────────────────── */
function iniciarEdicion(msgId) {
    // Leer el texto original de conversations (fuente de verdad), no del DOM
    let currentText = '';
    for (const arr of Object.values(conversations)) { if (!Array.isArray(arr)) continue;
        const m = arr.find(m => m.id === msgId);
        if (m && !m.deletedAt) { currentText = m.message || ''; break; }
    }
    // Fallback robusto al DOM: clonar msg-text, quitar reply-preview/forward-label/meta
    if (!currentText) {
        const bubble = document.getElementById(msgId);
        const textEl = bubble ? bubble.querySelector('.msg-text') : null;
        if (textEl) {
            const cloned = textEl.cloneNode(true);
            cloned.querySelectorAll('.reply-preview,.forward-label,.meta,.edited-label,.star-badge,.estado,.hora').forEach(el => el.remove());
            currentText = cloned.textContent.trim();
        }
    }

    // Cancelar cualquier respuesta pendiente sin borrar el input (lo ponemos nosotros)
    if (_replyState) {
        _replyState = null;
        document.getElementById('replyBar').classList.remove('visible');
    }

    _editState = { id: msgId };
    input.value = currentText;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    // Mover cursor al final
    input.selectionStart = input.selectionEnd = input.value.length;
    input.focus();

    document.getElementById('replyBarName').textContent = '✏️ Editando mensaje';
    document.getElementById('replyBarText').textContent = currentText.slice(0, 60) || '(sin texto)';
    document.getElementById('replyBar').classList.add('visible');

    actualizarBtnEnviar();
    // Override de enviar → guardarEdicion (solo onclick; keydown Enter ya lo maneja)
    btnEnviar.onclick = guardarEdicion;
}

function guardarEdicion() {
    if (!_editState) return;
    const newText = input.value.trim();
    if (!newText) {
        // Texto vacío: simplemente cancelar sin enviar
        cancelarRespuesta();
        return;
    }

    const editId = _editState.id;

    // Si el id todavía es local_ (eco aún no llegó), no enviamos la edición
    // al servidor: actualizamos el texto local en conversations[] y en el DOM,
    // y guardamos el nuevo texto para cuando llegue el id real.
    if (editId.startsWith('local_')) {
        // Actualizar texto en conversations[] (la fuente de verdad local)
        for (const arr of Object.values(conversations)) { if (!Array.isArray(arr)) continue;
            const m = arr.find(m => m.id === editId);
            if (m) { m.message = newText; m._pendingEdit = newText; m.editedAt = new Date(); break; }
        }
        // Actualizar DOM: texto + label (editado)
        const bubble = document.getElementById(editId);
        if (bubble) {
            const textEl = bubble.querySelector('.msg-text');
            if (textEl) {
                const replyPreview = textEl.querySelector('.reply-preview');
                if (replyPreview) {
                    textEl.innerHTML = '';
                    textEl.appendChild(replyPreview);
                    const span = document.createElement('span');
                    span.innerHTML = escapeHTML(newText);
                    textEl.appendChild(span);
                } else {
                    textEl.innerHTML = escapeHTML(newText);
                }
            }
            // Añadir (editado) en .meta si no existe aún
            const meta = bubble.querySelector('.meta');
            if (meta && !meta.querySelector('.edited-label')) {
                meta.insertAdjacentHTML('beforeend', '<span class="edited-label">(editado)</span>');
            }
        }
        // Marcar que cuando llegue el eco con el id real, hay que enviar una edición
        window._pendingEdits = window._pendingEdits || {};
        window._pendingEdits[editId] = newText;
    } else {
        socket.send(JSON.stringify({ type: 'editMessage', id: editId, newText }));
    }

    // Reset limpio del estado
    _editState = null;
    _replyState = null;
    input.value = '';
    input.style.height = 'auto';
    btnEnviar.onclick = enviar;
    actualizarBtnEnviar();
    document.getElementById('replyBar').classList.remove('visible');
    document.getElementById('replyBarName').textContent = '';
    document.getElementById('replyBarText').textContent = '';
}

function onMensajeEditado(msgId, newText, editedAt) {
    // Actualizar en conversations
    Object.values(conversations).forEach(arr => { if (!Array.isArray(arr)) return;
        const m = arr.find(m => m.id === msgId);
        if (m) { m.message = newText; m.editedAt = editedAt || m.editedAt || new Date(); }
    });
    // Actualizar en DOM — preservando reply-preview si existe
    const bubble = document.getElementById(msgId);
    if (!bubble) return;
    const textEl = bubble.querySelector('.msg-text');
    if (textEl) {
        const replyPreview = textEl.querySelector('.reply-preview');
        if (replyPreview) {
            textEl.innerHTML = '';
            textEl.appendChild(replyPreview);
            const span = document.createElement('span');
            span.innerHTML = escapeHTML(newText);
            textEl.appendChild(span);
        } else {
            textEl.innerHTML = escapeHTML(newText);
        }
    }
    // Añadir o mantener label "(editado)" en .meta
    const meta = bubble.querySelector('.meta');
    if (meta) {
        // Quitar cualquier edited-label existente y añadir uno fresco
        const existing = meta.querySelector('.edited-label');
        if (existing) existing.remove();
        meta.insertAdjacentHTML('beforeend', '<span class="edited-label">(editado)</span>');
    }
}

/* ─── MODO SELECCIÓN MÚLTIPLE ───────────────────────────────── */
// Set con los msgIds seleccionados
const _seleccion = new Set();

function entrarModoSeleccion(primerMsgId) {
    cerrarMenuMensaje();
    _seleccion.clear();
    chat.classList.add('chat-in-select-mode');
    // Ocultar input area y mostrar barra de selección
    const inputArea   = document.querySelector('.input-area');
    const selBar      = document.getElementById('selectionBar');
    if (inputArea) inputArea.style.display = 'none';
    if (selBar)    selBar.classList.add('visible');
    // Seleccionar el primer mensaje
    if (primerMsgId) {
        const row = document.querySelector(`[data-msgid="${primerMsgId}"]`);
        if (row) _toggleSeleccion(primerMsgId, row);
    }
}

function salirModoSeleccion() {
    _seleccion.clear();
    chat.classList.remove('chat-in-select-mode');
    // Quitar clase selected de todos los rows
    chat.querySelectorAll('.msg-row.msg-selected').forEach(r => r.classList.remove('msg-selected'));
    // Restaurar input y ocultar barra
    const inputArea = document.querySelector('.input-area');
    const selBar    = document.getElementById('selectionBar');
    if (inputArea) inputArea.style.display = '';
    if (selBar)    selBar.classList.remove('visible');
}

function _toggleSeleccion(msgId, row) {
    if (_seleccion.has(msgId)) {
        _seleccion.delete(msgId);
        row.classList.remove('msg-selected');
    } else {
        _seleccion.add(msgId);
        row.classList.add('msg-selected');
    }
    _actualizarBarraSeleccion();
}

function _actualizarBarraSeleccion() {
    const count   = _seleccion.size;
    const countEl = document.getElementById('selBarCount');
    if (countEl) countEl.textContent = count === 0 ? 'Ninguno seleccionado'
        : count === 1 ? '1 mensaje seleccionado'
        : `${count} mensajes seleccionados`;
    // Habilitar/deshabilitar botones
    const delBtn = document.querySelector('.btn-sel-del');
    const fwdBtn = document.querySelector('.btn-sel-fwd');
    const cpyBtn = document.querySelector('.btn-sel-copy');
    [delBtn, fwdBtn, cpyBtn].forEach(b => { if (b) b.disabled = count === 0; });
}

function selCopiar() {
    if (_seleccion.size === 0) return;
    // Copiar el texto de los mensajes seleccionados en orden de aparición en el DOM
    const rows = [...chat.querySelectorAll('.msg-row')];
    const textos = [];
    rows.forEach(row => {
        const msgId = row.dataset.msgid;
        if (!msgId || !_seleccion.has(msgId)) return;
        const bubble = row.querySelector('.bubble');
        if (!bubble || bubble.classList.contains('deleted')) return;
        const textEl = bubble.querySelector('.msg-text');
        if (!textEl) return;
        // Extraer texto puro (sin reply-preview, meta, etc.)
        const clone = textEl.cloneNode(true);
        clone.querySelectorAll('.reply-preview,.forward-label,.meta,.edited-label,.star-badge,.estado,.hora').forEach(el => el.remove());
        const txt = clone.textContent.trim();
        if (txt) textos.push(txt);
    });
    if (textos.length === 0) { mostrarToast('No hay texto que copiar.', true); return; }
    navigator.clipboard.writeText(textos.join('\n')).then(() => {
        mostrarToast(`📋 ${textos.length === 1 ? 'Mensaje copiado' : textos.length + ' mensajes copiados'}`);
        salirModoSeleccion();
    }).catch(() => {
        mostrarToast('No se pudo copiar.', true);
    });
}

function selReenviar() {
    if (_seleccion.size === 0) return;
    if (_seleccion.size === 1) {
        // Un solo mensaje: usar el modal de reenvío normal
        const msgId = [..._seleccion][0];
        salirModoSeleccion();
        abrirModalReenviar(msgId);
        return;
    }
    // Múltiples: reenviar uno a uno al destino elegido
    const ids = [..._seleccion];
    salirModoSeleccion();
    // Reutilizar el modal de reenvío enviando todos los ids
    _forwardMultipleIds = ids;
    _abrirModalReenviarMultiple();
}

// Reenvío múltiple: abrir el mismo modal de reenvío pero enviar todos los mensajes
let _forwardMultipleIds = [];

function _abrirModalReenviarMultiple() {
    if (!_forwardMultipleIds.length) return;
    const list = document.getElementById('forwardList');
    list.innerHTML = '';
    // Construir lista de contactos igual que abrirModalReenviar
    myContacts.forEach((c) => {
        const onlineUsername = getOnlineUsernameByPhone(c.contactPhone);
        const avatarUrl = c.avatar || userAvatars['__phone__' + c.contactPhone]
            || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(c.customName)}`;
        const item = document.createElement('div');
        item.className = 'forward-item';
        item.innerHTML = `<img src="${avatarUrl}" alt="${escapeHTML(c.customName)}"><span class="forward-item-name">${escapeHTML(c.customName)}</span>`;
        item.onclick = () => {
            _forwardMultipleIds.forEach(msgId => {
                const payload = { type: 'forwardMessage', id: msgId };
                if (onlineUsername) payload.to = onlineUsername;
                else payload.toPhone = c.contactPhone;
                socket.send(JSON.stringify(payload));
            });
            mostrarToast(`↗ ${_forwardMultipleIds.length} mensajes reenviados`);
            _forwardMultipleIds = [];
            cerrarModalReenviar();
        };
        list.appendChild(item);
    });
    // Grupos también
    myGroups.forEach((g) => {
        const item = document.createElement('div');
        item.className = 'forward-item';
        const avatarHtml = g.avatar
            ? `<img src="${g.avatar}" alt="${escapeHTML(g.name)}">`
            : `<div style="width:36px;height:36px;border-radius:50%;background:var(--purple-pale);display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--purple-deep);font-size:15px;">${(g.name||'?').charAt(0).toUpperCase()}</div>`;
        item.innerHTML = `${avatarHtml}<span class="forward-item-name">${escapeHTML(g.name)}</span>`;
        item.onclick = () => {
            _forwardMultipleIds.forEach(msgId => {
                socket.send(JSON.stringify({ type: 'forwardMessage', id: msgId, toGroup: g.groupId }));
            });
            mostrarToast(`↗ ${_forwardMultipleIds.length} mensajes reenviados`);
            _forwardMultipleIds = [];
            cerrarModalReenviar();
        };
        list.appendChild(item);
    });
    document.getElementById('forwardModal').classList.add('visible');
}

function selEliminar() {
    if (_seleccion.size === 0) return;
    const count = _seleccion.size;
    const ids   = [..._seleccion];
    salirModoSeleccion();
    setTimeout(() => {
        if (!confirm(`¿Eliminar ${count === 1 ? 'este mensaje' : 'estos ' + count + ' mensajes'} para todos?`)) return;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            mostrarToast('Sin conexión. Inténtalo de nuevo.', true);
            return;
        }
        socket.send(JSON.stringify({ type: 'deleteMessages', ids }));
    }, 50);
}

/* ─── ELIMINAR ──────────────────────────────────────────────── */
function eliminarMensaje(msgId) {
    cerrarMenuMensaje();
    setTimeout(() => {
        if (!confirm('¿Eliminar este mensaje para todos?')) return;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            mostrarToast('Sin conexión. Inténtalo de nuevo.', true);
            return;
        }

        // Si el id todavía es local_ (el eco del servidor no ha llegado aún):
        // ocultar el mensaje del DOM inmediatamente y marcar como "pendiente de eliminar".
        // Cuando llegue el eco con el id real, lo eliminaremos del servidor.
        if (typeof msgId === 'string' && msgId.startsWith('local_')) {
            // Ocultar del DOM
            const row = document.querySelector(`[data-msgid="${msgId}"]`);
            if (row) row.remove();
            // Quitar de conversations
            Object.values(conversations).forEach(arr => { if (!Array.isArray(arr)) return;
                const idx = arr.findIndex(m => m.id === msgId);
                if (idx >= 0) arr.splice(idx, 1);
            });
            // Marcar como pendiente de eliminar cuando llegue el id real
            window._pendingDeletes = window._pendingDeletes || {};
            window._pendingDeletes[msgId] = true;
            mostrarToast('Mensaje eliminado ✓');
            return;
        }

        socket.send(JSON.stringify({ type: 'deleteMessage', id: msgId }));
    }, 50);
}

// Ocultar un mensaje solo en el dispositivo local (no afecta a otros usuarios)
function ocultarMensajeParaMi(msgId) {
    cerrarMenuMensaje();
    setTimeout(() => {
        if (!confirm('¿Ocultar este mensaje solo para ti? Solo desaparecerá en tu pantalla.')) return;
        // Eliminar del DOM
        const row = document.querySelector(`[data-msgid="${msgId}"]`);
        if (row) row.remove();
        // Eliminar de conversations local para que no reaparezca al recargar historial
        Object.values(conversations).forEach(arr => { if (!Array.isArray(arr)) return;
            const idx = arr.findIndex(m => m.id === msgId);
            if (idx >= 0) arr.splice(idx, 1);
        });
        // Guardar en localStorage para que siga oculto tras reconectar
        try {
            const hidden = JSON.parse(localStorage.getItem('kvs_hidden_msgs') || '[]');
            if (!hidden.includes(msgId)) {
                hidden.push(msgId);
                // Mantener máximo 500 ids para no crecer indefinidamente
                if (hidden.length > 500) hidden.splice(0, hidden.length - 500);
                localStorage.setItem('kvs_hidden_msgs', JSON.stringify(hidden));
            }
        } catch(_) {}
        mostrarToast('Mensaje ocultado 👁');
    }, 50);
}

function onMensajeEliminado(msgId) {
    // Actualizar conversations
    Object.values(conversations).forEach(arr => { if (!Array.isArray(arr)) return;
        const m = arr.find(m => m.id === msgId);
        if (m) { m.deletedAt = new Date(); m.message = ''; m.imageData = null; m.audioData = null; }
    });
    // Actualizar DOM sin cloneNode
    const bubble = document.getElementById(msgId);
    if (!bubble) return;
    bubble.classList.add('deleted');
    // Limpiar contenido: dejar solo el texto de eliminado y el .meta
    const meta = bubble.querySelector('.meta');
    const metaClone = meta ? meta.cloneNode(true) : null;
    bubble.innerHTML = '';
    const textEl = document.createElement('span');
    textEl.className = 'msg-text';
    textEl.textContent = '🗑 Mensaje eliminado';
    bubble.appendChild(textEl);
    if (metaClone) bubble.appendChild(metaClone);
    // Quitar reacciones
    const reactEl = document.getElementById('react_' + msgId);
    if (reactEl) reactEl.innerHTML = '';
    // Quitar el menú contextual si estaba abierto para este mensaje
    const openMenu = document.getElementById('msgCtxMenu');
    if (openMenu && openMenu.dataset.formsgid === msgId) cerrarMenuMensaje();
    // Quitar el modo selección de este mensaje si estaba seleccionado
    const row = bubble.closest('.msg-row');
    if (row) {
        row.classList.remove('msg-selected');
        _seleccion.delete(msgId);
        _actualizarBarraSeleccion();
        // Re-adjuntar handler: ahora es deleted=true, pero si es propio
        // el usuario puede usar "Ocultar para mí"
        const isMine = row.classList.contains('me');
        const isGrp  = !!(currentChat && currentChat.startsWith('group_'));
        // Quitar handler antiguo y adjuntar nuevo que refleje estado deleted
        if (bubble._kvsMenuHandler) {
            bubble.removeEventListener('click', bubble._kvsMenuHandler);
            bubble._kvsMenuHandler = null;
        }
        if (isMine) {
            const handler = (e) => {
                if (e.target.closest('.msg-ctx-menu')) return;
                e.stopPropagation();
                // abrirMenuMensaje lee isMe e isDeleted del DOM directamente
                abrirMenuMensaje(e, msgId, true, true, isGrp);
            };
            bubble._kvsMenuHandler = handler;
            bubble.addEventListener('click', handler);
            bubble.style.cursor = 'pointer';
        } else {
            bubble.style.cursor = 'default';
        }
    }
}

/* ─── REACCIONAR ────────────────────────────────────────────── */
function toggleReaccion(msgId, emoji) {
    if (!socket || !emoji) return;
    socket.send(JSON.stringify({ type: 'addReaction', id: msgId, emoji }));
}

function onReaccionActualizada(msgId, reactions) {
    // Actualizar conversations
    Object.values(conversations).forEach(arr => { if (!Array.isArray(arr)) return;
        const m = arr.find(m => m.id === msgId);
        if (m) m.reactions = reactions;
    });
    // Actualizar DOM
    const reactEl = document.getElementById('react_' + msgId);
    if (!reactEl) return;
    reactEl.innerHTML = _buildReactionsHtml(reactions, msgId);
}

/* ─── DESTACAR ──────────────────────────────────────────────── */
function destacarMensaje(msgId) {
    socket.send(JSON.stringify({ type: 'starMessage', id: msgId }));
}

function onMensajeDestacado(msgId, starred) {
    const bubble = document.getElementById(msgId);
    if (!bubble) return;
    const meta = bubble.querySelector('.meta');
    if (!meta) return;
    const existing = meta.querySelector('.star-badge');
    if (starred && !existing) {
        meta.insertAdjacentHTML('afterbegin', '<span class="star-badge">⭐</span>');
    } else if (!starred && existing) {
        existing.remove();
    }
    // Actualizar conversations
    Object.values(conversations).forEach(arr => { if (!Array.isArray(arr)) return;
        const m = arr.find(m => m.id === msgId);
        if (m) {
            if (!m.starredBy) m.starredBy = [];
            const idx = m.starredBy.indexOf(username);
            if (starred && idx < 0) m.starredBy.push(username);
            if (!starred && idx >= 0) m.starredBy.splice(idx, 1);
        }
    });
}

/* ─── REENVIAR ──────────────────────────────────────────────── */
let _forwardMsgId = null;

function abrirModalReenviar(msgId) {
    _forwardMsgId = msgId;
    const list = document.getElementById('forwardList');
    list.innerHTML = '';

    // Buscar mensaje original: primero en conversations, luego en el DOM
    let origMsg = null;
    for (const arr of Object.values(conversations)) { if (!Array.isArray(arr)) continue;
        const m = arr.find(m => m.id === msgId);
        if (m) { origMsg = { ...m }; break; }
    }
    // Fallback al DOM si no está en conversations (puede ser un id real recién llegado
    // cuyo entry en conversations aún tiene el id local antiguo)
    if (!origMsg) {
        const bubble = document.getElementById(msgId);
        if (bubble) {
            const row = bubble.closest('.msg-row');
            const textEl = bubble.querySelector('.msg-text');
            origMsg = {
                id: msgId,
                message: textEl ? textEl.textContent.trim() : '',
                imageData: null,
                audioData: null,
                from: row ? (row.querySelector('.msg-avatar')?.alt || username) : username,
                forwardedFrom: null
            };
            // Si hay imagen en la burbuja, recuperarla
            const imgEl = bubble.querySelector('.img-msg');
            if (imgEl) origMsg.imageData = imgEl.src;
        }
    }

    // Contactos
    myContacts.forEach((c) => {
        const onlineUsername = getOnlineUsernameByPhone(c.contactPhone);
        const avatarUrl = c.avatar || userAvatars['__phone__' + c.contactPhone]
            || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(c.customName)}`;
        const item = document.createElement('div');
        item.className = 'forward-item';
        item.innerHTML = `<img src="${avatarUrl}" alt="${escapeHTML(c.customName)}"><span class="forward-item-name">${escapeHTML(c.customName)}</span>`;
        item.onclick = () => {
            const payload = { type: 'forwardMessage', id: msgId };
            if (onlineUsername) payload.to = onlineUsername;
            else payload.toPhone = c.contactPhone;
            socket.send(JSON.stringify(payload));
            // Preview local inmediato solo si el destino es el chat activo
            const destKey = onlineUsername || ('phone:' + c.contactPhone);
            if (currentChat === destKey || (onlineUsername && currentChat === onlineUsername)) {
                const fwdPreview = {
                    id: 'local_fwd_' + Date.now(),
                    from: username,
                    to: onlineUsername || null,
                    message: origMsg ? (origMsg.message || '') : '',
                    imageData: origMsg ? origMsg.imageData : null,
                    audioData: origMsg ? origMsg.audioData : null,
                    time: new Date(),
                    self: true,
                    avatar: myAvatarDataUrl,
                    forwardedFrom: origMsg ? origMsg.from : username
                };
                if (!conversations[destKey]) conversations[destKey] = [];
                conversations[destKey].push(fwdPreview);
                addMessage(fwdPreview);
            }
            mostrarToast('Reenviado ✓');
            cerrarModalReenviar();
        };
        list.appendChild(item);
    });

    // Grupos
    myGroups.forEach((g) => {
        const item = document.createElement('div');
        item.className = 'forward-item';
        item.innerHTML = `<div style="width:36px;height:36px;border-radius:50%;background:var(--purple-pale);display:flex;align-items:center;justify-content:center;font-size:18px;">👥</div><span class="forward-item-name">${escapeHTML(g.name)}</span>`;
        item.onclick = () => {
            socket.send(JSON.stringify({ type: 'forwardMessage', id: msgId, groupId: g.groupId }));
            const grpKey = 'group_' + g.groupId;
            if (currentChat === grpKey) {
                const fwdGrpPreview = {
                    id: 'local_fwd_' + Date.now(),
                    from: username,
                    to: g.groupId,
                    groupId: g.groupId,
                    message: origMsg ? (origMsg.message || '') : '',
                    imageData: origMsg ? origMsg.imageData : null,
                    audioData: origMsg ? origMsg.audioData : null,
                    time: new Date(),
                    avatar: myAvatarDataUrl,
                    forwardedFrom: origMsg ? origMsg.from : username
                };
                if (!conversations[grpKey]) conversations[grpKey] = [];
                conversations[grpKey].push(fwdGrpPreview);
                addGroupMessage(fwdGrpPreview);
            }
            mostrarToast('Reenviado ✓');
            cerrarModalReenviar();
        };
        list.appendChild(item);
    });

    if (list.children.length === 0) {
        list.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:13px;text-align:center;">No tienes contactos ni grupos para reenviar.</div>';
    }

    document.getElementById('forwardModal').classList.add('visible');
}

function cerrarModalReenviar() {
    _forwardMsgId = null;
    document.getElementById('forwardModal').classList.remove('visible');
}

document.getElementById('forwardModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('forwardModal')) cerrarModalReenviar();
});

/* ─── HILO (THREAD) ─────────────────────────────────────────── */
