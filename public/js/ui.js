// ============================================================
// RENDER USUARIOS
// ============================================================
function renderUsers(onlineList) {
    const contactPhones = new Set([...myContacts.keys()]);

    // Set de usernames de contactos conocidos — tres fuentes:
    //   1) c.username en myContacts
    //   2) _phoneToUsername[phone]: SOLO online, reconstruido limpio en cada broadcast.
    //      Garantiza que offline no aparecen con círculo verde.
    //   3) _allContactsPhoneToUsername[phone]: todos los contactos registrados,
    //      online o no. Poblado por cargarContactos() y onContactAdded().
    const contactUsernames = new Set();
    myContacts.forEach((c, phone) => {
        if (c.username) contactUsernames.add(c.username);
        if (window._phoneToUsername && window._phoneToUsername[phone]) {
            contactUsernames.add(window._phoneToUsername[phone]);
        }
        if (window._allContactsPhoneToUsername && window._allContactsPhoneToUsername[phone]) {
            contactUsernames.add(window._allContactsPhoneToUsername[phone]);
        }
    });

    // Mapa inverso username→phone: auxiliar primero, online sobreescribe (más fiable)
    const usernameToPhone = {};
    if (window._allContactsPhoneToUsername) {
        Object.entries(window._allContactsPhoneToUsername).forEach(([ph, un]) => {
            if (un) usernameToPhone[un] = ph;
        });
    }
    if (window._phoneToUsername) {
        Object.entries(window._phoneToUsername).forEach(([ph, un]) => {
            if (un) usernameToPhone[un] = ph;
        });
    }

    // Filtrar: solo genuinos desconocidos en "Conectados ahora"
    const onlineNotContact = onlineList.filter(u => {
        if (!u || typeof u !== 'string' || u.trim() === '') return false;
        if (u === username)      return false;
        if (u === loginUsername) return false;

        const uPhone = usernameToPhone[u] || null;
        if (uPhone && uPhone === loginPhone) return false;

        if (contactUsernames.has(u)) return false;
        if (uPhone && contactPhones.has(uPhone)) return false;

        // Red de seguridad: recorrido directo de myContacts
        let esContacto = false;
        myContacts.forEach(c => { if (c.username && c.username === u) esContacto = true; });
        if (esContacto) return false;

        return true;
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