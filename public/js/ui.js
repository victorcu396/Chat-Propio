// ============================================================
// RENDER USUARIOS
// ============================================================
function renderUsers(onlineList) {
    const contactPhones = new Set([...myContacts.keys()]);

    // Construir el Set de usernames conocidos de contactos.
    // Usamos TRES fuentes para ser lo más robustos posible:
    //   1) c.username en myContacts (puede ser null si el contacto nunca estuvo online)
    //   2) window._phoneToUsername[phone]: solo usuarios ONLINE (no usar para verde/offline)
    //   3) window._allContactsPhoneToUsername[phone]: todos los contactos registrados,
    //      online o no. Se puebla desde cargarContactos() y onContactAdded().
    //      Es la fuente clave para filtrar sin afectar al indicador de presencia.
    const contactUsernames = new Set();
    myContacts.forEach((c, phone) => {
        // Fuente 1: username guardado en la entrada
        if (c.username) contactUsernames.add(c.username);
        // Fuente 2: username actual del online broadcast (solo si está online ahora)
        if (window._phoneToUsername && window._phoneToUsername[phone]) {
            contactUsernames.add(window._phoneToUsername[phone]);
        }
        // Fuente 3: mapa auxiliar de todos los contactos registrados
        if (window._allContactsPhoneToUsername && window._allContactsPhoneToUsername[phone]) {
            contactUsernames.add(window._allContactsPhoneToUsername[phone]);
        }
    });

    // Mapa inverso username→phone construido desde _phoneToUsername (solo online)
    // para la comprobación por phone de forma eficiente.
    const usernameToPhone = {};
    if (window._phoneToUsername) {
        Object.entries(window._phoneToUsername).forEach(([ph, un]) => {
            if (un) usernameToPhone[un] = ph;
        });
    }
    // Completar con el mapa auxiliar (para contactos que aún no han emitido broadcast online)
    if (window._allContactsPhoneToUsername) {
        Object.entries(window._allContactsPhoneToUsername).forEach(([ph, un]) => {
            if (un && !usernameToPhone[un]) usernameToPhone[un] = ph;
        });
    }

    // Separar en contactos (ya visibles en #contactsList) y genuinos desconocidos.
    // Un usuario online se considera contacto si su phone o username aparece en myContacts
    // por cualquiera de las vías anteriores.
    const onlineNotContact = onlineList.filter(u => {
        // Descartar entradas inválidas
        if (!u || typeof u !== 'string' || u.trim() === '') return false;
        // Nunca mostrar al propio usuario
        if (u === username) return false;
        if (u === loginUsername) return false;

        // Phone de este usuario online (desde los mapas inversos)
        const uPhone = usernameToPhone[u] || null;

        // Excluir si el phone coincide con el propio
        if (uPhone && uPhone === loginPhone) return false;

        // Comprobación 1: username en el Set de contactos conocidos
        if (contactUsernames.has(u)) return false;

        // Comprobación 2: phone está directamente en myContacts
        if (uPhone && contactPhones.has(uPhone)) return false;

        // Comprobación 3 (red de seguridad): recorrer myContacts directamente
        let esContacto = false;
        myContacts.forEach(c => {
            if (c.username && c.username === u) esContacto = true;
        });
        if (esContacto) return false;

        return true; // genuino desconocido
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