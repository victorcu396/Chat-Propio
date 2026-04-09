// ============================================================
// RENDER USUARIOS
// ============================================================
function renderUsers(onlineList) {
    const contactPhones = new Set([...myContacts.keys()]);

    // Construir un Set de usernames de contactos para filtrado por nombre.
    // Usamos TODAS las fuentes disponibles para identificar a un contacto:
    //   a) c.username guardado en myContacts (puede estar desactualizado o ser null)
    //   b) El username actual según _phoneToUsername para cada phone en myContacts
    // Esto garantiza que aunque el contacto cambie de nombre en el servidor,
    // o aunque c.username sea null (contacto offline al guardarse), siga filtrándose.
    const contactUsernames = new Set();
    myContacts.forEach((c, phone) => {
        // Fuente 1: username guardado en la entrada del contacto
        if (c.username) contactUsernames.add(c.username);
        // Fuente 2: username actual según el mapa phone→username (más fiable, siempre actualizado)
        if (window._phoneToUsername && window._phoneToUsername[phone]) {
            contactUsernames.add(window._phoneToUsername[phone]);
        }
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
        // Comprobar por username directo en contactos (cubre c.username y username actual via _phoneToUsername)
        if (contactUsernames.has(u)) return false;
        // Comprobar por phone en contactos (vía _phoneToUsername) — fuente de verdad más robusta
        if (uPhone && contactPhones.has(uPhone)) return false;
        // Comprobar a la inversa: recorrer myContacts buscando si algún contacto tiene
        // este username como username actual. Cubre el caso en que _phoneToUsername aún
        // no tiene la entrada pero sí la tiene myContacts (p.ej. contacto renombrado localmente).
        let esContacto = false;
        myContacts.forEach(c => {
            if (c.username === u) esContacto = true;
        });
        if (esContacto) return false;
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