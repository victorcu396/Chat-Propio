// PANEL UNIFICADO: EMOJIS / FAVORITOS
// ============================================================

let _sgTab    = 'emojis';
let _sgOpen   = false;

// Favoritos guardados en localStorage
function _getFavoritos() {
    try { return JSON.parse(localStorage.getItem('kvs_fav_stickers') || '[]'); } catch { return []; }
}
function _setFavoritos(arr) {
    localStorage.setItem('kvs_fav_stickers', JSON.stringify(arr));
}
function toggleFavorito(emoji, e) {
    if (e) e.stopPropagation();
    const favs = _getFavoritos();
    const idx  = favs.indexOf(emoji);
    if (idx >= 0) {
        favs.splice(idx, 1);
        mostrarToast('Eliminado de favoritos');
    } else {
        favs.unshift(emoji);
        mostrarToast('⭐ Guardado en favoritos');
    }
    _setFavoritos(favs);
    // Refrescar si estamos en pestaña favoritos
    if (_sgTab === 'favoritos') renderSGPanel('favoritos');
}

function toggleStickerGiftPanel(e) {
    if (e) e.stopPropagation();
    const panel = document.getElementById('stickerGiftPanel');
    _sgOpen = !_sgOpen;
    if (_sgOpen) {
        renderSGPanel(_sgTab);
        panel.classList.add('visible');
        // Posicionar el panel dinámicamente (solo en desktop — en móvil CSS lo pone como bottom-sheet)
        const isMob = window.innerWidth <= 900 || document.documentElement.classList.contains('is-mobile');
        if (!isMob) {
            const btn = document.getElementById('btnStickerGift');
            if (btn) {
                const btnRect = btn.getBoundingClientRect();
                const panelW  = 360;
                const margin  = 8;
                // Posición horizontal: alinear con el botón, sin salirse por la derecha
                let left = btnRect.left;
                if (left + panelW + margin > window.innerWidth) {
                    left = window.innerWidth - panelW - margin;
                }
                if (left < margin) left = margin;
                // Posición vertical: encima del botón
                const panelH = Math.min(360, window.innerHeight * 0.55);
                let top = btnRect.top - panelH - 8;
                if (top < margin) top = btnRect.bottom + 8;
                panel.style.left   = left + 'px';
                panel.style.top    = top  + 'px';
                panel.style.bottom = 'auto';
                panel.style.right  = 'auto';
                panel.style.width  = panelW + 'px';
            }
        } else {
            // Mobile: bottom-sheet — el CSS lo posiciona, solo limpiar inline styles
            panel.style.left   = '';
            panel.style.top    = '';
            panel.style.bottom = '';
            panel.style.right  = '';
            panel.style.width  = '';
        }
    } else {
        panel.classList.remove('visible');
    }
}

function cerrarSGPanel() {
    _sgOpen = false;
    const panel = document.getElementById('stickerGiftPanel');
    if (panel) panel.classList.remove('visible');
}

// Cerrar el panel al hacer click fuera (en el chat, etc.)
document.addEventListener('click', (ev) => {
    if (!_sgOpen) return;
    const panel = document.getElementById('stickerGiftPanel');
    const btn   = document.getElementById('btnStickerGift');
    if (!panel) return;
    // Si el click es dentro del panel o en el botón que lo abre, no cerrar
    if (panel.contains(ev.target) || (btn && btn.contains(ev.target))) return;
    cerrarSGPanel();
});

function cambiarTabSG(tab) {
    _sgTab = tab;
    ['tabEmojis','tabFavoritos'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('active', id === 'tab' + tab.charAt(0).toUpperCase() + tab.slice(1));
    });
    renderSGPanel(tab);
}

function renderSGPanel(tab) {
    const emojiWrap = document.getElementById('sgEmojiWrap');
    const content   = document.getElementById('sgContent');
    if (!emojiWrap || !content) return;

    if (tab === 'emojis') {
        // Mostrar el wrapper del picker, ocultar el área de contenido
        emojiWrap.classList.remove('sg-hidden');
        content.style.display = 'none';
        content.innerHTML = '';
        return;
    }

    // Ocultar el picker, mostrar el área de contenido
    emojiWrap.classList.add('sg-hidden');
    content.style.display = '';

    if (tab === 'favoritos') {
        const favs = _getFavoritos();
        if (!favs.length) {
            content.innerHTML = `<div class="sg-empty"><span class="sg-empty-icon">⭐</span>Aún no tienes favoritos.<br>Pulsa ☆ sobre un emoji del picker para guardarlo aquí.</div>`;
            return;
        }
        let html = '<div class="sticker-pack-header"><span class="sticker-pack-icon">⭐</span><span>Mis favoritos</span></div><div class="sticker-grid">';
        favs.forEach(emoji => {
            html += `<button class="sticker-btn" onclick="enviarEmojiRapido('${emoji}')">
                <span style="font-size:40px;line-height:1;display:block;">${emoji}</span>
                <button class="sticker-fav-btn" onclick="toggleFavorito('${emoji}',event)" title="Quitar de favoritos">★</button>
            </button>`;
        });
        html += '</div>';
        content.innerHTML = html;
        return;
    }
}

function enviarEmojiRapido(emoji) {
    if (!currentChat || !socket) return;
    cerrarSGPanel();
    const input = document.getElementById('mensaje');
    const pos = input.selectionStart || input.value.length;
    input.value = input.value.slice(0, pos) + emoji + input.value.slice(pos);
    input.focus();
    actualizarBtnEnviar();
}


// ============================================================
// SESIÓN PERSISTENTE
// ============================================================
// ============================================================
// FEATURE: BORRAR CHAT COMPLETO
// ============================================================
function confirmarBorrarChat() {
    if (!currentChat) return;
    if (!confirm('¿Borrar toda la conversación? Los mensajes se eliminarán para todos.')) return;
    const convId = currentChat.startsWith('group_')
        ? currentChat
        : _getConversationId();
    if (!convId) return;
    socket.send(JSON.stringify({ type: 'clearConversation', conversationId: convId }));
}

function _getConversationId() {
    // Calcular el conversationId para chats 1:1 (igual que el servidor: sorted join)
    if (!currentChat || currentChat.startsWith('group_')) return currentChat;
    const otherUser = currentChat.startsWith('phone:')
        ? null
        : currentChat;
    if (!otherUser) {
        // contacto offline — conversationId lo forma el servidor con phone, no podemos calcularlo aquí
        // pero sí podemos buscar en conversations[]
        const chatKey = currentChat;
        const arr = conversations[chatKey];
        if (arr && arr.length) return arr[0].conversationId;
        return null;
    }
    const sorted = [username, otherUser].sort();
    return sorted.join('_');
}

// Handler WS: conversation_cleared
function onConversacionBorrada(conversationId) {
    // Limpiar el array local y el DOM si es el chat activo
    Object.keys(conversations).forEach(k => {
        if (conversations[k] && conversations[k][0] && conversations[k][0].conversationId === conversationId) {
            delete conversations[k];
        }
    });
    if (conversations[conversationId]) delete conversations[conversationId];
    if (currentChat) {
        const chatKey = currentChat;
        if (conversations[chatKey]) delete conversations[chatKey];
        // Limpiar DOM del chat
        chat.innerHTML = '';
        mostrarToast('Conversación borrada ✓');
    }
}

// ============================================================
// FEATURE: BUSCAR EN CHAT
// ============================================================
let _searchActive = false;
let _searchMatches = [];  // array de {row, mark} — todos los highlights encontrados
let _searchIdx = -1;      // índice del resultado actualmente resaltado en naranja

function toggleSearchBar() {
    const bar = document.getElementById('chatSearchBar');
    _searchActive = !_searchActive;
    bar.style.display = _searchActive ? 'flex' : 'none';
    document.getElementById('btnSearchChat').classList.toggle('active', _searchActive);
    if (_searchActive) {
        document.getElementById('chatSearchInput').focus();
    } else {
        document.getElementById('chatSearchInput').value = '';
        _limpiarBusqueda();
    }
}

function _limpiarBusqueda() {
    // Quitar todos los highlights del DOM de forma segura
    try {
        // Reemplazar cada <mark class="search-highlight"> con su texto
        // Hacer una snapshot del array antes de iterar (el DOM cambia al reemplazar)
        const marks = [...chat.querySelectorAll('.search-highlight')];
        marks.forEach(el => {
            try {
                const parent = el.parentNode;
                if (parent && parent.contains(el)) {
                    parent.replaceChild(document.createTextNode(el.textContent), el);
                }
            } catch(_) {}
        });
        // Normalizar los nodos de texto fusionando adyacentes
        chat.querySelectorAll('.msg-text').forEach(el => {
            try { el.normalize(); } catch(_) {}
        });
        // Quitar clases de resultado
        chat.querySelectorAll('.msg-row').forEach(r => {
            r.classList.remove('search-match');
            r.classList.remove('search-current');
        });
    } catch(err) {
        console.warn('[search] Error en _limpiarBusqueda:', err);
    }
    _searchMatches = [];
    _searchIdx = -1;
    const countEl = document.getElementById('chatSearchCount');
    if (countEl) countEl.textContent = '';
    _actualizarBotonesNavBusqueda();
}

function buscarEnChat(query) {
    _limpiarBusqueda();

    const q = (query || '').trim().toLowerCase();
    if (!q) return;

    // Buscar en todas las burbujas de texto del chat visible
    try {
        const rows = [...chat.querySelectorAll('.msg-row')];
        rows.forEach(row => {
            try {
                const bubble = row.querySelector('.bubble');
                if (!bubble || bubble.classList.contains('deleted')) return;
                const textEl = bubble.querySelector('.msg-text');
                if (!textEl) return;

                // Extraer texto puro clonando y quitando elementos decorativos
                const cloned = textEl.cloneNode(true);
                cloned.querySelectorAll(
                    '.reply-preview,.forward-label,.meta,.edited-label,.star-badge,.estado,.hora,.mention-chip'
                ).forEach(el => el.remove());
                const txt = cloned.textContent.toLowerCase();
                if (!txt.includes(q)) return;

                row.classList.add('search-match');
                // Resaltar en el DOM real — _highlightText no muta mientras itera
                const marks = _highlightText(textEl, q);
                marks.forEach(mark => _searchMatches.push({ row, mark }));
            } catch (rowErr) {
                // Si falla en una fila, continuar con las demás
                console.warn('[search] Error en fila:', rowErr);
            }
        });
    } catch(err) {
        console.error('[search] Error general:', err);
        _limpiarBusqueda();
        return;
    }

    const total = _searchMatches.length;
    const countEl = document.getElementById('chatSearchCount');
    if (total === 0) {
        if (countEl) countEl.textContent = 'Sin resultados';
        _actualizarBotonesNavBusqueda();
        return;
    }

    // Ir al primer resultado
    _searchIdx = 0;
    _resaltarActual();
    _actualizarContadorBusqueda();
    _actualizarBotonesNavBusqueda();
}

function navegarBusqueda(direccion) {
    // direccion: -1 = anterior, +1 = siguiente
    if (!_searchMatches.length) return;
    // Quitar resaltado actual
    if (_searchIdx >= 0 && _searchIdx < _searchMatches.length) {
        _searchMatches[_searchIdx].mark.classList.remove('current');
        _searchMatches[_searchIdx].row.classList.remove('search-current');
    }
    _searchIdx += direccion;
    // Wrap around
    if (_searchIdx < 0) _searchIdx = _searchMatches.length - 1;
    if (_searchIdx >= _searchMatches.length) _searchIdx = 0;
    _resaltarActual();
    _actualizarContadorBusqueda();
}

function onSearchKeydown(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        navegarBusqueda(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
        toggleSearchBar();
    }
}

function _resaltarActual() {
    if (_searchIdx < 0 || _searchIdx >= _searchMatches.length) return;
    const { row, mark } = _searchMatches[_searchIdx];
    mark.classList.add('current');
    row.classList.add('search-current');
    mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function _actualizarContadorBusqueda() {
    const countEl = document.getElementById('chatSearchCount');
    if (!countEl) return;
    const total = _searchMatches.length;
    if (total === 0) { countEl.textContent = ''; return; }
    countEl.textContent = `${_searchIdx + 1} / ${total}`;
}

function _actualizarBotonesNavBusqueda() {
    const has = _searchMatches.length > 0;
    const prev = document.getElementById('btnSearchPrev');
    const next = document.getElementById('btnSearchNext');
    if (prev) prev.style.opacity = has ? '1' : '0.35';
    if (next) next.style.opacity = has ? '1' : '0.35';
}

function _highlightText(el, query) {
    // Recorre nodos de texto y envuelve cada ocurrencia de query en <mark>.
    // IMPORTANTE: recoge TODOS los nodos de texto ANTES de mutar el DOM
    // para evitar que el TreeWalker quede en estado inválido (causa el crash).
    const marks = [];

    // Paso 1: recoger todos los nodos de texto relevantes sin tocar el DOM
    const textNodes = [];
    const stack = [el];
    while (stack.length) {
        const current = stack.pop();
        // Recorrer hijos en orden inverso para que stack los procese en orden normal
        for (let i = current.childNodes.length - 1; i >= 0; i--) {
            const child = current.childNodes[i];
            if (child.nodeType === Node.TEXT_NODE) {
                // Ignorar nodos dentro de elementos excluidos
                if (!child.parentElement.closest('.reply-preview,.forward-label,.meta,.search-highlight,.edited-label,.star-badge,.estado,.hora')) {
                    textNodes.push(child);
                }
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                // No entrar en elementos excluidos
                const tag = child.nodeName.toLowerCase();
                if (!child.classList.contains('reply-preview') &&
                    !child.classList.contains('forward-label') &&
                    !child.classList.contains('meta') &&
                    !child.classList.contains('search-highlight') &&
                    !child.classList.contains('edited-label') &&
                    !child.classList.contains('star-badge') &&
                    !child.classList.contains('estado') &&
                    !child.classList.contains('hora')) {
                    stack.push(child);
                }
            }
        }
    }

    // Paso 2: para cada nodo de texto, reemplazarlo por fragmento con marks
    textNodes.forEach(tn => {
        const parent = tn.parentNode;
        if (!parent) return;
        const txt = tn.textContent;
        const lowerTxt = txt.toLowerCase();
        if (!lowerTxt.includes(query)) return;

        // Construir un DocumentFragment que reemplaza el nodo de texto
        const frag = document.createDocumentFragment();
        let cursor = 0;
        let idx;
        while ((idx = lowerTxt.indexOf(query, cursor)) >= 0) {
            // Texto antes del match
            if (idx > cursor) {
                frag.appendChild(document.createTextNode(txt.slice(cursor, idx)));
            }
            // El match envuelto en <mark>
            const mark = document.createElement('mark');
            mark.className = 'search-highlight';
            mark.textContent = txt.slice(idx, idx + query.length);
            frag.appendChild(mark);
            marks.push(mark);
            cursor = idx + query.length;
        }
        // Texto después del último match
        if (cursor < txt.length) {
            frag.appendChild(document.createTextNode(txt.slice(cursor)));
        }
        // Reemplazar el nodo de texto original con el fragmento
        parent.replaceChild(frag, tn);
    });

    return marks;
}

// ============================================================
// FEATURE: MENCIONES @USUARIO EN GRUPOS
// ============================================================
let _mentionQuery = '';
let _mentionStart = -1;
let _mentionSelectedIdx = 0;
// _mentionItems: array de { displayName, username, isAll, avatar }
let _mentionItems = [];

function _onInputMention() {
    // Solo activo en chats de grupo
    if (!currentChat || !currentChat.startsWith('group_')) {
        _cerrarMentionList();
        return;
    }
    const val = input.value;
    // Usar selectionStart con fallback a longitud del texto
    const pos = (input.selectionStart != null) ? input.selectionStart : val.length;
    const before = val.slice(0, pos);

    // Detectar patrón @texto desde el cursor hacia atrás
    // Acepta @  solo (sin texto después) o @letras
    const match = before.match(/@([^\s@]*)$/);
    if (match) {
        _mentionQuery = match[1].toLowerCase();
        _mentionStart = pos - match[0].length;
        _mostrarMentionList();
    } else {
        _cerrarMentionList();
    }
}

function _posicionarMentionList() {
    const list = document.getElementById('mentionList');
    const textarea = document.getElementById('mensaje');
    if (!list || !textarea) return;

    const inputArea = textarea.closest('.input-area') || textarea.parentElement;
    const ref = inputArea || textarea;
    const rect = ref.getBoundingClientRect();

    // Posicionar: pegado al borde izquierdo y derecho de la input-area,
    // su borde inferior alineado con el borde superior de la input-area.
    list.style.left   = rect.left + 'px';
    list.style.right  = (window.innerWidth - rect.right) + 'px';
    list.style.bottom = (window.innerHeight - rect.top) + 'px';
    list.style.width  = '';  // ancho lo controlan left+right
}

function _mostrarMentionList() {
    const groupId = currentChat.replace('group_', '');
    const grp = myGroups.get(groupId);
    if (!grp) { _cerrarMentionList(); return; }

    // Construir lista de candidatos: primero "todos", luego miembros
    const candidates = [];

    // Opción especial: mencionar a todos
    const todoItem = { displayName: 'Todos', username: 'todos', isAll: true, isTodos: true,
        avatar: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="20" fill="#ef4444"/><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-size="18" fill="white">👥</text></svg>') };

    // Miembros del grupo — incluir a todos los miembros excepto al propio usuario.
    // Si _phoneToUsername no tiene el phone todavía (miembro offline al cargar),
    // usamos el username del contacto o un placeholder, para que siempre aparezcan.
    const memberItems = grp.members
        .map(phone => {
            // 1. Buscar username en el mapa de usuarios online
            let uname = (window._phoneToUsername && window._phoneToUsername[phone]) || null;
            // 2. Si no está en el mapa online, intentar obtenerlo del contacto (tiene .username del servidor)
            const contact = myContacts.get(phone);
            if (!uname && contact && contact.username) uname = contact.username;
            // 3. Nombre a mostrar: nombre personalizado del contacto > username > teléfono
            const displayName = (contact && contact.customName) || uname || phone;
            // 4. Avatar: preferir el online, luego el del contacto, luego dicebear
            const av = (uname && userAvatars[uname])
                || (contact && contact.avatar)
                || userAvatars['__phone__' + phone]
                || ('https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(displayName));
            // mentionValue = lo que se inserta al mencionar:
            //   si tenemos username real → @username
            //   si solo tenemos phone → @displayName (sin espacios)
            const mentionValue = uname || displayName.replace(/\s+/g, '_');
            return { phone, username: mentionValue, displayName, isAll: false, avatar: av };
        })
        // Excluir solo al propio usuario (por phone O por username)
        .filter(m => m.phone !== loginPhone && m.username !== username);

    // Filtrar por query
    const q = _mentionQuery;
    const filterFn = (m) => {
        if (!q) return true;
        if (m.isAll) return 'todos'.startsWith(q) || q === 'all';
        return m.displayName.toLowerCase().includes(q) || m.username.toLowerCase().includes(q);
    };

    if (!q || 'todos'.startsWith(q) || q === 'all') candidates.push(todoItem);
    memberItems.filter(filterFn).forEach(m => candidates.push(m));

    const list = document.getElementById('mentionList');
    if (!candidates.length) { _cerrarMentionList(); return; }

    _mentionItems = candidates;
    _mentionSelectedIdx = 0;

    // Construir HTML usando DOM (no template strings con quotes) para evitar escapes rotos
    const frag = document.createDocumentFragment();

    // Encabezado
    const header = document.createElement('div');
    header.className = 'mention-header';
    header.textContent = 'Mencionar';
    frag.appendChild(header);

    candidates.forEach((m, i) => {
        const item = document.createElement('div');
        item.className = 'mention-item' + (i === 0 ? ' selected' : '') + (m.isTodos ? ' todos-item' : '');
        item.dataset.idx = i;

        const img = document.createElement('img');
        img.src = m.avatar;
        img.alt = m.displayName;
        img.onerror = function() {
            this.src = 'https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(m.displayName);
        };

        const info = document.createElement('div');
        info.className = 'mention-item-info';

        const nameEl = document.createElement('div');
        nameEl.className = 'mention-item-name';
        nameEl.textContent = m.displayName;

        const handleEl = document.createElement('div');
        handleEl.className = 'mention-item-handle';
        handleEl.textContent = '@' + m.username;

        info.appendChild(nameEl);
        info.appendChild(handleEl);
        item.appendChild(img);
        item.appendChild(info);

        // Guardar referencia al username en dataset para evitar problemas con quotes
        item.dataset.username = m.username;
        item.addEventListener('click', function(e) {
            e.stopPropagation();
            seleccionarMencion(this.dataset.username);
        });

        frag.appendChild(item);
    });

    list.innerHTML = '';
    list.appendChild(frag);

    // Posicionar el mentionList justo encima del textarea, en coordenadas fixed
    _posicionarMentionList();

    list.className = 'visible';
}

function _cerrarMentionList() {
    const list = document.getElementById('mentionList');
    if (!list) return;
    list.className = '';
    list.innerHTML = '';
    _mentionQuery = '';
    _mentionStart = -1;
    _mentionItems = [];
}

function seleccionarMencion(mentionUsername) {
    if (!mentionUsername) return;
    const val = input.value;
    // Recalcular la posición del cursor en el momento de seleccionar
    const pos = (input.selectionStart != null) ? input.selectionStart : val.length;
    const before = val.slice(0, _mentionStart);
    // "after" comienza desde donde estaba el cursor (no desde _mentionStart)
    const after = val.slice(pos);
    const inserted = '@' + mentionUsername + '\u00a0'; // non-breaking space tras la mención
    input.value = before + inserted + after;
    const newCursor = before.length + inserted.length;
    input.selectionStart = input.selectionEnd = newCursor;
    input.focus();
    actualizarBtnEnviar();
    _cerrarMentionList();
}

function _onKeydownMention(e) {
    const list = document.getElementById('mentionList');
    if (!list || !list.classList.contains('visible')) return;
    const items = [...list.querySelectorAll('.mention-item')];
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        _mentionSelectedIdx = (_mentionSelectedIdx + 1) % items.length;
        items.forEach((it, i) => it.classList.toggle('selected', i === _mentionSelectedIdx));
        items[_mentionSelectedIdx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        _mentionSelectedIdx = (_mentionSelectedIdx - 1 + items.length) % items.length;
        items.forEach((it, i) => it.classList.toggle('selected', i === _mentionSelectedIdx));
        items[_mentionSelectedIdx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (_mentionItems.length > 0 && _mentionItems[_mentionSelectedIdx]) {
            e.preventDefault();
            seleccionarMencion(_mentionItems[_mentionSelectedIdx].username);
        }
    } else if (e.key === 'Escape') {
        e.preventDefault();
        _cerrarMentionList();
    }
}

// ============================================================
// AUTORIZACIÓN DE NUEVA SESIÓN (multi-dispositivo)
// ============================================================

// Variables para el flujo de sesión pendiente
let _sessionWaitingWs = null; // socket temporal mientras se espera aprobación

// Mostrado en el dispositivo ACTIVO: alguien quiere entrar con tu número
function mostrarModalAutorizacionSesion(reqId, reqUsername, deviceInfo) {
    const modal = document.getElementById('sessionAuthModal');
    if (!modal) return;
    document.getElementById('sessionAuthUsername').textContent  = reqUsername  || 'Alguien';
    document.getElementById('sessionAuthDevice').textContent    = deviceInfo   || 'Dispositivo desconocido';
    modal.dataset.reqId = reqId;
    modal.classList.add('visible');
    // Auto-rechazar tras 60 s (igual que el server timeout)
    if (window._sessionAuthTimeout) clearTimeout(window._sessionAuthTimeout);
    window._sessionAuthTimeout = setTimeout(() => {
        cerrarModalAutorizacionSesion();
    }, 60000);
}

function cerrarModalAutorizacionSesion() {
    const modal = document.getElementById('sessionAuthModal');
    if (modal) modal.classList.remove('visible');
    if (window._sessionAuthTimeout) { clearTimeout(window._sessionAuthTimeout); window._sessionAuthTimeout = null; }
}

function responderSolicitudSesion(accepted) {
    const modal = document.getElementById('sessionAuthModal');
    if (!modal) return;
    const reqId = modal.dataset.reqId;
    cerrarModalAutorizacionSesion();
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: 'session_auth_response', reqId, accepted }));
    if (!accepted) mostrarToast('Acceso denegado al otro dispositivo 🔒');
}

// Mostrado en el dispositivo NUEVO: esperando que el activo responda
function mostrarPantallaEsperandoAprobacion(msg) {
    // Ocultar login modal y mostrar la pantalla de espera
    const loginModal = document.getElementById('loginModal');
    const waitScreen = document.getElementById('sessionWaitScreen');
    if (loginModal) loginModal.style.display = 'none';
    if (waitScreen) {
        document.getElementById('sessionWaitMsg').textContent = msg || 'Esperando autorización…';
        waitScreen.style.display = 'flex';
    }
}

function ocultarPantallaEsperandoAprobacion() {
    const waitScreen = document.getElementById('sessionWaitScreen');
    if (waitScreen) waitScreen.style.display = 'none';
}

function mostrarErrorSesionRechazada(msg) {
    const loginModal = document.getElementById('loginModal');
    if (loginModal) loginModal.style.display = 'flex';
    // Volver al paso 1 del login
    document.querySelectorAll('.login-step').forEach(s => s.classList.remove('active'));
    const step1 = document.getElementById('step1');
    if (step1) step1.classList.add('active');
    document.querySelectorAll('.step-dot').forEach((d, i) => d.classList.toggle('active', i === 0));
    // Mostrar mensaje de error
    const errEl = document.getElementById('phoneError');
    if (errEl) errEl.textContent = msg || 'Acceso denegado por el dispositivo activo.';
    mostrarToast('⛔ ' + (msg || 'Sesión rechazada'), true);
    // Limpiar la sesión que se intentó
    if (socket) { socket.onclose = null; socket.onerror = null; try { socket.close(); } catch(_) {} socket = null; }
    loginPhone = null; loginUsername = null;
}

function completarLoginTrasSesionAprobada() {
    // Ocultar login modal y mostrar la app — el socket ya está conectado y el join fue completado por el servidor
    ocultarPantallaEsperandoAprobacion();
    const loginModal = document.getElementById('loginModal');
    const appContainer = document.getElementById('appContainer');
    if (loginModal) loginModal.style.display = 'none';
    if (appContainer) appContainer.style.display = 'flex';
    _mostrarWelcomePanel(true);
    const sessionData = JSON.stringify({ phone: loginPhone, username: loginUsername });
    localStorage.setItem('kvs_session', sessionData);
    // Actualizar UI del sidebar
    document.getElementById('myName').textContent  = loginUsername;
    document.getElementById('myPhone').textContent = formatearTelefono(loginPhone);
    document.getElementById('myAvatar').src        = myAvatarDataUrl;
    // Cargar contactos, grupos y configuración
    cargarContactos();
    cargarGrupos();
    cargarConfiguracionUsuario();
    _suscribirAPush().catch(() => {});
    mostrarToast('✅ Sesión autorizada');
}

function cancelarEsperaSession() {
    ocultarPantallaEsperandoAprobacion();
    // Cerrar el socket en espera y volver al login
    if (socket) { socket.onclose = null; socket.onerror = null; try { socket.close(); } catch(_) {} socket = null; }
    // Limpiar sesión del localStorage para que al recargar no intente reconectar
    localStorage.removeItem('kvs_session');
    loginPhone = ''; loginUsername = '';
    username = null; conectado = false;
    const loginModal = document.getElementById('loginModal');
    if (loginModal) loginModal.style.display = 'flex';
    goToStep(1);
}

// ============================================================
// RGPD / PRIVACIDAD
// ============================================================
function abrirModalRGPD() {
    const modal = document.getElementById('rgpdModal');
    if (modal) modal.classList.add('visible');
}

function cerrarModalRGPD() {
    const modal = document.getElementById('rgpdModal');
    if (modal) modal.classList.remove('visible');
}

async function solicitarExportacionDatos() {
    if (!loginPhone) return;
    try {
        const res = await fetch('/api/gdpr/export?phone=' + encodeURIComponent(loginPhone));
        if (!res.ok) throw new Error('Error al exportar');
        const data = await res.json();
        // Descargar como JSON
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = 'mis-datos-kivoospace.json';
        a.click();
        URL.revokeObjectURL(url);
        mostrarToast('📥 Datos exportados correctamente');
    } catch(e) {
        mostrarToast('⚠️ Error al exportar datos: ' + e.message, true);
    }
}

async function solicitarEliminarCuenta() {
    const confirmado = confirm(
        '⚠️ ELIMINAR CUENTA\n\n' +
        'Esta acción eliminará permanentemente:\n' +
        '• Tu perfil y número de teléfono\n' +
        '• Todos tus mensajes enviados\n' +
        '• Tus contactos y grupos\n\n' +
        '¿Estás seguro? Esta acción no se puede deshacer.'
    );
    if (!confirmado) return;
    const confirmado2 = confirm('Confirmación final: ¿seguro que quieres eliminar tu cuenta de kiVooSpace?');
    if (!confirmado2) return;
    try {
        const res = await fetch('/api/gdpr/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: loginPhone })
        });
        if (!res.ok) throw new Error('Error al eliminar la cuenta');
        mostrarToast('✅ Cuenta eliminada. Hasta pronto.');
        setTimeout(() => { cerrarModalRGPD(); logout(); }, 2000);
    } catch(e) {
        mostrarToast('⚠️ Error al eliminar la cuenta: ' + e.message, true);
    }
}



let _autoDestructSettings = {}; // conversationId → seconds

function abrirMenuAutoDestruct() {
    if (!currentChat) return;
    const menu = document.getElementById('autoDestructMenu');
    const isOpen = menu.style.display === 'block';
    // Cerrar otros menus abiertos
    document.getElementById('autoDestructMenu').style.display = isOpen ? 'none' : 'block';
    if (!isOpen) {
        // Cerrar al hacer click fuera
        setTimeout(() => {
            document.addEventListener('click', function _closeAD(e) {
                if (!e.target.closest('#autoDestructMenu') && !e.target.closest('#btnAutoDestruct')) {
                    document.getElementById('autoDestructMenu').style.display = 'none';
                    document.removeEventListener('click', _closeAD);
                }
            });
        }, 50);
    }
}

function setAutoDestruct(seconds) {
    if (!currentChat) return;
    document.getElementById('autoDestructMenu').style.display = 'none';
    const convId = _getConversationId() || currentChat;
    socket.send(JSON.stringify({ type: 'setAutoDestruct', conversationId: convId, seconds }));
}

function _onAutoDestructSet(convId, seconds) {
    _autoDestructSettings[convId] = seconds;
    const btn = document.getElementById('btnAutoDestruct');
    if (btn) btn.classList.toggle('active', seconds > 0);
    const label = seconds === 0 ? '' : seconds < 3600 ? `⏱️ ${seconds/60}min`
        : seconds < 86400 ? `⏱️ ${seconds/3600}h` : `⏱️ ${seconds/86400}d`;
    mostrarToast(seconds === 0 ? 'Mensajes temporales desactivados' : `Mensajes temporales: ${label} ✓`);
}

// Actualizar indicador de autodestrucción al abrir un chat
function _actualizarBtnAutoDestruct() {
    const convId = _getConversationId() || currentChat;
    const secs = convId ? (_autoDestructSettings[convId] || 0) : 0;
    const btn = document.getElementById('btnAutoDestruct');
    if (btn) btn.classList.toggle('active', secs > 0);
}

// ============================================================
// FEATURE: ARCHIVAR CONVERSACIONES
// ============================================================
let _archivedChats = new Set();

function toggleArchivarChat() {
    if (!currentChat) return;
    const convId = currentChat;
    const isArchived = _archivedChats.has(convId);
    socket.send(JSON.stringify({ type: 'archiveChat', conversationId: convId, archive: !isArchived }));
}

function _onChatArchivado(convId, archived) {
    if (archived) {
        _archivedChats.add(convId);
        mostrarToast('Conversación archivada 📁');
    } else {
        _archivedChats.delete(convId);
        mostrarToast('Conversación desarchivada ✓');
    }
    document.getElementById('btnArchiveChat').classList.toggle('active', _archivedChats.has(currentChat));
    renderArchivedList();
    renderContactsList();
    renderGroupsList();
}

function toggleArchivedSection() {
    const list = document.getElementById('archivedList');
    list.classList.toggle('visible');
}

function renderArchivedList() {
    const ul = document.getElementById('archivedList');
    if (!ul) return;
    const count = document.getElementById('archivedCount');

    if (_archivedChats.size === 0) {
        ul.innerHTML = '';
        if (count) count.textContent = '';
        return;
    }
    if (count) count.textContent = _archivedChats.size;

    const items = [..._archivedChats].map(convId => {
        let name = convId, avatarHtml = '', clickFn = '';
        if (convId.startsWith('group_')) {
            const gid = convId.replace('group_', '');
            const g = myGroups.get(gid);
            name = g ? g.name : gid;
            avatarHtml = `<div class="group-avatar-circle" style="width:36px;height:36px;font-size:14px;">${g && g.avatar ? `<img src="${g.avatar}" alt="">` : name.charAt(0).toUpperCase()}</div>`;
            clickFn = `seleccionarGrupo('${gid}')`;
        } else {
            const contact = myContacts.get(convId) || null;
            const uname = window._phoneToUsername ? window._phoneToUsername[convId] : convId;
            name = contact ? contact.customName : (uname || convId);
            const av = (contact && contact.avatar) || userAvatars[uname] || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name)}`;
            avatarHtml = `<img class="user-avatar" src="${av}" alt="${escapeHTML(name)}" style="width:36px;height:36px;border-radius:50%;">`;
            clickFn = uname && uname !== convId ? `seleccionarUsuario('${uname.replace(/'/g,"\'")}')` : `seleccionarContactoOffline('${convId.replace(/'/g,"\'")}')`;
        }
        return `<li style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:var(--radius-md);cursor:pointer;transition:background var(--transition);" onclick="${clickFn}" onmouseover="this.style.background='var(--purple-pale)'" onmouseout="this.style.background=''">
            ${avatarHtml}
            <div class="user-info"><div class="user-name">${escapeHTML(name)}</div><div class="user-preview" style="font-size:11px;color:var(--text-muted);">📁 Archivada</div></div>
        </li>`;
    }).join('');
    ul.innerHTML = items;
}

// ============================================================
// CARGAR CONFIGURACIÓN DE USUARIO AL INICIAR SESIÓN
// ============================================================
async function cargarConfiguracionUsuario() {
    if (!loginPhone) return;
    try {
        const res = await fetch(`/api/user/settings?phone=${encodeURIComponent(loginPhone)}`);
        if (!res.ok) return;
        const cfg = await res.json();
        // Archivar chats
        _archivedChats = new Set(cfg.archivedChats || []);
        renderArchivedList();
        // Autodestrucción
        _autoDestructSettings = cfg.autoDestructSettings || {};
    } catch(e) { console.warn('cargarConfiguracionUsuario error:', e); }
}

(function tryAutoLogin() {
    const saved = localStorage.getItem('kvs_session')
        || localStorage.getItem('kvs_session_pwa')
        || sessionStorage.getItem('kvs_session');
    if (!saved) return;
    try {
        const s = JSON.parse(saved);
        if (!s.phone || !s.username) return;
        loginPhone    = s.phone;
        loginUsername = s.username;
        if (!localStorage.getItem('kvs_session')) {
            localStorage.setItem('kvs_session', saved);
        }
        localStorage.removeItem('kvs_session_pwa');
        sessionStorage.removeItem('kvs_session');
        const savedAvatar = localStorage.getItem(`kvs_avatar_${loginPhone}`);
        myAvatarDataUrl = savedAvatar || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(loginUsername)}`;
        document.getElementById('loginModal').style.display  = 'none';
        document.getElementById('appContainer').style.display = 'flex';
        _mostrarWelcomePanel(true);
        document.getElementById('myName').textContent   = loginUsername;
        document.getElementById('myPhone').textContent  = formatearTelefono(loginPhone);
        document.getElementById('myAvatar').src         = myAvatarDataUrl;
        fetch(`/api/user?phone=${encodeURIComponent(loginPhone)}`)
            .then(r => r.ok ? r.json() : null)
            .then(userData => {
                if (userData && userData.avatar && userData.avatar.startsWith('data:image/')) {
                    myAvatarDataUrl = userData.avatar;
                    localStorage.setItem(`kvs_avatar_${loginPhone}`, myAvatarDataUrl);
                    document.getElementById('myAvatar').src = myAvatarDataUrl;
                }
            })
            .catch(() => {});
        conectarWS();
    } catch(e) {
        localStorage.removeItem('kvs_session');
        localStorage.removeItem('kvs_session_pwa');
        sessionStorage.removeItem('kvs_session');
    }
})();

// ============================================================
// HELPER: detectar si se ejecuta como PWA instalada
// ============================================================
function esPWA() {
    return window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true
        || document.referrer.startsWith('android-app://');
}

// ============================================================
// AJUSTES MODAL (JS)
// ============================================================
function abrirAjustes() {
    document.getElementById('settingsAvatar').src        = myAvatarDataUrl || '';
    document.getElementById('settingsName').textContent  = loginUsername || '';
    document.getElementById('settingsPhone').textContent = formatearTelefono(loginPhone) || '';

    ocultarConfirmLogout();
    document.getElementById('settingsModal').classList.add('open');
}
function cerrarAjustes() {
    document.getElementById('settingsModal').classList.remove('open');
    ocultarConfirmLogout();
}
function cerrarAjustesOutside(e) {
    if (e.target === document.getElementById('settingsModal')) cerrarAjustes();
}
function mostrarConfirmLogout()  { document.getElementById('logoutConfirmBox').classList.add('open'); }
function ocultarConfirmLogout()  { document.getElementById('logoutConfirmBox').classList.remove('open'); }
function logoutConfirmado() { cerrarAjustes(); logout(); }

// ============================================================
// MODO OSCURO
// ============================================================
let _darkMode = false;

function _initDarkMode() {
    const saved = localStorage.getItem('kvs_dark_mode');
    if (saved === '1') _darkMode = true;
    else if (saved === '0') _darkMode = false;
    else _darkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
    _aplicarDarkMode(false);
}

function toggleDarkMode() {
    _darkMode = !_darkMode;
    localStorage.setItem('kvs_dark_mode', _darkMode ? '1' : '0');
    _aplicarDarkMode(true);
}

function _aplicarDarkMode(animate) {
    if (animate) document.documentElement.style.transition = 'background .25s,color .25s';
    document.documentElement.classList.toggle('dark', _darkMode);
    if (animate) setTimeout(() => document.documentElement.style.transition = '', 300);
    const icon  = document.getElementById('darkModeIcon');
    const label = document.getElementById('darkModeLabel');
    if (icon)  icon.textContent  = _darkMode ? '☀️' : '🌙';
    if (label) label.textContent = _darkMode ? 'Modo claro' : 'Modo oscuro';
}

_initDarkMode();

// ============================================================
// SONIDOS PERSONALIZABLES
// ============================================================
const _SOUNDS = [
    { id: 'default', label: '🎵 Clásico' },
    { id: 'soft',    label: '🎶 Suave'   },
    { id: 'ping',    label: '🔔 Ping'    },
    { id: 'pop',     label: '🫧 Pop'     },
];
let _selectedSound = localStorage.getItem('kvs_notif_sound') || 'default';

function _playSound(id) {
    try {
        const ctx  = new (window.AudioContext || window.webkitAudioContext)();
        const gain = ctx.createGain();
        gain.connect(ctx.destination);
        if (id === 'soft') {
            const osc = ctx.createOscillator();
            osc.connect(gain); osc.type = 'sine';
            osc.frequency.setValueAtTime(520, ctx.currentTime);
            osc.frequency.linearRampToValueAtTime(620, ctx.currentTime + 0.08);
            osc.frequency.linearRampToValueAtTime(520, ctx.currentTime + 0.2);
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
            osc.start(); osc.stop(ctx.currentTime + 0.45);
        } else if (id === 'ping') {
            const osc = ctx.createOscillator();
            osc.connect(gain); osc.type = 'triangle';
            osc.frequency.setValueAtTime(1200, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.06);
            gain.gain.setValueAtTime(0.3, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
            osc.start(); osc.stop(ctx.currentTime + 0.28);
        } else if (id === 'pop') {
            const buf  = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.06), ctx.sampleRate);
            const data = buf.getChannelData(0);
            for (let i = 0; i < data.length; i++) data[i] = (Math.random()*2-1)*(1-i/data.length);
            const src  = ctx.createBufferSource();
            src.buffer = buf;
            const f = ctx.createBiquadFilter();
            f.type = 'bandpass'; f.frequency.value = 1000;
            src.connect(f); f.connect(gain);
            gain.gain.setValueAtTime(0.4, ctx.currentTime);
            src.start(); src.stop(ctx.currentTime + 0.06);
        } else { // default
            const osc = ctx.createOscillator();
            osc.connect(gain); osc.type = 'sine';
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.12);
            gain.gain.setValueAtTime(0.25, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
            osc.start(); osc.stop(ctx.currentTime + 0.3);
        }
    } catch(_) {}
}

// Reemplazar playNotifSound con la versión personalizable
function playNotifSound() { _playSound(_selectedSound); }

function abrirSelectorSonido() {
    const modal = document.getElementById('soundPickerModal');
    const list  = document.getElementById('soundOptionsList');
    if (!modal || !list) return;
    list.innerHTML = '';
    _SOUNDS.forEach(s => {
        const btn = document.createElement('button');
        btn.className = 'sound-option' + (s.id === _selectedSound ? ' active' : '');
        btn.innerHTML = s.label + '<span class="sound-check">✓</span>';
        btn.onclick = () => {
            _selectedSound = s.id;
            localStorage.setItem('kvs_notif_sound', s.id);
            list.querySelectorAll('.sound-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            _playSound(s.id);
        };
        list.appendChild(btn);
    });
    modal.style.display = 'flex';
}
function cerrarSelectorSonido() {
    const m = document.getElementById('soundPickerModal');
    if (m) m.style.display = 'none';
}

// ============================================================
// INDICADOR "GRABANDO AUDIO"
// ============================================================
function _enviarEstadoGrabacion(status) {
    if (!currentChat || currentChat.startsWith('group_') || currentChat.startsWith('phone:')) return;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: 'recording', to: currentChat, status }));
}

// ============================================================
// PREVISUALIZACIÓN DE ENLACES
// ============================================================
const _linkCache = {}; // url → data | null

function _firstURL(text) {
    if (!text) return null;
    const m = text.match(/https?:\/\/[^\s<>"']+/);
    return m ? m[0] : null;
}

async function _fetchPreview(url) {
    if (url in _linkCache) return _linkCache[url];
    try {
        const r = await fetch('/api/link-preview?url=' + encodeURIComponent(url));
        const d = r.ok ? await r.json() : null;
        _linkCache[url] = d;
        return d;
    } catch(_) { _linkCache[url] = null; return null; }
}

async function _adjuntarLinkPreview(bubble, text) {
    const url = _firstURL(text);
    if (!url) return;
    if (bubble.querySelector('.link-preview-card')) return;
    const prev = await _fetchPreview(url);
    if (!prev || !prev.title) return;
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.className = 'link-preview-card';
    let inner = '';
    if (prev.image) inner += '<img class="link-preview-img" src="' + escapeHTML(prev.image) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">';
    inner += '<div class="link-preview-body">';
    inner += '<div class="link-preview-domain">' + escapeHTML(prev.domain || '') + '</div>';
    inner += '<div class="link-preview-title">'  + escapeHTML(prev.title)        + '</div>';
    if (prev.description) inner += '<div class="link-preview-desc">' + escapeHTML(prev.description) + '</div>';
    inner += '</div>';
    a.innerHTML = inner;
    const meta = bubble.querySelector('.meta');
    if (meta) meta.before(a); else bubble.appendChild(a);
}

// ============================================================
// CONFIRMACIÓN DE LECTURA GRANULAR EN GRUPOS
// ============================================================
const _groupReadData = {}; // msgId → Set of usernames

function _registrarGrupoLectura(msgId, reader) {
    if (!_groupReadData[msgId]) _groupReadData[msgId] = new Set();
    _groupReadData[msgId].add(reader);
    // Actualizar el botón de tick en la burbuja del remitente
    if (currentChat && currentChat.startsWith('group_')) {
        const bubble = document.getElementById(msgId);
        if (bubble) {
            const readBtn = bubble.querySelector('.btn-group-read');
            if (readBtn) {
                const chatKey = currentChat;
                const grp = myGroups.get(chatKey.replace('group_', ''));
                const total = grp ? grp.members.length - 1 : 0; // -1 para excluir al remitente
                const readCount = _groupReadData[msgId] ? _groupReadData[msgId].size : 0;
                readBtn.textContent = readCount >= total ? '✔✔' : '✔';
                readBtn.style.color = readCount >= total ? 'var(--online)' : 'rgba(255,255,255,0.6)';
            }
        }
    }
}

function mostrarLecturaGrupo(msgId) {
    const existing = document.getElementById('readReceiptPopover');
    if (existing) {
        if (existing.dataset.formsgid === msgId) { existing.remove(); return; }
        existing.remove();
    }
    const row = document.querySelector('[data-msgid="' + msgId + '"]');
    if (!row) return;
    const bubbleWrap = row.querySelector('.bubble-wrap');
    if (!bubbleWrap) return;
    if (!currentChat || !currentChat.startsWith('group_')) return;
    const grp = myGroups.get(currentChat.replace('group_', ''));
    if (!grp) return;

    const readBy  = _groupReadData[msgId] ? [..._groupReadData[msgId]].filter(u => u !== username) : [];
    const allOthers = grp.members
        .map(p => (window._phoneToUsername && window._phoneToUsername[p]) || null)
        .filter(u => u && u !== username);
    const pending = allOthers.filter(u => !readBy.includes(u));

    const pop = document.createElement('div');
    pop.className = 'read-receipt-popover';
    pop.id = 'readReceiptPopover';
    pop.dataset.formsgid = msgId;
    pop.style.cssText = 'position:absolute;right:0;bottom:calc(100% + 6px);z-index:800;';

    let html = '<div class="rr-title">Visto por</div>';
    if (readBy.length) {
        html += '<div class="rr-section"><div class="rr-label" style="color:var(--online)">✔✔ Leído (' + readBy.length + ')</div>';
        html += '<div class="rr-names">' + readBy.map(u => escapeHTML(u)).join(', ') + '</div></div>';
    }
    if (pending.length) {
        html += '<div class="rr-section"><div class="rr-label" style="color:var(--text-muted)">⏳ Pendiente (' + pending.length + ')</div>';
        html += '<div class="rr-names">' + pending.map(u => escapeHTML(u)).join(', ') + '</div></div>';
    }
    if (!readBy.length && !pending.length) {
        html += '<div style="color:var(--text-muted);font-size:12px;">Sin datos aún</div>';
    }
    pop.innerHTML = html;
    bubbleWrap.style.position = 'relative';
    bubbleWrap.appendChild(pop);
    setTimeout(() => {
        const close = (e) => { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('click', close, true); } };
        document.addEventListener('click', close, true);
    }, 50);
}

// ============================================================
// MENÚ "MÁS OPCIONES" EN MÓVIL (botón ⋯ del header)
// ============================================================
function toggleMoreActionsMenu(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('moreActionsMenu');
    if (!menu) return;
    const isOpen = menu.style.display !== 'none';
    menu.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) {
        setTimeout(() => {
            const close = (ev) => {
                if (!menu.contains(ev.target)) {
                    menu.style.display = 'none';
                    document.removeEventListener('click', close, true);
                }
            };
            document.addEventListener('click', close, true);
        }, 10);
    }
}
function closeMoreActionsMenu() {
    const menu = document.getElementById('moreActionsMenu');
    if (menu) menu.style.display = 'none';
}

// ============================================================
// BANNER OFFLINE
// ============================================================
function _mostrarBannerOffline(visible) {
    const banner = document.getElementById('offlineBanner');
    if (!banner) return;
    banner.style.display = visible ? 'flex' : 'none';
}

// ============================================================
// SCROLL-TO-BOTTOM BUTTON
// ============================================================
(function _initScrollBtn() {
    document.addEventListener('DOMContentLoaded', () => {
        const chatEl = document.getElementById('chat');
        const btn    = document.getElementById('btnScrollBottom');
        const badge  = document.getElementById('btnScrollBottomBadge');
        if (!chatEl || !btn) return;

        let _newMsgsWhileAway = 0;

        chatEl.addEventListener('scroll', () => {
            const distFromBottom = chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight;
            const show = distFromBottom > 120;
            btn.style.display = show ? 'flex' : 'none';
            if (!show) {
                _newMsgsWhileAway = 0;
                if (badge) { badge.style.display = 'none'; badge.textContent = ''; }
            }
        });

        // Exponer para que addMessage/addGroupMessage incremente el contador
        window._scrollBtnNewMsg = function() {
            const distFromBottom = chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight;
            if (distFromBottom > 120) {
                _newMsgsWhileAway++;
                if (badge) {
                    badge.textContent = _newMsgsWhileAway > 99 ? '99+' : _newMsgsWhileAway;
                    badge.style.display = 'block';
                }
                btn.style.display = 'flex';
            }
        };
    });
})();

// ============================================================
// LONGPRESS EN MÓVIL → menú contextual (500ms)
// ============================================================
(function _initLongpress() {
    document.addEventListener('DOMContentLoaded', () => {
        let _lpTimer = null;
        const THRESHOLD = 500;

        document.addEventListener('touchstart', (e) => {
            const bubble = e.target.closest('.bubble:not(.deleted)');
            if (!bubble) return;
            _lpTimer = setTimeout(() => {
                if (navigator.vibrate) navigator.vibrate(30);
                bubble.click();
                _lpTimer = null;
            }, THRESHOLD);
        }, { passive: true });

        document.addEventListener('touchend',  () => { if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; } }, { passive: true });
        document.addEventListener('touchmove', () => { if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; } }, { passive: true });
    });
})();

// ============================================================
// SWIPE-TO-REPLY EN MÓVIL
// ============================================================
(function _initSwipeReply() {
    document.addEventListener('DOMContentLoaded', () => {
        const chatEl = document.getElementById('chat');
        if (!chatEl) return;

        let _swStart = null, _swRow = null, _swBubbleWrap = null, _swTriggered = false;
        const SWIPE_THRESHOLD = 60;

        chatEl.addEventListener('touchstart', (e) => {
            const row = e.target.closest('.msg-row');
            if (!row || row.closest('#threadMessages')) return;
            if (row.querySelector('.bubble.deleted')) return;
            _swRow = row;
            _swBubbleWrap = row.querySelector('.bubble-wrap');
            _swStart = e.touches[0].clientX;
            _swTriggered = false;
        }, { passive: true });

        chatEl.addEventListener('touchmove', (e) => {
            if (!_swRow || _swStart === null) return;
            const dx   = e.touches[0].clientX - _swStart;
            const isMe = _swRow.classList.contains('me');
            const validDir = isMe ? dx < -20 : dx > 20;
            if (!validDir) return;
            const clamp = isMe ? Math.max(dx, -SWIPE_THRESHOLD * 1.2) : Math.min(dx, SWIPE_THRESHOLD * 1.2);
            if (_swBubbleWrap) {
                _swBubbleWrap.style.transition = 'none';
                _swBubbleWrap.style.transform  = `translateX(${clamp}px)`;
            }
            if (Math.abs(dx) >= SWIPE_THRESHOLD && !_swTriggered) {
                _swTriggered = true;
                if (navigator.vibrate) navigator.vibrate(18);
            }
        }, { passive: true });

        chatEl.addEventListener('touchend', () => {
            if (_swBubbleWrap) {
                _swBubbleWrap.style.transition = 'transform .2s cubic-bezier(.4,0,.2,1)';
                _swBubbleWrap.style.transform  = '';
            }
            if (_swTriggered && _swRow) {
                const bubble = _swRow.querySelector('.bubble');
                if (bubble && bubble.id) {
                    const msgId   = bubble.id;
                    const textEl  = _swRow.querySelector('.msg-text');
                    const msgText = textEl ? textEl.textContent.trim() : '';
                    const fromEl  = _swRow.querySelector('[style*="color:var(--purple-deep)"]');
                    const fromName = fromEl ? fromEl.textContent.trim()
                        : (_swRow.classList.contains('me') ? (username || '') : '');
                    if (typeof iniciarRespuesta === 'function') {
                        iniciarRespuesta(msgId, fromName, msgText);
                    }
                }
            }
            _swStart = null; _swRow = null; _swBubbleWrap = null; _swTriggered = false;
        }, { passive: true });
    });
})();


