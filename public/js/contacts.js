// CONTACTOS
// ============================================================

// myContacts: Map de contactPhone → { contactPhone, customName }
let myContacts = new Map();

/* Cargar contactos desde el servidor via REST al hacer login */
async function cargarContactos() {
    try {
        const res = await fetch(`/api/contacts?phone=${encodeURIComponent(loginPhone)}`);
        const data = await res.json();
        // El servidor devuelve { contacts, blockedPhones }
        const list         = Array.isArray(data) ? data : (data.contacts || []);
        const blockedSet   = new Set(Array.isArray(data) ? [] : (data.blockedPhones || []));

        myContacts = new Map();
        list.forEach(c => {
            myContacts.set(c.contactPhone, {
                contactPhone: c.contactPhone,
                customName:   c.customName,
                avatar:       c.avatar   || null,
                username:     c.username || null,
                blocked:      blockedSet.has(c.contactPhone) || false,
                blockedUs:    false  // se actualiza en tiempo real vía WS
            });
            // Pre-popular el caché de avatares para que estén disponibles aunque
            // el usuario esté offline. La clave es tanto el username (si lo tenemos)
            // como el phone (para lookups rápidos).
            if (c.avatar) {
                if (c.username) userAvatars[c.username] = c.avatar;
                userAvatars['__phone__' + c.contactPhone] = c.avatar;
            }
        });
        window._allContactsPhoneToUsername = window._allContactsPhoneToUsername || {};
        myContacts.forEach((c, phone) => {
            if (c.username) window._allContactsPhoneToUsername[phone] = c.username;
        });

        renderContactsList();

        if (typeof lastKnownUsers !== 'undefined' && lastKnownUsers.length > 0) {
            renderUsers(lastKnownUsers);
        }

        _contactosListos = true;
        if (window._pendingOpenChat) _abrirChatPendienteDesdeNotif();
    } catch(e) {
        console.error('Error cargando contactos:', e);
        _contactosListos = true;
    }
}

/* Renderizar la lista de contactos en el sidebar */
function renderContactsList() {
    const ul = document.getElementById('contactsList');
    if (!ul) return;

    if (myContacts.size === 0) {
        ul.innerHTML = '<li class="contacts-empty" style="list-style:none;cursor:default;">Sin contactos guardados</li>';
        return;
    }

    // Filtrar por búsqueda si hay texto en el buscador
    const searchInput = document.getElementById('contactSearch');
    const searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : '';

    // Ordenar: primero los no leídos, luego por actividad reciente (último mensaje)
    const sortedContacts = [...myContacts.values()].sort((a, b) => {
        const onlineA = getOnlineUsernameByPhone(a.contactPhone);
        const onlineB = getOnlineUsernameByPhone(b.contactPhone);
        const ckA = onlineA || ('phone:' + a.contactPhone);
        const ckB = onlineB || ('phone:' + b.contactPhone);
        const unA = (unreadCounts[onlineA] || 0) + (unreadCounts[ckA] || 0);
        const unB = (unreadCounts[onlineB] || 0) + (unreadCounts[ckB] || 0);
        if (unA > 0 && unB === 0) return -1;
        if (unB > 0 && unA === 0) return 1;
        const actA = (window._contactLastActivity && window._contactLastActivity[a.contactPhone]) || 0;
        const actB = (window._contactLastActivity && window._contactLastActivity[b.contactPhone]) || 0;
        return actB - actA;
    });

    const items = sortedContacts
      .filter(c => !searchTerm || c.customName.toLowerCase().includes(searchTerm))
      .map(c => {
        const onlineUsername = getOnlineUsernameByPhone(c.contactPhone);
        const displayName = c.customName;

        // Prioridad del avatar:
        const cachedAvatar = c.avatar || userAvatars['__phone__' + c.contactPhone] || null;
        const seedName = c.username || displayName;
        const avatarUrl = onlineUsername
            ? (userAvatars[onlineUsername] || cachedAvatar || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(seedName)}`)
            : (cachedAvatar || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(seedName)}`);

        // Sincronizar caché de avatar si está online
        if (onlineUsername && userAvatars[onlineUsername]) {
            userAvatars['__phone__' + c.contactPhone] = userAvatars[onlineUsername];
            if (c.avatar !== userAvatars[onlineUsername]) {
                c.avatar = userAvatars[onlineUsername];
                myContacts.set(c.contactPhone, c);
            }
        }

        const escapedPhone = c.contactPhone.replace(/'/g, "\\'");
        const escapedName  = displayName.replace(/'/g, "\\'").replace(/"/g, '&quot;');

        // ── Contacto bloqueado por nosotros ──────────────────────────────
        if (c.blocked) {
            return `<li class="contact-blocked-row" data-phone="${escapedPhone}" style="opacity:0.55;cursor:default;">
                <div class="user-avatar-wrap">
                    <img class="user-avatar" src="${avatarUrl}" alt="${escapedName}" style="filter:grayscale(1);">
                    <span class="status-dot contact-offline"></span>
                </div>
                <div class="user-info">
                    <div class="user-name">${displayName}</div>
                    <div class="user-preview" style="color:#ef4444;">🚫 Bloqueado</div>
                </div>
                <div class="contact-actions">
                    <button class="btn-contact-edit" onclick="event.stopPropagation();abrirModalRenombrar('${escapedPhone}','${escapedName}')" title="Editar nombre">✏️</button>
                    <button class="btn-contact-block" onclick="event.stopPropagation();confirmarDesbloquearContacto('${escapedPhone}','${escapedName}')" title="Desbloquear" style="color:#10b981;">✅</button>
                </div>
            </li>`;
        }

        // ── El contacto nos ha bloqueado ─────────────────────────────────
        if (c.blockedUs) {
            return `<li class="contact-blocked-row" data-phone="${escapedPhone}" style="opacity:0.55;cursor:default;">
                <div class="user-avatar-wrap">
                    <img class="user-avatar" src="${avatarUrl}" alt="${escapedName}" style="filter:grayscale(1);">
                    <span class="status-dot contact-offline"></span>
                </div>
                <div class="user-info">
                    <div class="user-name">${displayName}</div>
                    <div class="user-preview" style="color:#f59e0b;">⛔ Te ha bloqueado</div>
                </div>
                <div class="contact-actions">
                    <button class="btn-contact-edit" onclick="event.stopPropagation();abrirModalRenombrar('${escapedPhone}','${escapedName}')" title="Editar nombre">✏️</button>
                </div>
            </li>`;
        }

        // ── Contacto normal ──────────────────────────────────────────────
        const isAway   = onlineUsername && window._awayUsers && window._awayUsers.has(onlineUsername);
        const dotClass = onlineUsername
            ? (isAway ? 'status-dot away' : 'status-dot online-pulse')
            : 'status-dot contact-offline';
        const isActive = (onlineUsername && currentChat === onlineUsername)
            || (!onlineUsername && currentChat === 'phone:' + c.contactPhone)
            ? 'active' : '';
        const chatKey = onlineUsername || ('phone:' + c.contactPhone);
        const preview = lastMessages[onlineUsername] || lastMessages[chatKey] || '';
        // Si el contacto está online, onlineUsername === chatKey → no sumar dos veces
        const unread  = onlineUsername
            ? (unreadCounts[onlineUsername] || 0)
            : (unreadCounts[chatKey] || 0) + (unreadCounts[c.contactPhone] || 0);
        const badge   = unread ? `<span class="unread-badge">${unread}</span>` : '';
        const clickFn = onlineUsername
            ? `seleccionarUsuario('${onlineUsername}')`
            : `seleccionarContactoOffline('${escapedPhone}')`;
        const statusPreview = onlineUsername
            ? (isAway ? '🌙 Ausente' : (preview || ''))
            : (preview || '● Desconectado');
        const unreadClass = unread ? 'has-unread' : '';
        const previewText = unread
            ? (unread === 1 ? '1 mensaje sin leer' : `${unread} mensajes sin leer`)
            : (preview || statusPreview);

        return `<li class="${isActive} ${unreadClass}" onclick="${clickFn}" data-phone="${escapedPhone}">
            <div class="user-avatar-wrap">
                <img class="user-avatar" src="${avatarUrl}" alt="${escapedName}">
                <span class="${dotClass}"></span>
            </div>
            <div class="user-info">
                <div class="user-name">${displayName}</div>
                <div class="user-preview">${previewText}</div>
            </div>
            ${badge}
            <div class="contact-actions">
                <button class="btn-contact-edit" onclick="event.stopPropagation();abrirModalRenombrar('${escapedPhone}','${escapedName}')" title="Editar nombre">✏️</button>
                <button class="btn-contact-block" onclick="event.stopPropagation();confirmarBloquearContacto('${escapedPhone}','${escapedName}')" title="Bloquear contacto">🚫</button>
            </div>
        </li>`;
    });

    ul.innerHTML = items.join('') || '<li class="contacts-empty" style="list-style:none;cursor:default;padding:8px 10px;color:var(--text-muted);font-size:13px;">Sin resultados</li>';

    // Actualizar badge numérico en el encabezado "Contactos"
    const totalUnread = [...myContacts.values()].reduce((acc, c) => {
        if (c.blocked || c.blockedUs) return acc;
        const un = getOnlineUsernameByPhone(c.contactPhone);
        const ck = un || ('phone:' + c.contactPhone);
        // Si está online un === ck → contar solo una vez
        return acc + (un ? (unreadCounts[un] || 0)
                         : (unreadCounts[ck] || 0) + (unreadCounts[c.contactPhone] || 0));
    }, 0);
    const headerBadge = document.getElementById('contactsHeaderBadge');
    if (headerBadge) {
        headerBadge.textContent = totalUnread > 0 ? totalUnread : '';
        headerBadge.style.display = totalUnread > 0 ? 'inline-flex' : 'none';
    }
    _actualizarBadgeGlobal();
}

/* Obtener el username online a partir del phone de un contacto */
function getOnlineUsernameByPhone(phone) {
    // Buscamos en el Map users online: wss guarda phone en ws.phone
    // En el cliente no tenemos acceso directo, pero tenemos userPhones que se
    // actualiza con cada 'users' broadcast. Usamos window._phoneToUsername
    if (!window._phoneToUsername) return null;
    return window._phoneToUsername[phone] || null;
}

/* Modal agregar contacto */
function abrirModalAgregarContacto() {
    document.getElementById('contactPhoneInput').value = '';
    document.getElementById('contactNameInput').value = '';
    document.getElementById('addContactError').textContent = '';
    document.getElementById('btnGuardarContacto').disabled = false;
    document.getElementById('addContactModal').classList.add('visible');
    document.getElementById('contactPhoneInput').focus();
}

function cerrarModalContacto() {
    document.getElementById('addContactModal').classList.remove('visible');
}

async function guardarContacto() {
    const rawPhone  = document.getElementById('contactPhoneInput').value.replace(/\D/g, '');
    const prefix    = (document.getElementById('contactPrefixSelect')?.value || '34');
    const customName = document.getElementById('contactNameInput').value.trim();
    const errEl = document.getElementById('addContactError');

    if (rawPhone.length < 9) {
        errEl.textContent = 'Introduce los 9 dígitos del número (sin prefijo). Ej: 612 34 56 78';
        return;
    }
    if (!customName) {
        errEl.textContent = 'Pon un nombre para el contacto.';
        return;
    }

    const contactPhone = buildE164(rawPhone, prefix);

    if (contactPhone === loginPhone) {
        errEl.textContent = 'No puedes agregarte a ti mismo.';
        return;
    }

    errEl.textContent = '';
    document.getElementById('btnGuardarContacto').disabled = true;

    // Enviar por WS — funciona aunque el contacto no esté registrado aún.
    // El servidor guarda el contacto; cuando esa persona se registre se hará el recíproco.
    socket.send(JSON.stringify({
        type: 'addContact',
        contactPhone,
        customName
    }));

    // Esperar confirmación (la función onContactAdded cierra el modal)
}

function onContactAdded(contactPhone, customName, avatar, username) {
    // Si viene de aceptar una solicitud y el usuario puso nombre personalizado, usarlo
    let finalName = customName;
    if (window._pendingCustomName && window._pendingCustomName.phone === contactPhone) {
        finalName = window._pendingCustomName.name;
        window._pendingCustomName = null;
        // Persistir el nombre personalizado en BD
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type:         'renameContact',
                contactPhone: contactPhone,
                newName:      finalName
            }));
        }
    }
    const esNuevo = !myContacts.has(contactPhone) || myContacts.get(contactPhone)?._optimistic;
    // Preservar flags de bloqueo si el contacto ya existía
    const _existingContact = myContacts.get(contactPhone);
    myContacts.set(contactPhone, {
        contactPhone,
        customName:   finalName,
        avatar:       avatar || null,
        username:     username || null,
        blocked:      _existingContact ? (_existingContact.blocked   || false) : false,
        blockedUs:    _existingContact ? (_existingContact.blockedUs || false) : false
        // _optimistic se elimina al sobrescribir (contacto confirmado por servidor)
    });
    if (avatar) {
        if (username) userAvatars[username] = avatar;
        userAvatars['__phone__' + contactPhone] = avatar;
    }
    if (username) {
        window._allContactsPhoneToUsername = window._allContactsPhoneToUsername || {};
        window._allContactsPhoneToUsername[contactPhone] = username;
    }
    renderContactsList();
    renderUsers(lastKnownUsers);
    cerrarModalContacto();
    // Toast solo si es un contacto nuevo (no al recibirlo como recíproco sin abrir modal)
    if (esNuevo) {
        mostrarToast(finalName + ' añadido a contactos ✓');
    }
}

function onContactRemoved(contactPhone) {
    myContacts.delete(contactPhone);
    renderContactsList();
}

function confirmarBloquearContacto(phone, name) {
    if (confirm(`¿Bloquear a "${name}"?\n\nSeguirá en tu lista de contactos marcado como bloqueado y recibirá un aviso. No podrá enviarte mensajes ni llamarte.`)) {
        socket.send(JSON.stringify({
            type: 'blockContact',
            contactPhone: phone
        }));
    }
}

function confirmarDesbloquearContacto(phone, name) {
    if (confirm(`¿Desbloquear a "${name}"?\n\nVolverá a poder enviarte mensajes.`)) {
        socket.send(JSON.stringify({
            type: 'unblockContact',
            contactPhone: phone
        }));
    }
}

// ============================================================
// RENOMBRAR CONTACTO
// ============================================================

let _renamePhone = null; // teléfono del contacto que se está renombrando

function abrirModalRenombrar(phone, currentName) {
    _renamePhone = phone;
    document.getElementById('renameContactPhone').textContent = formatearTelefono(phone);
    document.getElementById('renameContactInput').value = currentName;
    document.getElementById('renameContactError').textContent = '';
    document.getElementById('btnGuardarRenombre').disabled = false;
    document.getElementById('renameContactModal').classList.add('visible');
    setTimeout(() => document.getElementById('renameContactInput').focus(), 80);
}

function cerrarModalRenombrar() {
    document.getElementById('renameContactModal').classList.remove('visible');
    _renamePhone = null;
}

function guardarRenombre() {
    const newName = document.getElementById('renameContactInput').value.trim();
    const errEl = document.getElementById('renameContactError');

    if (!newName) {
        errEl.textContent = 'El nombre no puede estar vacío.';
        return;
    }
    if (!_renamePhone) return;

    errEl.textContent = '';
    document.getElementById('btnGuardarRenombre').disabled = true;

    socket.send(JSON.stringify({
        type: 'renameContact',
        contactPhone: _renamePhone,
        newName
    }));
}

function onContactRenamed(contactPhone, newName) {
    const contact = myContacts.get(contactPhone);
    if (contact) {
        contact.customName = newName;
        if (!contact.username) {
            contact.username =
                (window._phoneToUsername && window._phoneToUsername[contactPhone]) ||
                (window._allContactsPhoneToUsername && window._allContactsPhoneToUsername[contactPhone]) ||
                null;
        }
        if (contact.username) {
            window._allContactsPhoneToUsername = window._allContactsPhoneToUsername || {};
            window._allContactsPhoneToUsername[contactPhone] = contact.username;
        }
        myContacts.set(contactPhone, contact);
    }
    const onlineUsername = getOnlineUsernameByPhone(contactPhone);
    if (onlineUsername && currentChat === onlineUsername) {
        document.getElementById('chatName').textContent = newName;
    }
    renderContactsList();
    if (typeof lastKnownUsers !== 'undefined') renderUsers(lastKnownUsers);
    cerrarModalRenombrar();
}

// Cerrar modal al hacer click fuera
document.getElementById('renameContactModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('renameContactModal')) cerrarModalRenombrar();
});

// Confirmar con Enter
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('renameContactInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') guardarRenombre();
    });

    // Campo de teléfono del contacto
    const cpInput = document.getElementById('contactPhoneInput');
    if (cpInput) {
        // Guardar el valor anterior antes de cada pulsación de tecla
        // para detectar si se borró un espacio en móvil (donde keydown no es fiable)
        let _prevPhoneVal = '';

        cpInput.addEventListener('focus', () => { _prevPhoneVal = cpInput.value; });

        cpInput.addEventListener('keydown', (e) => {
            _prevPhoneVal = cpInput.value;

            if (e.key === 'Enter') {
                e.preventDefault();
                guardarContacto();
                return;
            }

            // Escritorio: si Backspace sobre un espacio, saltar el espacio
            // y borrar el dígito anterior directamente
            if (e.key === 'Backspace') {
                const pos = cpInput.selectionStart;
                if (cpInput.selectionStart === cpInput.selectionEnd &&
                    pos > 0 && cpInput.value[pos - 1] === ' ') {
                    e.preventDefault();
                    // Eliminar el dígito antes del espacio (pos-2) y el espacio (pos-1)
                    const val = cpInput.value;
                    const digitsBeforeDeletion = val.slice(0, pos - 1).replace(/\D/g, '').length - 1;
                    cpInput.value = val.slice(0, pos - 2) + val.slice(pos);
                    _applyPhoneFormat(cpInput);
                    // Colocar cursor después del último dígito restante antes de donde estábamos
                    const newFmt = cpInput.value;
                    let counted = 0, newPos = 0;
                    for (let i = 0; i < newFmt.length; i++) {
                        if (newFmt[i] !== ' ') {
                            counted++;
                            if (counted === Math.max(0, digitsBeforeDeletion)) {
                                newPos = i + 1;
                                break;
                            }
                        }
                    }
                    if (digitsBeforeDeletion <= 0) newPos = 0;
                    cpInput.setSelectionRange(newPos, newPos);
                }
            }
        });

        // oninput ya llama a formatContactPhone → _applyPhoneFormat
        // pero en móvil el backspace puede borrar un espacio sin pasar por keydown.
        // Detectamos ese caso comparando con _prevPhoneVal:
        cpInput.addEventListener('input', () => {
            const cur  = cpInput.value;
            const prev = _prevPhoneVal;
            // Si el valor actual tiene exactamente un carácter menos y ese carácter era un espacio
            // quiere decir que el teclado borró el espacio — en ese caso borramos también el dígito anterior
            if (prev.length - cur.length === 1) {
                // Encontrar qué carácter se borró
                let diffIdx = -1;
                for (let i = 0; i < prev.length; i++) {
                    if (prev[i] !== cur[i]) { diffIdx = i; break; }
                }
                if (diffIdx !== -1 && prev[diffIdx] === ' ') {
                    // Se borró un espacio: eliminar también el dígito antes del espacio
                    const digitsTarget = cur.replace(/\D/g, '').length - 1;
                    const onlyDigits = cur.replace(/\D/g, '').slice(0, Math.max(0, digitsTarget));
                    // Re-formatear con un dígito menos
                    cpInput.value = onlyDigits;
                    _applyPhoneFormat(cpInput);
                    _prevPhoneVal = cpInput.value;
                    return;
                }
            }
            _applyPhoneFormat(cpInput);
            _prevPhoneVal = cpInput.value;
        });
    }

    // (el input transparente cubre todo el otp-wrap, no necesita listener extra)
});

// Cerrar modal al hacer click fuera
document.getElementById('addContactModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('addContactModal')) cerrarModalContacto();
});

// ============================================================
// FOTO DE GRUPO
// ============================================================

// Actualiza el avatar de grupo en el header del chat
function actualizarHeaderGrupo(g) {
    const el = document.getElementById('chatGroupAvatar');
    if (!el || !g) return;
    if (g.avatar) {
        el.innerHTML = `<img src="${g.avatar}" alt="${escapeHTML(g.name || '')}">`;
    } else {
        el.textContent = (g.name || '?').charAt(0).toUpperCase();
    }
    // Todos los miembros pueden cambiar la foto del grupo
    el.title = 'Cambiar foto del grupo';
    el.classList.add('visible');
}

// Click en el avatar del grupo en el header — cualquier miembro puede cambiar la foto
function onClickGroupAvatar() {
    if (!currentChat || !currentChat.startsWith('group_')) return;
    const groupId = currentChat.replace('group_', '');
    const g = myGroups.get(groupId);
    if (!g) return;
    document.getElementById('groupAvatarFileInput').value = '';
    document.getElementById('groupAvatarFileInput').click();
}

function onGroupAvatarFileSelected(event) {
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

            const groupId = currentChat.replace('group_', '');
            // Actualizar localmente de inmediato
            const g = myGroups.get(groupId);
            if (g) { g.avatar = dataUrl; myGroups.set(groupId, g); }
            actualizarHeaderGrupo(myGroups.get(groupId));
            renderGroupsList();

            // Enviar al servidor
            socket.send(JSON.stringify({ type: 'updateGroupAvatar', groupId, avatar: dataUrl }));
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// ============================================================