// SISTEMA DE SOLICITUDES DE CONTACTO
// ============================================================

// Estado de la solicitud actualmente mostrada en el modal
let _currentRequest = null;

/* Muestra el modal de solicitud entrante */
function mostrarSolicitudContacto(data) {
    _currentRequest = data;
    const avatarUrl = data.fromAvatar || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(data.fromUsername)}`;
    document.getElementById('crAvatar').src = avatarUrl;
    document.getElementById('crText').textContent =
        data.fromUsername + ' quiere añadirte como contacto.';
    document.getElementById('crNameInput').value = data.fromUsername;
    document.getElementById('crError').textContent = '';
    document.getElementById('btnAceptarSolicitud').disabled = false;
    document.getElementById('contactRequestModal').classList.add('visible');
    // Solicitar permiso de notificaciones si no se tiene
    pedirPermisoNotificaciones();
    // Notificación nativa si la app está en background
    if (document.visibilityState === 'hidden' && Notification.permission === 'granted') {
        new Notification('Nueva solicitud de contacto', {
            body: data.fromUsername + ' quiere añadirte como contacto.',
            icon: '/Logo_kiVooSpace.png'
        });
    }
}

function aceptarSolicitudContacto() {
    if (!_currentRequest) return;
    const customName = document.getElementById('crNameInput').value.trim();
    if (!customName) {
        document.getElementById('crError').textContent = 'Pon un nombre para el contacto.';
        return;
    }
    document.getElementById('btnAceptarSolicitud').disabled = true;

    // Responder al servidor: aceptar
    socket.send(JSON.stringify({
        type:      'respondContactRequest',
        fromPhone: _currentRequest.fromPhone,
        accepted:  true
    }));

    // El servidor enviará contactAdded para ambos lados.
    // Guardamos el customName localmente para sobreescribir el username automático
    // cuando llegue el evento contactAdded.
    window._pendingCustomName = {
        phone: _currentRequest.fromPhone,
        name:  customName
    };

    cerrarModalSolicitud();
}

function rechazarSolicitudContacto() {
    if (!_currentRequest) return;
    socket.send(JSON.stringify({
        type:      'respondContactRequest',
        fromPhone: _currentRequest.fromPhone,
        accepted:  false
    }));
    cerrarModalSolicitud();
}

function cerrarModalSolicitud() {
    document.getElementById('contactRequestModal').classList.remove('visible');
    _currentRequest = null;
}

document.getElementById('contactRequestModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('contactRequestModal')) cerrarModalSolicitud();
});

/* Aceptar directamente desde el botón "+Agregar" en la lista de desconocidos
   (el usuario está online → enviamos solicitud de contacto al servidor,
    que la entrega inmediatamente; si la otra persona la acepta, ambos se agregan) */
function aceptarDesconocidoDirecto(phone, uname) {
    if (!phone || !socket) return;

    // ── Actualización optimista inmediata ────────────────────────────────
    // 1) Añadir a myContacts provisionalmente para que renderUsers lo filtre
    if (!myContacts.has(phone)) {
        const avatarUrl = userAvatars[uname]
            || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(uname)}`;
        myContacts.set(phone, {
            contactPhone: phone,
            customName:   uname,
            avatar:       avatarUrl,
            username:     uname,
            blocked:      false,
            blockedUs:    false,
            _optimistic:  true   // marcador: el servidor aún no confirmó
        });
    }

    // 2) Quitar de "Conectados ahora" de inmediato
    renderUsers(lastKnownUsers);

    // 3) Mostrar en lista de contactos de inmediato
    renderContactsList();

    // ── Enviar al servidor ───────────────────────────────────────────────
    // Usar addContact directo: el servidor agrega a ambos lados de forma inmediata
    // y recíproca. El nombre por defecto es el username del otro usuario (editable después).
    socket.send(JSON.stringify({
        type:         'addContact',
        contactPhone: phone,
        customName:   uname
    }));
    mostrarToast('Agregando a ' + uname + '…');
}

// ============================================================
