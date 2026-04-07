// ============================================================
// RENDER USUARIOS
// ============================================================
function renderUsers(onlineList) {
    const contactPhones = new Set([...myContacts.keys()]);

    // Construir también un Set de usernames de contactos para filtrado más robusto.
    // Un usuario online se considera "contacto" si:
    //   a) Su phone está en myContacts, O
    //   b) Su username coincide con el campo .username de algún contacto
    // Esto cubre el caso en que _phoneToUsername aún no tiene el phone mapeado.
    const contactUsernames = new Set();
    myContacts.forEach(c => {
        if (c.username) contactUsernames.add(c.username);
    });

    // Separar en contactos-online (ya se muestran en #contactsList) y desconocidos
    const onlineNotContact = onlineList.filter(u => {
        // Descartar entradas inválidas (null, undefined, string vacío)
        if (!u || typeof u !== 'string' || u.trim() === '') return false;
        // Nunca mostrar al propio usuario (triple comprobación para cubrir cualquier timing)
        if (u === username) return false;
        if (u === loginUsername) return false;
        // Comprobar también por phone propio: si este usuario online es el propio teléfono, excluir
        const uPhone = window._phoneToUsername
            ? Object.entries(window._phoneToUsername).find(([ph, un]) => un === u)?.[0]
            : null;
        if (uPhone && uPhone === loginPhone) return false;
        // Comprobar por username directo en contactos
        if (contactUsernames.has(u)) return false;
        // Comprobar por phone en contactos (vía _phoneToUsername)
        if (uPhone && contactPhones.has(uPhone)) return false;
        return true; // es un desconocido → mostrar en "Conectados ahora"
    });

    if (onlineNotContact.length === 0) {
        usersUl.innerHTML = '<li style="list-style:none;padding:8px 18px;font-size:12px;color:var(--text-muted);font-style:italic;cursor:default;">Nadie más conectado</li>';
    } else {
        usersUl.innerHTML = onlineNotContact.map(u => {
            const isAway    = window._awayUsers && window._awayUsers.has(u);
            const dotClass  = isAway ? 'status-dot away' : 'status-dot online-pulse';
            const avatarUrl = userAvatars[u] || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(u)}`;
            const phone = window._phoneToUsername
                ? Object.entries(window._phoneToUsername).find(([ph, un]) => un === u)?.[0]
                : null;
            const phoneEsc = phone ? phone.replace(/'/g, "\\'") : '';
            const uEsc = u.replace(/'/g, "\\'");
            return `<li class="stranger">
                <div class="user-avatar-wrap">
                    <img class="user-avatar" src="${avatarUrl}" alt="${u}"
                        onerror="this.src='https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(u)}'">
                    <span class="${dotClass}"></span>
                </div>
                <div class="user-info">
                    <div class="user-name">${u}</div>
                    <div class="user-preview" style="font-size:11px;color:var(--text-muted);font-style:italic;">No en contactos</div>
                </div>
                <div class="stranger-actions">
                    <button class="btn-stranger-accept" onclick="event.stopPropagation();aceptarDesconocidoDirecto('${phoneEsc}','${uEsc}')" title="Agregar contacto">+ Agregar</button>
                </div>
            </li>`;
        }).join('');
    }

    // Actualizar título del botón de llamada si el chat activo es 1:1
    // (solo el título cambia según si está online o no, nunca lo deshabilitamos)
    if (currentChat && !currentChat.startsWith('group_') && !currentChat.startsWith('phone:')) {
        const btnU = document.getElementById('btnCallUnified');
        if (btnU && btnU.dataset.mode === '1to1') {
            const isCurrentOnline = onlineList.includes(currentChat);
            btnU.title = isCurrentOnline ? 'Llamada de voz' : 'Llamar (dejará notificación de llamada perdida)';
            // Nunca deshabilitar: iniciarLlamada() maneja el caso offline correctamente
        }
    }
}

// Dispatcher del botón de llamada unificado
function onBtnCall() {
    const btnU = document.getElementById('btnCallUnified');
    if (!btnU || btnU.disabled) return;
    if (btnU.dataset.mode === 'group') {
        iniciarLlamadaGrupal();
    } else {
        iniciarLlamada();
    }
}

// ============================================================
