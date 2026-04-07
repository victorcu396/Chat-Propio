// ============================================================
// AUDIO
// ============================================================
function playNotifSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
    } catch(_) {}
}

function playRingtone() {
    if (ringtoneInterval) return;
    ringtoneInterval = setInterval(() => {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            [880, 1100, 880].forEach((freq, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.type = 'sine';
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0.2, ctx.currentTime + i * 0.12);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.1);
                osc.start(ctx.currentTime + i * 0.12);
                osc.stop(ctx.currentTime + i * 0.12 + 0.15);
            });
        } catch(_) {}
    }, 1500);
}

function stopRingtone() {
    if (ringtoneInterval) { clearInterval(ringtoneInterval); ringtoneInterval = null; }
}

// ============================================================
// NOTIFICACIONES DEL NAVEGADOR
// ============================================================
/* ── Solicitar permiso de notificaciones y suscribirse al push ── */
async function pedirPermisoNotificaciones() {
    if (!('Notification' in window)) return;

    let permission = Notification.permission;
    if (permission === 'default') {
        permission = await Notification.requestPermission();
    }
    if (permission !== 'granted') return;

    // Suscribir al push si el SW está listo y hay pushManager
    await _suscribirAPush();
}

async function _suscribirAPush() {
    try {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

        // Obtener el SW activo (esperar si aún está instalando)
        const reg = _swRegistration
            || await navigator.serviceWorker.ready;
        if (!reg || !reg.pushManager) return;

        // Comprobar si ya tenemos una suscripción activa
        let sub = await reg.pushManager.getSubscription();

        if (!sub) {
            // Obtener la clave pública VAPID del servidor
            const resp = await fetch('/api/push/vapid-public-key');
            if (!resp.ok) return;
            const { publicKey } = await resp.json();
            if (!publicKey) return;

            // Suscribir
            sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: _urlBase64ToUint8Array(publicKey)
            });
        }

        _pushSubscription = sub;

        // Enviar la suscripción al servidor si tenemos loginPhone
        if (loginPhone) {
            await fetch('/api/push/subscribe', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ phone: loginPhone, subscription: sub.toJSON() })
            });
        }
    } catch(e) {
        console.warn('[PUSH] Error al suscribir:', e.message);
    }
}

/* ── Cancelar suscripción push al hacer logout ── */
async function _cancelarSuscripcionPush() {
    try {
        if (_pushSubscription) {
            const endpoint = _pushSubscription.endpoint;
            if (loginPhone && endpoint) {
                await fetch('/api/push/unsubscribe', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ phone: loginPhone, endpoint })
                });
            }
            await _pushSubscription.unsubscribe();
            _pushSubscription = null;
        }
    } catch(e) {
        console.warn('[PUSH] Error al cancelar suscripción:', e.message);
    }
}

/* ── Convertir clave base64url a Uint8Array (necesario para subscribe) ── */
function _urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw     = window.atob(base64);
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

/* ── Notificación local (cuando la app está en primer plano) ── */
function mostrarNotificacion(from, text) {
    // Si la app está en primer plano no necesitamos push; usamos la API nativa
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const body = text && text.length > 80 ? text.slice(0, 80) + '…' : (text || '…');
    // Usar el SW para mostrar la notificación si está disponible
    // (esto permite que aparezca incluso en tabs en background del mismo navegador)
    if (_swRegistration && _swRegistration.showNotification) {
        _swRegistration.showNotification(`💬 ${from}`, {
            body,
            icon:    '/icon-192.png',
            badge:   '/icon-192.png',
            tag:     'msg_' + from,
            renotify: true,
            vibrate: [200, 100, 200],
            data:    { chatKey: from }
        });
    } else {
        new Notification(`💬 ${from}`, { body, icon: '/icon-192.png' });
    }
}

/* ── Abrir chat pendiente al volver desde una notificación push ──────────────
   Se llama después de que cargarContactos() y cargarGrupos() terminen.
   Espera hasta que ambas listas estén listas (máximo 5s) antes de navegar.
────────────────────────────────────────────────────────────────────────────── */
let _contactosListos = false;
let _gruposListos    = false;

function _abrirChatPendienteDesdeNotif() {
    if (!window._pendingOpenChat) return;
    // Si ya están listos ambos, abrir directamente
    if (_contactosListos && _gruposListos) {
        _ejecutarAperturaChatPendiente();
        return;
    }
    // Si no, esperar polling con timeout de seguridad de 5s
    let intentos = 0;
    const intervalo = setInterval(() => {
        intentos++;
        if ((_contactosListos && _gruposListos) || intentos >= 50) {
            clearInterval(intervalo);
            if (window._pendingOpenChat) _ejecutarAperturaChatPendiente();
        }
    }, 100);
}

function _ejecutarAperturaChatPendiente() {
    const chatToOpen = window._pendingOpenChat;
    window._pendingOpenChat = null;
    if (!chatToOpen) return;

    // Forzar recarga del historial desde el servidor para que aparezcan TODOS los mensajes,
    // no solo el que llegó con la notificación push
    if (chatToOpen.startsWith('group_')) {
        delete conversations[chatToOpen];
        const gid = chatToOpen.replace('group_', '');
        if (typeof seleccionarGrupo === 'function') seleccionarGrupo(gid);
    } else if (chatToOpen.startsWith('phone:')) {
        const ph = chatToOpen.replace('phone:', '');
        delete conversations['phone:' + ph];
        if (window._phoneToUsername && window._phoneToUsername[ph]) {
            delete conversations[window._phoneToUsername[ph]];
        }
        if (typeof seleccionarContactoOffline === 'function') seleccionarContactoOffline(ph);
    } else {
        // chatToOpen es un username — limpiar caché para forzar recarga completa
        delete conversations[chatToOpen];
        if (typeof seleccionarUsuario === 'function') {
            seleccionarUsuario(chatToOpen);
        }
    }
    // Cerrar también las notificaciones al abrir
    _cerrarNotificacionesDeChat(chatToOpen);
}

/* ── Cerrar notificaciones de la bandeja al entrar a un chat ──────────────────
   chatKey puede ser:
     - username        → tag msg_username  (chat 1:1 con usuario online)
     - phone:+34XXX    → tag msg_+34XXX o msg_username (contacto offline)
     - group_XXXX      → tag grp_XXXX
   Envía un mensaje al SW para que cierre las notificaciones con ese tag.
   También usa la API directa del registro si está disponible.
────────────────────────────────────────────────────────────────────────────── */
function _cerrarNotificacionesDeChat(chatKey) {
    if (!chatKey) return;

    // Informar al servidor para resetear el contador de no leídos push
    if (socket && socket.readyState === WebSocket.OPEN) {
        try {
            socket.send(JSON.stringify({ type: 'markRead', chatKey }));
        } catch(_) {}
    }

    if (!('serviceWorker' in navigator)) return;

    // Calcular el tag que usó el servidor para este chat
    let tag = null;
    if (chatKey.startsWith('group_')) {
        tag = 'grp_' + chatKey.replace('group_', '');
    } else if (chatKey.startsWith('phone:')) {
        // Para contactos offline el tag puede ser msg_+34XXX o msg_username
        // Cerramos ambos: primero por phone, luego por username si lo conocemos
        const phone = chatKey.replace('phone:', '');
        _enviarClearNotif('msg_' + phone);
        if (window._phoneToUsername && window._phoneToUsername[phone]) {
            _enviarClearNotif('msg_' + window._phoneToUsername[phone]);
        }
        return;
    } else {
        tag = 'msg_' + chatKey;
        // También cerrar por phone por si la notificación se generó con ese tag
        if (window._phoneToUsername) {
            const phone = Object.entries(window._phoneToUsername).find(([,un]) => un === chatKey)?.[0];
            if (phone) _enviarClearNotif('msg_' + phone);
        }
    }
    if (tag) _enviarClearNotif(tag);
}

function _enviarClearNotif(tag) {
    // Método 1: pedir al SW via postMessage que cierre las notificaciones
    if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_NOTIFICATIONS', tag });
    }
    // Método 2: usar la API del registro directamente (disponible en algunos navegadores)
    if (_swRegistration && _swRegistration.getNotifications) {
        _swRegistration.getNotifications({ tag })
            .then(notifs => notifs.forEach(n => n.close()))
            .catch(() => {});
    }
}

// ── Compartir / Invitar amigos ──────────────────────────────────────────────
async function compartirApp() {
    const shareData = {
        title: 'kiVooSpace — Chat privado y sin publicidad',
        text: '¡Únete a kiVooSpace! El chat privado y sin publicidad donde solo están tus contactos. 🔒💬',
        url: window.location.origin
    };
    try {
        if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
            await navigator.share(shareData);
        } else {
            // Fallback: copiar al portapapeles
            const texto = `${shareData.text}\n${shareData.url}`;
            await navigator.clipboard.writeText(texto);
            mostrarToast('✅ ¡Enlace copiado! Compártelo con tus amigos', 2800);
        }
    } catch(e) {
        if (e.name !== 'AbortError') {
            try {
                await navigator.clipboard.writeText(window.location.origin);
                mostrarToast('✅ ¡Enlace copiado!', 2000);
            } catch(_) {}
        }
    }
}

// ── Toast de notificación visual ────────────────────────────────────────────
// mostrarToast definida más abajo (implementación única)
let socket;
let currentChat = null;
let username;
let conectado = false;
let myAvatarDataUrl = ''; // base64 o URL del avatar propio
let pendingAvatarDataUrl = ''; // avatar seleccionado pero no guardado aún

let userAvatars = {}; // username → avatarUrl de otros usuarios
let userLastSeen = {}; // username → ISO date string of last seen
const conversations = {};
let typingTimer = null;
let unreadCounts = {};
let lastMessages = {};
let autoScroll = true;
let pendingImage = null;
let ringtoneInterval = null;

// ── Paginación de historial ──────────────────────────────────────────────────
// Guardamos el id del mensaje más antiguo cargado para pedir la página anterior
// cuando el usuario hace scroll hasta arriba.
let _historyHasMore   = false;  // hay mensajes anteriores disponibles
let _historyLoading   = false;  // evitar peticiones simultáneas
let _historyOldestId  = null;   // id del mensaje más antiguo visible

const chat = document.getElementById('chat');
const input = document.getElementById('mensaje');
const usersUl = document.getElementById('users');
const typingDiv = document.getElementById('typing');
const typingText = document.getElementById('typingText');
const btnEnviar = document.getElementById('btnEnviar');
const emojiPicker = document.getElementById('emojiPicker');
const imgPreviewContainer = document.getElementById('imgPreviewContainer');
const imgPreviewEl = document.getElementById('imgPreview');

// Inicializar onclick del botón enviar
btnEnviar.onclick = enviar;

// ============================================================
