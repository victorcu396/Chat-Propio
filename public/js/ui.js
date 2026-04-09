// ============================================================
// RENDER USUARIOS
// ============================================================
function renderUsers(onlineList) {
    const contactPhones = new Set([...myContacts.keys()]);

    // Construir el mapa inverso username→phone a partir de _phoneToUsername.
    // Esto permite identificar a un usuario online por su phone aunque
    // _phoneToUsername aún no haya sido construido por un broadcast 'users'.
    // Fuentes de usernames conocidos:
    //   1) c.username en myContacts  (puede ser null si el contacto estaba offline al guardarse)
    //   2) window._phoneToUsername[phone] para cada phone en myContacts (actualizado por broadcast 'users')
    const contactUsernames = new Set();
    myContacts.forEach((c, phone) => {
        if (c.username) contactUsernames.add(c.username);
        if (window._phoneToUsername && window._phoneToUsername[phone]) {
            contactUsernames.add(window._phoneToUsername[phone]);
        }
    });

    // Construir mapa inverso: username → phone, a partir de _phoneToUsername
    // para poder hacer la búsqueda en ambos sentidos de forma eficiente.
    const usernameToPhone = {};
    if (window._phoneToUsername) {
        Object.entries(window._phoneToUsername).forEach(([ph, un]) => {
            if (un) usernameToPhone[un] = ph;
        });
    }

    // Separar en contactos-online (ya se muestran en #contactsList) y desconocidos.
    // Un usuario online se considera contacto si se puede identificar su phone
    // en myContacts por CUALQUIERA de estas vías (en orden de fiabilidad):
    //   1) Su username está en contactUsernames (ya incluye _phoneToUsername)
    //   2) Su phone (vía usernameToPhone) está en contactPhones
    //   3) Búsqueda directa en myContacts por c.username === u  (red de seguridad)
    const onlineNotContact = onlineList.filter(u => {
        // Descartar entradas inválidas (null, undefined, string vacío)
        if (!u || typeof u !== 'string' || u.trim() === '') return false;
        // Nunca mostrar al propio usuario
        if (u === username) return false;
        if (u === loginUsername) return false;

        // Obtener el phone de este usuario online (desde el mapa inverso ya construido)
        const uPhone = usernameToPhone[u] || null;

        // Excluir el propio usuario aunque venga con otro username
        if (uPhone && uPhone === loginPhone) return false;

        // Comprobación 1: username directamente en el Set de contactos
        // (incluye c.username y el username actual vía _phoneToUsername)
        if (contactUsernames.has(u)) return false;

        // Comprobación 2: phone del usuario online está en myContacts
        if (uPhone && contactPhones.has(uPhone)) return false;

        // Comprobación 3 (red de seguridad): recorrer myContacts buscando coincidencia
        // Cubre el caso extremo en que _phoneToUsername no tiene aún la entrada
        // pero myContacts sí tiene guardado el username de este contacto.
        let esContacto = false;
        myContacts.forEach(c => {
            if (c.username && c.username === u) esContacto = true;
        });
        if (esContacto) return false;

        return true; // genuino desconocido → mostrar en "Conectados ahora"
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