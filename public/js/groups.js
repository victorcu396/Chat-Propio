// GRUPOS
// ============================================================

// myGroups: Map de groupId → { groupId, name, ownerPhone, members }
let myGroups = new Map();

/* Cargar grupos desde el servidor via REST al hacer login */
async function cargarGrupos() {
    try {
        const res = await fetch(`/api/groups?phone=${encodeURIComponent(loginPhone)}`);
        const list = await res.json();
        myGroups = new Map();
        list.forEach(g => {
            myGroups.set(g.groupId, {
                groupId:    g.groupId,
                name:       g.name,
                ownerPhone: g.ownerPhone,
                members:    g.members,
                avatar:     g.avatar || null
            });
        });
        renderGroupsList();
        // Marcar grupos como listos y abrir chat pendiente si procede
        _gruposListos = true;
        if (window._pendingOpenChat) _abrirChatPendienteDesdeNotif();
    } catch(e) {
        console.error('Error cargando grupos:', e);
        _gruposListos = true; // marcar igualmente para no bloquear el flujo
    }
}

/* ── Badge global: título de pestaña + icono PWA ─────────────────────────────
   Suma todos los mensajes sin leer (contactos + grupos) y actualiza:
   - document.title  →  "(12) kiVooSpace – Chat"
   - navigator.setAppBadge()  →  número en el icono de la PWA / escritorio
   Se llama al final de renderContactsList y renderGroupsList.
──────────────────────────────────────────────────────────────────────────── */
function _actualizarBadgeGlobal() {
    // Sumar no leídos de contactos
    let total = 0;
    if (myContacts) {
        myContacts.forEach(c => {
            if (c.blocked || c.blockedUs) return;
            const un = getOnlineUsernameByPhone ? getOnlineUsernameByPhone(c.contactPhone) : null;
            const ck = un || ('phone:' + c.contactPhone);
            // Si está online, un === ck → contar solo una vez
            total += un ? (unreadCounts[un] || 0)
                        : (unreadCounts[ck] || 0) + (unreadCounts[c.contactPhone] || 0);
        });
    }
    // Sumar no leídos de grupos
    if (myGroups) {
        myGroups.forEach((g, gid) => {
            total += unreadCounts['group_' + gid] || 0;
        });
    }

    // Actualizar título de la pestaña/ventana
    const baseTitle = 'kiVooSpace – Chat';
    document.title = total > 0 ? `(${total}) ${baseTitle}` : baseTitle;

    // Actualizar badge en el icono de la PWA (Chrome/Android/Edge)
    if ('setAppBadge' in navigator) {
        if (total > 0) {
            navigator.setAppBadge(total).catch(() => {});
        } else {
            navigator.clearAppBadge().catch(() => {});
        }
    }
}

function renderGroupsList() {
    const ul = document.getElementById('groupsList');
    if (!ul) return;

    const searchVal = (document.getElementById('groupSearch')?.value || '').toLowerCase().trim();

    if (myGroups.size === 0) {
        ul.innerHTML = '<li class="contacts-empty" style="list-style:none;cursor:default;">Sin grupos</li>';
        return;
    }

    const filtered = [...myGroups.values()].filter(g =>
        !searchVal || g.name.toLowerCase().includes(searchVal)
    );

    if (filtered.length === 0) {
        ul.innerHTML = '<li class="contacts-empty" style="list-style:none;cursor:default;">Sin resultados</li>';
        return;
    }

    const items = filtered.map(g => {
        const chatKey = 'group_' + g.groupId;
        const isActive = currentChat === chatKey ? 'active' : '';
        const unread = unreadCounts[chatKey] || 0;
        const badge = unread ? `<span class="unread-badge">${unread}</span>` : '';
        const preview = lastMessages[chatKey] || '';
        const isOwner = g.ownerPhone === loginPhone;
        const initial = g.name.charAt(0).toUpperCase();
        const escapedName = g.name.replace(/'/g,"\'").replace(/"/g,'&quot;');
        const unreadClass = unread ? 'has-unread' : '';
        const previewText = unread
            ? (unread === 1 ? '1 mensaje sin leer' : `${unread} mensajes sin leer`)
            : (preview || g.members.length + ' miembros');

        const ownerBadge = isOwner ? `<span class="group-badge-owner">Admin</span>` : '';
        const viewBtn    = `<button class="btn-group-action" onclick="event.stopPropagation();abrirModalVerMiembros('${g.groupId}')" title="Ver miembros">👁️</button>`;
        const editBtn    = `<button class="btn-group-action" onclick="event.stopPropagation();abrirModalEditarGrupo('${g.groupId}')" title="Editar grupo">✏️</button>`;
        const leaveBtn   = !isOwner
            ? `<button class="btn-group-action danger" onclick="event.stopPropagation();salirDeGrupo('${g.groupId}','${escapedName}')" title="Salir del grupo">🚪</button>`
            : '';
        const deleteBtn  = isOwner
            ? `<button class="btn-group-action danger" onclick="event.stopPropagation();eliminarGrupo('${g.groupId}','${escapedName}')" title="Eliminar grupo">🗑</button>`
            : '';

        return `<li class="${isActive} ${unreadClass}" onclick="seleccionarGrupo('${g.groupId}')">
            <div class="group-avatar-circle">${g.avatar ? `<img src="${g.avatar}" alt="${g.name}">` : initial}</div>
            <div class="user-info" style="flex:1;min-width:0;">
                <div class="user-name" style="display:flex;align-items:center;gap:6px;">${g.name} ${ownerBadge}</div>
                <div class="user-preview">${previewText}</div>
            </div>
            ${badge}
            <div class="contact-actions">${viewBtn}${editBtn}${leaveBtn}${deleteBtn}</div>
        </li>`;
    });

    ul.innerHTML = items.join('');
    _actualizarBadgeGlobal();
}

function seleccionarGrupo(groupId) {
    const g = myGroups.get(groupId);
    if (!g) return;
    const chatKey = 'group_' + groupId;
    if (currentChat === chatKey) return;

    _limpiarEstadoChat();
    _mostrarWelcomePanel(false);
    currentChat = chatKey;
    unreadCounts[chatKey] = 0;
    _actualizarBadgeGlobal();
    // Cerrar notificaciones de la bandeja del sistema para este grupo
    _cerrarNotificacionesDeChat(chatKey);
    // Actualizar botones de cabecera
    document.getElementById('btnArchiveChat').classList.toggle('active', _archivedChats.has(chatKey));
    _actualizarBtnAutoDestruct();
    if (_searchActive) toggleSearchBar();
    _cerrarMentionList();
    chat.innerHTML = '';

    document.getElementById('chatName').textContent = '👥 ' + g.name;
    document.getElementById('chatName').style.color = '';
    document.getElementById('chatName').style.fontWeight = '';
    document.getElementById('chatName').style.fontSize = '';

    // Ocultar avatar de usuario 1:1
    const av = document.getElementById('chatAvatar');
    av.style.display = 'none';

    // Mostrar avatar de grupo
    actualizarHeaderGrupo(g);

    document.getElementById('chatStatus').textContent = `${g.members.length} miembros`;
    document.getElementById('chatStatus').style.color = 'var(--text-muted)';
    document.getElementById('chatPhone').style.display = 'none';

    // Habilitar escritura
    input.disabled = false;
    input.placeholder = 'Escribe un mensaje...';
    document.getElementById('btnMic').style.display = 'flex';

    // Botón unificado: cualquier miembro puede iniciar llamada grupal
    const btnU = document.getElementById('btnCallUnified');
    btnU.disabled = false;
    btnU.dataset.mode = 'group';
    btnU.title = 'Llamada grupal';

    // Siempre pedir historial fresco al abrir un grupo para tener
    // los estados read/delivered actualizados desde la BD.
    delete conversations[chatKey];
    socket.send(JSON.stringify({ type: 'loadGroupConversation', groupId }));

    renderGroupsList();
    renderContactsList();

    if (window.innerWidth <= 900 || document.documentElement.classList.contains('is-mobile')) {
        const sidebar = document.getElementById('sidebar');
        if (sidebar.classList.contains('visible')) toggleSidebar();
        _pushChatState();
    }
}

function addGroupMessage(msg) {
    const isMe = msg.from === username;
    if (msg.audioData) { addMessage(msg); return; } // delegar audio

    const isDeleted = !!msg.deletedAt;
    const isEdited  = !!msg.editedAt && !isDeleted;
    const isForward = !!msg.forwardedFrom;
    const isStarred = msg.starredBy && msg.starredBy.includes(username);
    const row = document.createElement('li');
    row.className = `msg-row ${isMe ? 'me' : ''}`;
    row.dataset.msgid = msg.id;

    const avatarSrc  = msg.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${msg.from}`;
    const estadoHtml = isMe
        ? `<span class="estado" id="estado_${msg.id}">${msg.read ? '✔✔ leído' : msg.delivered ? '✔✔' : '✔'}</span>`
        : '';
    const senderLabel = !isMe ? `<div style="font-size:11px;font-weight:600;color:var(--purple-deep);margin-bottom:2px;">${escapeHTML(msg.from)}</div>` : '';
    const forwardHtml = isForward && !isDeleted ? `<div class="forward-label">↗ Reenviado de <b>${escapeHTML(msg.forwardedFrom)}</b></div>` : '';
    const editedHtml  = isEdited ? `<span class="edited-label">(editado)</span>` : '';
    const starHtml    = isStarred ? `<span class="star-badge">⭐</span>` : '';
    const reactHtml   = _buildReactionsHtml(msg.reactions, msg.id);
    const threadHtml  = (!isDeleted && msg.threadCount)
        ? `<button class="thread-btn" onclick="abrirHilo('${msg.id}')">🧵 ${msg.threadCount} respuesta${msg.threadCount > 1 ? 's' : ''}</button>` : '';

    let replyHtml = '';
    if (msg.replyToId && !isDeleted) {
        replyHtml = `<div class="reply-preview" onclick="scrollToMsg('${msg.replyToId}')">
            <div class="rp-name">${escapeHTML(msg.replyToFrom || '')}</div>
            <div class="rp-text">${escapeHTML(msg.replyToText || '')}</div>
        </div>`;
    }

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
        ${_buildMsgActionsBtn(msg.id, isMe, isDeleted, true)}
        <img class="msg-avatar" src="${avatarSrc}" alt="${msg.from}">
        <div class="bubble-wrap">
            ${senderLabel}${forwardHtml}
            <div class="bubble ${isMe ? 'me' : 'other'}${isDeleted ? ' deleted' : ''}" id="${msg.id}">
                ${replyHtml}
                <span class="msg-text">${content}</span>
                <span class="meta">${starHtml}<span class="hora">${horaActual(msg.time)}</span>${editedHtml}${estadoHtml}</span>
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
    _attachBubbleClickMenu(row, msg.id, isMe, isDeleted, true);
    // Previsualización de enlace en mensajes de grupo de texto
    if (!isDeleted && !msg.imageData && !msg.audioData && msg.message) {
        const bubble = row.querySelector('.bubble');
        if (bubble) _adjuntarLinkPreview(bubble, msg.message);
    }
    // Botón de lectura granular (solo en mensajes propios no eliminados)
    if (isMe && !isDeleted) {
        const bubble = row.querySelector('.bubble');
        if (bubble) {
            const meta = bubble.querySelector('.meta');
            if (meta) {
                const readBtn = document.createElement('button');
                readBtn.className = 'btn-group-read';
                readBtn.title = 'Ver quién leyó';
                readBtn.textContent = '✔';
                readBtn.onclick = (e) => { e.stopPropagation(); mostrarLecturaGrupo(msg.id); };
                meta.appendChild(readBtn);
            }
        }
    }
    if (autoScroll) { scrollChat(); } else if (window._scrollBtnNewMsg && !window._kvsLoadingHistory) { window._scrollBtnNewMsg(); }
}

function onGroupMessage(data) {
    const chatKey = 'group_' + data.groupId;
    if (!conversations[chatKey]) conversations[chatKey] = [];
    if (!conversations[chatKey].some(m => m.id === data.id)) {
        const localIdx = data.from === username
            ? conversations[chatKey].findIndex(m =>
                typeof m.id === 'string' && m.id.startsWith('local_') && (
                    (data.imageData && m.imageData) ||
                    (data.audioData && m.audioData) ||
                    (!data.imageData && !data.audioData && (m.message || '') === (data.message || ''))
                ))
            : -1;
        if (localIdx >= 0) {
            if (conversations[chatKey][localIdx].editedAt && !data.editedAt) {
                data.editedAt = conversations[chatKey][localIdx].editedAt;
            }
            conversations[chatKey][localIdx] = { ...data, delivered: true };
        } else {
            conversations[chatKey].push(data);
        }
    }

    lastMessages[chatKey] = data.imageData ? '📷 Imagen'
        : data.audioData ? '🎙️ Audio'
        : data.message;

    if (currentChat === chatKey) {
        // Chat activo: limpiar contador de no leídos y notificaciones push si las hubiera
        if (data.from !== username) {
            unreadCounts[chatKey] = 0;
            _cerrarNotificacionesDeChat(chatKey);
        }
        if (data.from === username) {
            // Match por contenido igual que en 1:1
            const localRows = [...chat.querySelectorAll('.msg-row.me[data-msgid^="local_"]')];
            let matchedRow = null;
            for (const lr of localRows) {
                const bubble = lr.querySelector('.bubble');
                if (!bubble) continue;
                const textEl = bubble.querySelector('.msg-text');
                const imgEl  = bubble.querySelector('.img-msg');
                // Extraer texto propio sin reply-preview, forward-label, edited-label, etc.
                let rowText = '';
                if (textEl) {
                    const cloned = textEl.cloneNode(true);
                    cloned.querySelectorAll('.reply-preview,.forward-label,.meta,.edited-label,.star-badge,.estado,.hora,.audio-msg-wrap').forEach(el => el.remove());
                    rowText = cloned.textContent.trim();
                }
                if (data.imageData && imgEl) { matchedRow = lr; break; }
                if (data.audioData && bubble.querySelector('.audio-msg-wrap')) { matchedRow = lr; break; }
                if (!data.imageData && !data.audioData && rowText === (data.message || '').trim()) { matchedRow = lr; break; }
            }
            if (!matchedRow && localRows.length > 0) matchedRow = localRows[localRows.length - 1];

            if (matchedRow) {
                const oldLocalId = matchedRow.dataset.msgid;
                matchedRow.dataset.msgid = data.id;
                const bubble = matchedRow.querySelector('.bubble');
                if (bubble) bubble.id = data.id;
                const estadoEl = bubble ? bubble.querySelector(`#estado_${oldLocalId}`) : null;
                if (estadoEl) estadoEl.id = `estado_${data.id}`;
                const convArr = conversations[chatKey];
                if (convArr) {
                    const localIdx = convArr.findIndex(m => m.id === oldLocalId);
                    if (localIdx >= 0) {
                        if (convArr[localIdx].editedAt && !data.editedAt) {
                            data.editedAt = convArr[localIdx].editedAt;
                        }
                        convArr[localIdx].id = data.id;
                        convArr[localIdx].delivered = true;
                        if (data.read) convArr[localIdx].read = true;
                        const dupIdx = convArr.findIndex((m, i) => i !== localIdx && m.id === data.id);
                        if (dupIdx >= 0) convArr.splice(dupIdx, 1);
                    } else {
                        const realIdx = convArr.findIndex(m => m.id === data.id);
                        if (realIdx >= 0) {
                            convArr[realIdx].delivered = true;
                            if (data.read) convArr[realIdx].read = true;
                        }
                    }
                }
                // Aplicar el estado correcto si read/delivered llegaron antes del eco
                if (data.read) {
                    if (estadoEl) estadoEl.textContent = '✔✔ leído';
                } else if (data.delivered) {
                    if (estadoEl) estadoEl.textContent = '✔✔';
                }
                _attachBubbleClickMenu(matchedRow, data.id, true, false, true);

                // Si había una eliminación pendiente para este mensaje local, enviarla ahora
                if (window._pendingDeletes && window._pendingDeletes[oldLocalId]) {
                    delete window._pendingDeletes[oldLocalId];
                    if (socket && socket.readyState === WebSocket.OPEN) {
                        socket.send(JSON.stringify({ type: 'deleteMessage', id: data.id }));
                    }
                    const rowStill = document.querySelector(`[data-msgid="${data.id}"]`);
                    if (rowStill) rowStill.remove();
                    const convArr2 = conversations[chatKey];
                    if (convArr2) {
                        const di = convArr2.findIndex(m => m.id === data.id);
                        if (di >= 0) convArr2.splice(di, 1);
                    }
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
                // No encontró local_ → solo añadir si no está ya en el DOM
                const yaRenderizado = !!document.querySelector(`[data-msgid="${data.id}"]`);
                if (!yaRenderizado) addGroupMessage(data);
            }
        } else {
            addGroupMessage(data);
        }
    } else {
        unreadCounts[chatKey] = (unreadCounts[chatKey] || 0) + 1;
        if (data.from !== username) {
            // Detectar si nos mencionaron (individual o @todos)
            const msg = data.message || '';
            const isMentioned = (data.mentions && (
                data.mentions.includes(username) ||
                data.mentions.includes('todos') ||
                data.mentions.includes('all')
            )) || msg.includes('@' + username) || msg.includes('@todos');

            playNotifSound();
            const notifTitle = isMentioned
                ? '🔔 ' + (data.groupName || 'Grupo') + ' — te mencionaron'
                : '👥 ' + (data.groupName || 'Grupo');
            const notifBody = data.from + ': ' + (lastMessages[chatKey] || '');
            mostrarNotificacion(notifTitle, notifBody);
        }
    }
    renderGroupsList();
}

function onGroupHistory(data) {
    const chatKey    = 'group_' + data.groupId;
    const isLoadMore = !!data.isLoadMore;

    _historyLoading = false;
    const loadingEl = document.getElementById('historyLoadingIndicator');
    if (loadingEl) loadingEl.style.display = 'none';

    _historyHasMore = !!data.hasMore;
    if (data.messages && data.messages.length > 0) {
        _historyOldestId = data.messages[0].id;
    }

    let _hiddenMsgs;
    try { _hiddenMsgs = new Set(JSON.parse(localStorage.getItem('kvs_hidden_msgs') || '[]')); }
    catch(_) { _hiddenMsgs = new Set(); }

    if (currentChat !== chatKey) return;

    if (!isLoadMore) {
        conversations[chatKey] = data.messages;
        delete conversations[chatKey].__onlyPending; // historial real recibido
        chat.innerHTML = '';
        let lastDay = '';
        window._kvsLoadingHistory = true;
        data.messages.forEach(msg => {
            if (_hiddenMsgs.has(msg.id)) return;
            const day = obtenerDia(msg.time);
            if (day !== lastDay) { addDaySeparator(day); lastDay = day; }
            addGroupMessage(msg);
        });
        window._kvsLoadingHistory = false;
        _actualizarIndicadorPaginacion();
        // Informar al servidor que hemos leído este grupo
        if (socket && socket.readyState === WebSocket.OPEN) {
            try { socket.send(JSON.stringify({ type: 'markRead', chatKey })); } catch(_) {}
        }
    } else {
        if (!conversations[chatKey]) conversations[chatKey] = [];
        conversations[chatKey].unshift(...data.messages);

        const scrollHeightBefore = chat.scrollHeight;
        const scrollTopBefore    = chat.scrollTop;

        const tempList = document.createElement('ul');
        tempList.style.display = 'none';
        document.body.appendChild(tempList);
        const origAppendChild  = chat.appendChild.bind(chat);
        const origInsertBefore = chat.insertBefore.bind(chat);
        chat.appendChild  = (n) => tempList.appendChild(n);
        chat.insertBefore = (n, ref) => tempList.insertBefore(n, ref);

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
            addGroupMessage(msg);
        });
        window._kvsLoadingHistory = false;

        chat.appendChild  = origAppendChild;
        chat.insertBefore = origInsertBefore;

        const nodes = [...tempList.childNodes];
        nodes.reverse().forEach(n => chat.insertBefore(n, chat.firstChild));
        document.body.removeChild(tempList);

        chat.scrollTop = scrollTopBefore + (chat.scrollHeight - scrollHeightBefore);
        _actualizarIndicadorPaginacion();
    }
}

function onGroupCreated(data) {
    myGroups.set(data.groupId, {
        groupId:    data.groupId,
        name:       data.name,
        ownerPhone: data.ownerPhone,
        members:    data.members,
        avatar:     data.avatar || null
    });
    renderGroupsList();
    cerrarModalCrearGrupo();
}

function onGroupDeleted(groupId) {
    const chatKey = 'group_' + groupId;
    myGroups.delete(groupId);
    delete conversations[chatKey];
    if (currentChat === chatKey) {
        currentChat = null;
        chat.innerHTML = '';
        document.getElementById('chatName').textContent = 'Selecciona un usuario para empezar';
        document.getElementById('chatName').style.color = 'var(--text-muted)';
        document.getElementById('chatAvatar').style.display = 'none';
        document.getElementById('chatStatus').textContent = '';
        document.getElementById('chatPhone').style.display = 'none';
        _mostrarWelcomePanel(true);
    }
    renderGroupsList();
}

/* Modal crear grupo */
function abrirModalCrearGrupo() {
    document.getElementById('groupNameInput').value = '';
    document.getElementById('createGroupError').textContent = '';
    document.getElementById('btnCrearGrupo').disabled = false;

    // Rellenar lista de contactos con checkboxes
    const listEl = document.getElementById('groupMembersList');
    if (myContacts.size === 0) {
        listEl.innerHTML = '<span style="font-size:13px;color:var(--text-muted);">No tienes contactos guardados. Agrega contactos primero.</span>';
    } else {
        listEl.innerHTML = [...myContacts.values()].map(c => {
            const seedName = c.username || c.customName;
            const avatarUrl = c.avatar
                || userAvatars['__phone__' + c.contactPhone]
                || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(seedName)}`;
            const escaped = c.contactPhone.replace(/'/g,"\'");
            return `<label class="group-member-item">
                <input type="checkbox" value="${escaped}">
                <img class="group-member-avatar" src="${avatarUrl}" alt="${c.customName}">
                <span class="group-member-name">${c.customName}</span>
            </label>`;
        }).join('');
    }

    document.getElementById('createGroupModal').classList.add('visible');
    document.getElementById('groupNameInput').focus();
}

function cerrarModalCrearGrupo() {
    document.getElementById('createGroupModal').classList.remove('visible');
}

function crearGrupo() {
    const name = document.getElementById('groupNameInput').value.trim();
    const errEl = document.getElementById('createGroupError');

    if (!name) {
        errEl.textContent = 'Pon un nombre para el grupo.';
        return;
    }

    const checked = [...document.querySelectorAll('#groupMembersList input[type=checkbox]:checked')];
    if (checked.length === 0) {
        errEl.textContent = 'Selecciona al menos un contacto.';
        return;
    }

    const memberPhones = checked.map(cb => cb.value);

    errEl.textContent = '';
    document.getElementById('btnCrearGrupo').disabled = true;

    socket.send(JSON.stringify({
        type: 'createGroup',
        name,
        memberPhones
    }));
}

function salirDeGrupo(groupId, name) {
    if (!confirm(`¿Salir del grupo "${name}"?`)) return;
    socket.send(JSON.stringify({ type: 'leaveGroup', groupId }));
}

function eliminarGrupo(groupId, name) {
    if (!confirm(`¿Eliminar el grupo "${name}"? Esta acción no se puede deshacer.`)) return;
    socket.send(JSON.stringify({ type: 'deleteGroup', groupId }));
}

// Cerrar modal crear grupo al hacer click fuera
document.addEventListener('DOMContentLoaded', () => {
    const cgm = document.getElementById('createGroupModal');
    if (cgm) cgm.addEventListener('click', (e) => {
        if (e.target === cgm) cerrarModalCrearGrupo();
    });
    document.getElementById('groupNameInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') crearGrupo();
    });

    // Modal ver miembros: cerrar al click fuera
    const vmm = document.getElementById('viewMembersModal');
    if (vmm) vmm.addEventListener('click', (e) => { if (e.target === vmm) cerrarModalVerMiembros(); });

    // Modal editar grupo: cerrar al click fuera + Enter en el nombre
    const egm = document.getElementById('editGroupModal');
    if (egm) egm.addEventListener('click', (e) => { if (e.target === egm) cerrarModalEditarGrupo(); });
    const egn = document.getElementById('editGroupNameInput');
    if (egn) egn.addEventListener('keydown', (e) => { if (e.key === 'Enter') guardarEditarGrupo(); });

    // Thread input: adjuntar listener unificado (Enter envía, Shift+Enter = salto de línea)
    _attachThreadInputListener();
});

// ============================================================
// VER MIEMBROS DEL GRUPO (todos los miembros)
// ============================================================

function abrirModalVerMiembros(groupId) {
    const g = myGroups.get(groupId);
    if (!g) return;

    document.getElementById('viewMembersGroupName').textContent = g.name;

    const listEl = document.getElementById('viewMembersList');
    listEl.innerHTML = g.members.map(phone => {
        const isMe = phone === loginPhone;
        const isOwner = phone === g.ownerPhone;
        const contactEntry = myContacts.get(phone);
        const isContact = !!contactEntry;

        const displayName = isMe ? loginUsername
            : (contactEntry ? contactEntry.customName : phone);
        const seedName = isMe ? loginUsername
            : (contactEntry ? (contactEntry.username || contactEntry.customName) : phone);
        const avatarUrl = isMe ? myAvatarDataUrl
            : (contactEntry
                ? (contactEntry.avatar || userAvatars['__phone__' + phone]
                    || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(seedName)}`)
                : (userAvatars['__phone__' + phone]
                    || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(seedName)}`));

        let badges = '';
        if (isMe) {
            badges = `<span class="member-is-me">Tú</span>`;
        } else {
            if (isOwner) badges += `<span class="member-is-me">Admin</span>`;
            if (isContact) badges += `<span class="member-is-contact">✓ Contacto</span>`;
            else           badges += `<span class="member-not-contact">Sin agregar</span>`;
        }

        const addBtn = (!isMe && !isContact)
            ? `<button class="btn-group-action" title="Agregar contacto"
                onclick="abrirModalAgregarContactoDesdeGrupo('${phone.replace(/'/g,"\\'")}','${seedName.replace(/'/g,"\\'")}')"
                style="font-size:12px;padding:3px 8px;">＋</button>`
            : '';

        return `<div class="group-member-row">
            <img class="group-member-avatar" src="${avatarUrl}" alt="${escapeHTML(displayName)}"
                onerror="this.src='https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(seedName)}'">
            <div style="flex:1;min-width:0;">
                <div class="group-member-name">${escapeHTML(displayName)}</div>
                <div class="group-member-phone">${formatearTelefono(phone)}</div>
            </div>
            <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">${badges}${addBtn}</div>
        </div>`;
    }).join('');

    document.getElementById('viewMembersModal').classList.add('visible');
}

function cerrarModalVerMiembros() {
    document.getElementById('viewMembersModal').classList.remove('visible');
}

// Abre el modal "Nuevo contacto" con el teléfono del miembro pre-rellenado
function abrirModalAgregarContactoDesdeGrupo(phone, suggestedName) {
    cerrarModalVerMiembros();
    // Separar prefijo y abonado
    let prefix = '34';
    let digits9 = '';
    if (phone.startsWith('+34')) {
        prefix  = '34';
        digits9 = phone.slice(3).replace(/\D/g, '').slice(0, 9);
    } else {
        // Otro formato: quitar + y asumir los últimos 9 como abonado
        const allDigits = phone.replace(/\D/g, '');
        digits9 = allDigits.slice(-9);
        prefix  = allDigits.slice(0, allDigits.length - 9) || '34';
    }
    const prefixSelect = document.getElementById('contactPrefixSelect');
    if (prefixSelect) {
        // Seleccionar la opción que coincida; si no existe, usar la primera
        const opt = [...prefixSelect.options].find(o => o.value === prefix);
        if (opt) prefixSelect.value = prefix;
    }
    // Mostrar formateado
    document.getElementById('contactPhoneInput').value = formatDigits9(digits9);
    document.getElementById('contactNameInput').value  = suggestedName || '';
    document.getElementById('addContactError').textContent = '';
    document.getElementById('btnGuardarContacto').disabled = false;
    document.getElementById('addContactModal').classList.add('visible');
    document.getElementById('contactNameInput').focus();
}

// ============================================================
// EDITAR GRUPO (solo el admin)
// ============================================================

let _editingGroupId = null;

function abrirModalEditarGrupo(groupId) {
    const g = myGroups.get(groupId);
    if (!g) return;
    _editingGroupId = groupId;
    const isAdmin = g.ownerPhone === loginPhone;

    document.getElementById('editGroupNameInput').value = g.name;
    document.getElementById('editGroupError').textContent = '';
    document.getElementById('btnGuardarEditarGrupo').disabled = false;

    // Mostrar avatar actual del grupo en el modal
    const previewEl = document.getElementById('editGroupAvatarPreview');
    if (previewEl) {
        if (g.avatar) {
            previewEl.innerHTML = `<img src="${g.avatar}" alt="${escapeHTML(g.name || '')}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;">`;
        } else {
            previewEl.textContent = (g.name || '?').charAt(0).toUpperCase();
        }
    }
    // Reset input file foto del grupo
    const fi = document.getElementById('editGroupAvatarFileInput');
    if (fi) fi.value = '';

    // Miembros actuales
    const currentEl = document.getElementById('editGroupCurrentMembers');
    currentEl.innerHTML = g.members.map(phone => {
        const isMe = phone === loginPhone;
        const isOwner = phone === g.ownerPhone;
        const contactEntry = myContacts.get(phone);
        const isContact = !!contactEntry;
        const displayName = isMe ? (loginUsername + ' (tú)')
            : (contactEntry ? contactEntry.customName : phone);
        const seedName = isMe ? loginUsername
            : (contactEntry ? (contactEntry.username || contactEntry.customName) : phone);
        const avatarUrl = isMe ? myAvatarDataUrl
            : (contactEntry
                ? (contactEntry.avatar || userAvatars['__phone__' + phone]
                    || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(seedName)}`)
                : (userAvatars['__phone__' + phone]
                    || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(seedName)}`));

        let badge = isMe ? `<span class="member-is-me">Tú</span>`
            : isOwner ? `<span class="member-is-me">Admin</span>`
            : isContact ? `<span class="member-is-contact">Contacto</span>`
            : `<span class="member-not-contact">Sin agregar</span>`;

        // Solo el admin puede quitar miembros
        const removeBtn = (isAdmin && !isMe)
            ? `<button class="btn-group-action danger" title="Quitar del grupo"
                onclick="quitarMiembroDelGrupo(this,'${phone.replace(/'/g,"\\'")}')"
                style="margin-left:4px;">✕</button>`
            : '';

        return `<div class="group-member-row" data-phone="${phone}">
            <img class="group-member-avatar" src="${avatarUrl}" alt="${escapeHTML(displayName)}"
                onerror="this.src='https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(seedName)}'">
            <div style="flex:1;min-width:0;">
                <div class="group-member-name">${escapeHTML(displayName)}</div>
                <div class="group-member-phone">${formatearTelefono(phone)}</div>
            </div>
            <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">${badge}${removeBtn}</div>
        </div>`;
    }).join('');

    // Solo el admin puede añadir más contactos al grupo
    const addSection = document.getElementById('editGroupAddSection');
    if (addSection) addSection.style.display = isAdmin ? '' : 'none';

    if (isAdmin) {
        const addEl = document.getElementById('editGroupAddMembers');
        const memberSet = new Set(g.members);
        const toAdd = [...myContacts.values()].filter(c => !memberSet.has(c.contactPhone));
        if (toAdd.length === 0) {
            addEl.innerHTML = '<span style="font-size:13px;color:var(--text-muted);padding:4px 0;">Todos tus contactos ya están en el grupo.</span>';
        } else {
            addEl.innerHTML = toAdd.map(c => {
                const seedName = c.username || c.customName;
                const avatarUrl = c.avatar || userAvatars['__phone__' + c.contactPhone]
                    || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(seedName)}`;
                return `<label class="group-member-item">
                    <input type="checkbox" value="${c.contactPhone.replace(/'/g,"\\'")}">
                    <img class="group-member-avatar" src="${avatarUrl}" alt="${escapeHTML(c.customName)}"
                        onerror="this.src='https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(seedName)}'">
                    <span class="group-member-name">${escapeHTML(c.customName)}</span>
                </label>`;
            }).join('');
        }
    }

    document.getElementById('editGroupModal').classList.add('visible');
    setTimeout(() => document.getElementById('editGroupNameInput').focus(), 80);
}

function cerrarModalEditarGrupo() {
    document.getElementById('editGroupModal').classList.remove('visible');
    _editingGroupId = null;
}

// Disparar selector de archivo para la foto del grupo desde el modal editar
function dispararCambioFotoGrupo() {
    const fi = document.getElementById('editGroupAvatarFileInput');
    if (!fi) return;
    fi.value = '';
    fi.click();
}

// Cuando se selecciona una foto desde el modal editar grupo
function onEditGroupAvatarFileSelected(event) {
    const file = event.target.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 5 * 1024 * 1024) { alert('La imagen es demasiado grande. Máximo 5MB.'); return; }

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const SIZE = 256;
            canvas.width = SIZE; canvas.height = SIZE;
            const ctx = canvas.getContext('2d');
            const minSide = Math.min(img.width, img.height);
            const sx = (img.width - minSide) / 2;
            const sy = (img.height - minSide) / 2;
            ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, SIZE, SIZE);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

            // Actualizar el preview en el modal
            const previewEl = document.getElementById('editGroupAvatarPreview');
            if (previewEl) {
                previewEl.innerHTML = `<img src="${dataUrl}" alt="preview" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;">`;
            }

            // Si hay un grupo activo en edición, actualizar localmente y en servidor
            if (_editingGroupId) {
                const g = myGroups.get(_editingGroupId);
                if (g) { g.avatar = dataUrl; myGroups.set(_editingGroupId, g); }
                actualizarHeaderGrupo(myGroups.get(_editingGroupId));
                renderGroupsList();
                if (socket && socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({ type: 'updateGroupAvatar', groupId: _editingGroupId, avatar: dataUrl }));
                }
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function quitarMiembroDelGrupo(btn, phone) {
    const row = btn.closest('[data-phone]');
    if (row) row.remove();
}

function guardarEditarGrupo() {
    if (!_editingGroupId) return;
    const errEl = document.getElementById('editGroupError');
    const newName = document.getElementById('editGroupNameInput').value.trim();
    if (!newName) { errEl.textContent = 'El nombre no puede estar vacío.'; return; }

    const remainingPhones = [...document.querySelectorAll('#editGroupCurrentMembers [data-phone]')]
        .map(r => r.getAttribute('data-phone'));
    const newPhones = [...document.querySelectorAll('#editGroupAddMembers input[type=checkbox]:checked')]
        .map(cb => cb.value);
    const allPhones = [...new Set([...remainingPhones, ...newPhones])];

    if (allPhones.length === 0) { errEl.textContent = 'El grupo debe tener al menos un miembro.'; return; }

    errEl.textContent = '';
    document.getElementById('btnGuardarEditarGrupo').disabled = true;
    socket.send(JSON.stringify({ type: 'editGroup', groupId: _editingGroupId, name: newName, memberPhones: allPhones }));
}

function onGroupUpdated(data) {
    const existing = myGroups.get(data.groupId);
    if (existing) {
        existing.name       = data.name;
        existing.ownerPhone = data.ownerPhone;
        existing.members    = data.members;
        // Preservar avatar si el servidor no lo devuelve en este evento
        if (data.avatar !== undefined) existing.avatar = data.avatar;
        myGroups.set(data.groupId, existing);
    } else {
        myGroups.set(data.groupId, { groupId: data.groupId, name: data.name, ownerPhone: data.ownerPhone, members: data.members, avatar: data.avatar || null });
    }
    const chatKey = 'group_' + data.groupId;
    if (currentChat === chatKey) {
        document.getElementById('chatName').textContent = '👥 ' + data.name;
        document.getElementById('chatStatus').textContent = `${data.members.length} miembros`;
        // Actualizar header con el avatar preservado
        actualizarHeaderGrupo(myGroups.get(data.groupId));
    }
    renderGroupsList();
    cerrarModalEditarGrupo();
}

// ============================================================
