
// ============================================================
// DETECCIÓN DE MÓVIL REAL (para Xiaomi/MIUI y navegadores con viewport incorrecto)
// Se añade clase is-mobile al <html> si el dispositivo es realmente móvil
// (cubre MIUI, HarmonyOS y otros que rompen el media query).
(function detectMobile() {
    const ua = navigator.userAgent || '';
    const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|MIUI|HarmonyOS|MiuiBrowser/i.test(ua);
    const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    const isSmallScreen = window.innerWidth <= 900 || window.screen.width <= 900;

    if (isMobileUA || (isTouchDevice && isSmallScreen)) {
        document.documentElement.classList.add('is-mobile');
    }

    window.addEventListener('resize', () => {
        const stillSmall = window.innerWidth <= 900 || window.screen.width <= 900;
        if (isMobileUA || (isTouchDevice && stillSmall)) {
            document.documentElement.classList.add('is-mobile');
        } else {
            document.documentElement.classList.remove('is-mobile');
        }
    });
})();

// ============================================================
// ============================================================
//   STEP 1: LOGIN POR TELÉFONO
// ============================================================
// ============================================================

let loginPhone = '';
let loginUsername = '';
let otpGenerado = '';

// Aplica formato xxx xx xx xx preservando la posición del cursor
function _applyPhoneFormat(el) {
    const start = el.selectionStart;
    const before = el.value.slice(0, start);
    const digitsBeforeCursor = before.replace(/\D/g, '').length;

    const digits = el.value.replace(/\D/g, '').slice(0, 9);
    let formatted = digits;
    if (digits.length > 6)      formatted = digits.slice(0,3) + ' ' + digits.slice(3,5) + ' ' + digits.slice(5,7) + ' ' + digits.slice(7);
    else if (digits.length > 4) formatted = digits.slice(0,3) + ' ' + digits.slice(3,5) + ' ' + digits.slice(5);
    else if (digits.length > 3) formatted = digits.slice(0,3) + ' ' + digits.slice(3);

    el.value = formatted;

    // Recalcular posición del cursor: contar cuántos dígitos hay antes del cursor
    // en el nuevo valor formateado y colocar el cursor después de ellos
    let newPos = 0, counted = 0;
    for (let i = 0; i < formatted.length; i++) {
        if (formatted[i] !== ' ') {
            counted++;
            if (counted === digitsBeforeCursor) { newPos = i + 1; break; }
        }
    }
    // Si digitsBeforeCursor es 0 o no se encontró, dejar en la posición natural
    if (digitsBeforeCursor === 0) newPos = 0;
    else if (newPos === 0 && counted < digitsBeforeCursor) newPos = formatted.length;

    el.setSelectionRange(newPos, newPos);
}

function formatPhone(el) {
    _applyPhoneFormat(el);
}

// Formato igual para el campo de agregar contacto (9 dígitos → xxx xx xx xx)
function formatContactPhone(el) {
    _applyPhoneFormat(el);
}

// Devuelve un número E.164 con prefijo dado solo los dígitos del abonado
// Ej: ('612345678', '34') → '+34612345678'
function buildE164(digits9, prefix) {
    return '+' + (prefix || '34') + digits9;
}

// Formatea un número E.164 o crudo para mostrarlo al usuario
// Si empieza por +34 muestra: +34 xxx xx xx xx
// Si no tiene prefijo conocido, lo muestra tal cual agrupado en bloques
function formatearTelefono(phone) {
    if (!phone) return '';
    // Quitar + y prefijo 34
    if (phone.startsWith('+34')) {
        const digits = phone.slice(3).replace(/\D/g, '').slice(0, 9);
        const fmt = formatDigits9(digits);
        return '+34 ' + fmt;
    }
    // Número sin prefijo o con otro prefijo: mostrar tal cual
    return phone;
}

function formatDigits9(v) {
    v = (v || '').replace(/\D/g, '').slice(0, 9);
    if (v.length > 6) return v.slice(0,3) + ' ' + v.slice(3,5) + ' ' + v.slice(5,7) + ' ' + v.slice(7);
    if (v.length > 4) return v.slice(0,3) + ' ' + v.slice(3,5) + ' ' + v.slice(5);
    if (v.length > 3) return v.slice(0,3) + ' ' + v.slice(3);
    return v;
}

function goToStep(n) {
    [1,2,3].forEach(i => {
        document.getElementById(`step${i}`).classList.toggle('active', i === n);
        document.getElementById(`dot${i}`).classList.toggle('active', i === n);
    });
}

async function sendOTP() {
    const raw = document.getElementById('phoneInput').value.replace(/\D/g, '');
    if (raw.length < 9) {
        document.getElementById('phoneError').textContent = 'Introduce un número válido de 9 dígitos.';
        return;
    }
    document.getElementById('phoneError').textContent = '';
    loginPhone = '+34' + raw;

    // Verificar rate limiting en el servidor antes de generar el OTP
    try {
        const rl = await fetch('/api/otp/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: loginPhone })
        });
        if (rl.status === 429) {
            const err = await rl.json();
            document.getElementById('phoneError').textContent = err.error || 'Demasiados intentos. Espera unos minutos.';
            return;
        }
    } catch(_) {
        // Si falla la verificación (sin red), continuamos igualmente en modo dev
    }

    // Generar OTP simulado (en producción se enviaría por SMS)
    otpGenerado = Math.floor(100000 + Math.random() * 900000).toString();
    console.log(`[DEV] OTP para ${loginPhone}: ${otpGenerado}`);

    document.getElementById('otpPhone').textContent = formatearTelefono(loginPhone);

    // Limpiar campos OTP
    _otpClear();

    goToStep(2);
    _otpFocus();

    // Notificación visual de OTP enviado
    showOtpToast(otpGenerado);
}

let otpCountdownInterval = null;

function showOtpToast(code) {
    // Mostrar el código en el display fijo dentro del paso 2 (siempre visible)
    const display = document.getElementById('otpCodeDisplay');
    const valueEl = document.getElementById('otpCodeValue');
    if (display && valueEl) {
        valueEl.textContent = code;
        display.style.display = 'block';
    }
    startOtpCountdown(60);
}

function startOtpCountdown(seconds) {
    clearInterval(otpCountdownInterval);
    const timerEl  = document.getElementById('otpCodeTimer');
    const wrapEl   = document.getElementById('otpTimerWrap');
    const regenBtn = document.getElementById('btnRegenOtp');
    const display  = document.getElementById('otpCodeDisplay');
    if (regenBtn) regenBtn.style.display = 'none';
    let remaining = seconds;
    function tick() {
        if (timerEl) timerEl.textContent = `Caduca en ${remaining}s`;
        if (wrapEl)  wrapEl.textContent  = `El código caduca en ${remaining}s`;
        if (remaining <= 0) {
            clearInterval(otpCountdownInterval);
            otpGenerado = '';
            if (timerEl)  timerEl.textContent  = 'Código caducado';
            if (wrapEl)   wrapEl.textContent   = 'Código caducado.';
            if (display)  display.style.opacity = '0.45';
            if (regenBtn) regenBtn.style.display = 'block';
        }
        remaining--;
    }
    tick();
    otpCountdownInterval = setInterval(tick, 1000);
}

function regenOTP() {
    otpGenerado = Math.floor(100000 + Math.random() * 900000).toString();
    console.log(`[DEV] Nuevo OTP para ${loginPhone}: ${otpGenerado}`);
    _otpClear();
    document.getElementById('otpError').textContent = '';
    const display = document.getElementById('otpCodeDisplay');
    if (display) display.style.opacity = '1';
    _otpFocus();
    showOtpToast(otpGenerado);
}

// OTP — input único oculto + celdas visuales
// Así funciona igual en móvil (sin problemas de Backspace entre inputs) y escritorio.
function _otpSync(val) {
    // val: solo dígitos, máx 6
    const digits = val.replace(/\D/g, '').slice(0, 6);
    for (let i = 0; i < 6; i++) {
        const cell = document.getElementById('otpCell' + i);
        if (!cell) continue;
        cell.textContent = digits[i] || '';
        cell.classList.toggle('otp-filled', i < digits.length);
        cell.classList.remove('otp-error');
    }
    // Resaltar la celda activa (la que se va a escribir a continuación)
    _otpMarkActive(digits.length);
}

function _otpMarkActive(activeIdx) {
    for (let i = 0; i < 6; i++) {
        const cell = document.getElementById('otpCell' + i);
        if (!cell) continue;
        cell.classList.toggle('otp-active', i === Math.min(activeIdx, 5));
    }
}

function onOtpInput(el) {
    // Filtrar solo dígitos y limitar a 6
    const digits = el.value.replace(/\D/g, '').slice(0, 6);
    // Solo actualizar el valor si cambió (evita bucle en algunos navegadores)
    if (el.value !== digits) el.value = digits;
    _otpSync(digits);
    // Auto-verificar al completar los 6
    if (digits.length === 6) {
        setTimeout(verifyOTP, 80);
    }
}

function onOtpKeydown(e) {
    const el = document.getElementById('otpRealInput');
    if (!el) return;
    // En escritorio, Backspace con campo vacío no hace nada extra — el input nativo lo gestiona
    // En móvil esto no se dispara de forma fiable, por eso usamos beforeinput también
}

document.addEventListener('DOMContentLoaded', () => {
    const realInput = document.getElementById('otpRealInput');
    if (!realInput) return;

    // Al hacer foco en el input real, marcar la celda activa visualmente
    realInput.addEventListener('focus', () => {
        const digits = realInput.value.replace(/\D/g, '');
        _otpMarkActive(digits.length);
    });
    realInput.addEventListener('blur', () => {
        for (let i = 0; i < 6; i++) {
            document.getElementById('otpCell' + i)?.classList.remove('otp-active');
        }
    });

    // beforeinput: captura el borrado en móvil ANTES de que cambie el valor.
    // En iOS/Android los teclados virtuales generan este evento incluso cuando
    // oninput o keydown no se disparan correctamente.
    realInput.addEventListener('beforeinput', (e) => {
        if (e.inputType === 'deleteContentBackward' || e.inputType === 'deleteWordBackward') {
            const cur = realInput.value.replace(/\D/g, '');
            if (cur.length > 0) {
                // Prevenir el comportamiento por defecto y hacerlo nosotros
                // para garantizar que _otpSync se llame siempre
                e.preventDefault();
                const newVal = cur.slice(0, -1);
                realInput.value = newVal;
                _otpSync(newVal);
                _otpMarkActive(newVal.length);
            } else {
                e.preventDefault(); // nada que borrar
            }
        }
    });

    // Pegado: aceptar código de 6 dígitos (también funciona con autocompletado SMS)
    realInput.addEventListener('paste', (e) => {
        const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
        if (pasted.length >= 1) {
            e.preventDefault();
            const val = pasted.slice(0, 6);
            realInput.value = val;
            _otpSync(val);
            if (val.length === 6) setTimeout(verifyOTP, 80);
        }
    });
});

// Helpers de compatibilidad: funciones que el código existente llama con otp0..otp5
// Las redirigimos al nuevo sistema de input único
function _otpGetValue() {
    const el = document.getElementById('otpRealInput');
    return el ? el.value.replace(/\D/g, '') : '';
}
function _otpClear() {
    const el = document.getElementById('otpRealInput');
    if (el) { el.value = ''; }
    _otpSync('');
}
function _otpFocus() {
    const el = document.getElementById('otpRealInput');
    if (el) el.focus({ preventScroll: true });
    _otpMarkActive(0);
}

function verifyOTP() {
    const entered = _otpGetValue();
    if (entered.length < 6) {
        document.getElementById('otpError').textContent = 'Introduce los 6 dígitos.';
        return;
    }
    if (entered !== otpGenerado) {
        document.getElementById('otpError').textContent = 'Código incorrecto. Inténtalo de nuevo.';
        // Shake animation — marcar celdas en rojo
        for (let i = 0; i < 6; i++) {
            const cell = document.getElementById('otpCell' + i);
            if (cell) cell.classList.add('otp-error');
        }
        setTimeout(() => {
            for (let i = 0; i < 6; i++) {
                const cell = document.getElementById('otpCell' + i);
                if (cell) cell.classList.remove('otp-error');
            }
        }, 1000);
        _otpFocus();
        return;
    }
    document.getElementById('otpError').textContent = '';

    // Intentar recuperar nombre guardado para este número
    const savedName = localStorage.getItem(`kvs_name_${loginPhone}`);
    if (savedName) {
        loginUsername = savedName;
        // Cargar avatar desde servidor (sincroniza entre dispositivos)
        // Si el servidor tiene uno más reciente que el localStorage, se usa ese
        const localAvatar = localStorage.getItem(`kvs_avatar_${loginPhone}`);
        fetch(`/api/user?phone=${encodeURIComponent(loginPhone)}`)
            .then(r => r.ok ? r.json() : null)
            .then(userData => {
                const serverAvatar = userData && userData.avatar;
                const isValidAvatar = serverAvatar && (
                    serverAvatar.startsWith('data:image/') || serverAvatar.startsWith('https://')
                );
                if (isValidAvatar) {
                    myAvatarDataUrl = serverAvatar;
                    // Solo guardar en localStorage si es base64 (las URLs Cloudinary no necesitan caché local)
                    if (serverAvatar.startsWith('data:image/')) {
                        localStorage.setItem(`kvs_avatar_${loginPhone}`, myAvatarDataUrl);
                    }
                } else if (localAvatar && (localAvatar.startsWith('data:image/') || localAvatar.startsWith('https://'))) {
                    myAvatarDataUrl = localAvatar;
                }
                finishLogin();
            })
            .catch(() => {
                if (localAvatar && (localAvatar.startsWith('data:image/') || localAvatar.startsWith('https://'))) myAvatarDataUrl = localAvatar;
                finishLogin();
            });
        return;
    }

    goToStep(3);
    document.getElementById('usernameInput').focus();
}

function finishLogin() {
    if (!loginUsername) {
        loginUsername = document.getElementById('usernameInput').value.trim();
    }
    if (!loginUsername) {
        document.getElementById('usernameError').textContent = 'Pon un nombre de usuario.';
        return;
    }
    document.getElementById('usernameError').textContent = '';

    // Guardar nombre localmente para este número
    localStorage.setItem(`kvs_name_${loginPhone}`, loginUsername);

    // Persistir sesión siempre en localStorage (permanente en PWA y navegador)
    const sessionData = JSON.stringify({ phone: loginPhone, username: loginUsername});
    localStorage.setItem('kvs_session', sessionData);

    // Ocultar modal, mostrar app
    document.getElementById('loginModal').style.display = 'none';
    document.getElementById('appContainer').style.display = 'flex';
    _mostrarWelcomePanel(true);

    // Cargar avatar guardado o usar dicebear por defecto
    const savedAvatar = localStorage.getItem(`kvs_avatar_${loginPhone}`);
    const isValidSaved = savedAvatar && (savedAvatar.startsWith('data:image/') || savedAvatar.startsWith('https://'));
    myAvatarDataUrl = isValidSaved ? savedAvatar : `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(loginUsername)}`;

    // Rellenar perfil sidebar
    document.getElementById('myName').textContent = loginUsername;
    document.getElementById('myPhone').textContent = formatearTelefono(loginPhone);
    document.getElementById('myAvatar').src = myAvatarDataUrl;

    // Iniciar WebSocket
    conectarWS();

    // Cargar contactos guardados (después de que socket se conecte, lo llamamos desde onopen)
}

/* ── Limpia TODO el estado de la sesión actual ──────────────────
   Se llama tanto en logout() como al inicio de un login fresco,
   para asegurarse de que no quedan datos del usuario anterior.  */
function _limpiarEstadoGlobal() {
    // Salir del modo selección si estaba activo
    if (typeof salirModoSeleccion === 'function') salirModoSeleccion();

    // Estado de conversaciones y contadores
    Object.keys(conversations).forEach(k => delete conversations[k]);
    Object.keys(unreadCounts).forEach(k => delete unreadCounts[k]);
    Object.keys(lastMessages).forEach(k => delete lastMessages[k]);
    Object.keys(userAvatars).forEach(k => delete userAvatars[k]);

    // Limpiar badge del sistema y título de pestaña
    document.title = 'kiVooSpace – Chat';
    if ('clearAppBadge' in navigator) navigator.clearAppBadge().catch(() => {});

    // Maps de contactos y grupos
    myContacts.clear();
    myGroups.clear();

    // Estado global de presencia
    lastKnownUsers = [];
    window._phoneToUsername = {};
    window._awayUsers = new Set();
    window._contactLastActivity = {};

    // Chat abierto
    currentChat = null;

    // Limpiar DOM del chat
    const chatEl = document.getElementById('chat');
    if (chatEl) chatEl.innerHTML = '';
    const chatNameEl = document.getElementById('chatName');
    if (chatNameEl) chatNameEl.textContent = '';
    const chatStatusEl = document.getElementById('chatStatus');
    if (chatStatusEl) chatStatusEl.textContent = '';
    const chatPhoneEl = document.getElementById('chatPhone');
    if (chatPhoneEl) { chatPhoneEl.textContent = ''; chatPhoneEl.style.display = 'none'; }
    const chatAvatarEl = document.getElementById('chatAvatar');
    if (chatAvatarEl) chatAvatarEl.style.display = 'none';
    const chatGroupAvatarEl = document.getElementById('chatGroupAvatar');
    if (chatGroupAvatarEl) chatGroupAvatarEl.classList.remove('visible');

    // Limpiar listas del sidebar
    const contactsUl = document.getElementById('contactsList');
    if (contactsUl) contactsUl.innerHTML = '';
    const groupsUl = document.getElementById('groupsList');
    if (groupsUl) groupsUl.innerHTML = '';
    const usersUl = document.getElementById('users');
    if (usersUl) usersUl.innerHTML = '';

    // Limpiar buscador de contactos
    const searchInput = document.getElementById('contactSearch');
    if (searchInput) searchInput.value = '';

    // Limpiar badge del header de contactos
    const headerBadge = document.getElementById('contactsHeaderBadge');
    if (headerBadge) { headerBadge.textContent = ''; headerBadge.style.display = 'none'; }

    // Cerrar menú contextual si estaba abierto
    const ctxMenu = document.getElementById('msgCtxMenu');
    if (ctxMenu) ctxMenu.remove();

    // Cancelar estado de edición/respuesta
    _editState  = null;
    _replyState = null;
    const replyBar = document.getElementById('replyBar');
    if (replyBar) replyBar.classList.remove('visible');

    // Limpiar ediciones pendientes
    window._pendingEdits = {};

    // Resetear flags de carga de contactos/grupos (necesario para la apertura
    // reactiva de chat al volver desde una notificación push)
    _contactosListos = false;
    _gruposListos    = false;

    // Resetear estado de nuevas features
    _archivedChats        = new Set();
    _autoDestructSettings = {};
    userLastSeen          = {};
    _cerrarMentionList();
    if (_searchActive) { _searchActive = false; const bar = document.getElementById('chatSearchBar'); if (bar) bar.style.display = 'none'; }
}

function logout() {
    // Cancelar suscripción push antes de borrar loginPhone (necesitamos el phone para el endpoint)
    _cancelarSuscripcionPush().catch(() => {});

    // Cancelar cualquier reconexión automática pendiente
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    _pararHeartbeat();

    if (socket) { socket.onclose = null; socket.onerror = null; socket.close(); socket = null; }
    localStorage.removeItem('kvs_session');
    loginPhone    = '';
    loginUsername = '';
    username      = null;
    conectado     = false;
    _esSesionNueva = true; // el próximo login debe limpiar el estado

    _limpiarEstadoGlobal();
    _mostrarWelcomePanel(true);

    document.getElementById('appContainer').style.display = 'none';
    document.getElementById('loginModal').style.display   = 'flex';
    goToStep(1);
    document.getElementById('phoneInput').value = '';
}

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
// WEBSOCKET
// ============================================================
let reconnectInterval = 500;
let _esSesionNueva = true; // true en login fresco, false en reconexión automática
let reconnectTimer = null;

function conectarWS() {

    // 🚫 Evitar múltiples conexiones
    if (socket && (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
    )) {
        return;
    }

    username = loginUsername;
    pedirPermisoNotificaciones();

    const wsProtocol = location.protocol === 'https:' ? 'wss://' : 'ws://';
    const wsHost     = location.host;

    socket = new WebSocket(wsProtocol + wsHost);

    socket.onopen = () => {
        console.log('✅ Conectado');

        conectado = true;
        reconnectInterval = 500; // reset
        _mostrarBannerOffline(false); // ocultar banner offline al reconectar
        window._kvsJoinTimestamp = Date.now(); // marcar el momento del join
        // Inicializar flag de presencia según el estado actual del documento
        window._appIsAway = (document.visibilityState === 'hidden');

        // Capturar si es sesión nueva ANTES de modificar el flag
        const _fueNuevaSesion = _esSesionNueva;

        if (_esSesionNueva) {
            // ── Login fresco: limpiar TODO el estado del usuario anterior ──
            _limpiarEstadoGlobal();
            _esSesionNueva = false; // próximas reconexiones no limpian
        } else {
            // ── Reconexión automática: solo invalidar caché de mensajes ──
            Object.keys(conversations).forEach(k => delete conversations[k]);
        }

        // Guardar el chat que estaba abierto para reabrirlo tras reconectar
        // (solo relevante en reconexión; en login fresco _limpiarEstadoGlobal ya borró currentChat)
        const _chatAnterior = currentChat;

        socket.send(JSON.stringify({
            type: 'join',
            username,
            phone: loginPhone,
            avatar: myAvatarDataUrl,
            deviceInfo: (() => {
                const ua = navigator.userAgent;
                if (/iPhone/.test(ua))  return 'iPhone';
                if (/iPad/.test(ua))    return 'iPad';
                if (/Android/.test(ua)) return 'Android';
                if (/Macintosh/.test(ua)) return 'Mac';
                if (/Windows/.test(ua)) return 'Windows';
                if (/Linux/.test(ua))   return 'Linux';
                return 'Dispositivo desconocido';
            })()
        }));

        // Si había un chat abierto y es una RECONEXIÓN (no login fresco), recargar historial
        if (_chatAnterior && !_fueNuevaSesion) {
            setTimeout(() => {
                if (!currentChat || !socket || socket.readyState !== WebSocket.OPEN) return;
                if (currentChat.startsWith('group_')) {
                    socket.send(JSON.stringify({ type: 'loadGroupConversation', groupId: currentChat.replace('group_', '') }));
                } else if (currentChat.startsWith('phone:')) {
                    socket.send(JSON.stringify({ type: 'loadConversation', withPhone: currentChat.replace('phone:', '') }));
                } else {
                    socket.send(JSON.stringify({ type: 'loadConversation', with: currentChat }));
                }
            }, 400);
        }

        // Informar presencia inicial (puede haberse conectado desde background)
        if (document.visibilityState === 'hidden') {
            socket.send(JSON.stringify({ type: 'set_presence', status: 'away' }));
        } else {
            // Iniciar heartbeat JS inmediatamente
            _iniciarHeartbeat();
        }

        input.disabled = false;
        input.focus();
        document.getElementById('btnMic').style.display = 'flex';

        cargarContactos();
        cargarGrupos();
        cargarConfiguracionUsuario();

        // Suscribir (o renovar suscripción) al push tras conectar
        _suscribirAPush().catch(() => {});

        // Si venimos de una notificación push con chat pendiente, abrirlo
        // en cuanto hayan cargado los contactos/grupos (sin timeout fijo)
        if (window._pendingOpenChat) {
            _abrirChatPendienteDesdeNotif();
        }
    };

    socket.onmessage = (event) => {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch(e) {
            console.warn('[WS] Mensaje JSON inválido:', e.message);
            return;
        }
        handleMessage(data);
    };

    socket.onerror = (error) => {
        console.warn('⚠️ Error WebSocket:', error);
    };

    socket.onclose = () => {
        console.log('❌ Desconectado');
        conectado = false;
        _pararHeartbeat();
        _mostrarBannerOffline(true);
        // Solo programar reconexión automática si la app está visible.
        // Si está en background, el visibilitychange lo hará al volver.
        if (document.visibilityState !== 'hidden') {
            intentarReconexion();
        }
    };
}

// ── Heartbeat JS: envía kvs_ping cada 15s mientras la app está en primer plano ──
// El servidor marca al usuario como "ausente" si no recibe ping en 25s,
// y como "desconectado" si no recibe ping en 55s.
// Esto es mucho más fiable que el TCP ping/pong porque solo el JS activo puede enviarlo.
let _heartbeatTimer = null;
const PING_INTERVAL = 15000; // 15s

function _iniciarHeartbeat() {
    _pararHeartbeat(); // limpiar cualquier timer previo
    _heartbeatTimer = setInterval(() => {
        if (socket && socket.readyState === WebSocket.OPEN
            && document.visibilityState !== 'hidden') {
            try {
                socket.send(JSON.stringify({ type: 'kvs_ping' }));
            } catch(_) {}
        }
    }, PING_INTERVAL);
    // Enviar uno inmediatamente para resetear el timer del servidor
    if (socket && socket.readyState === WebSocket.OPEN) {
        try { socket.send(JSON.stringify({ type: 'kvs_ping' })); } catch(_) {}
    }
}

function _pararHeartbeat() {
    if (_heartbeatTimer) {
        clearInterval(_heartbeatTimer);
        _heartbeatTimer = null;
    }
}
function intentarReconexion() {
    if (reconnectTimer) return;

    reconnectTimer = setTimeout(() => {
        console.log('🔄 Intentando reconectar...');
        reconnectTimer = null;
        reconnectInterval = Math.min(reconnectInterval * 1.5, 5000);
        conectarWS();
    }, reconnectInterval);
}

// ── Helper: actualiza el chatStatus del chat abierto cuando cambia presencia ──
function _formatLastSeen(isoDate) {
    if (!isoDate) return null;
    const d = new Date(isoDate);
    if (isNaN(d)) return null;
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    const diffH   = Math.floor(diffMs / 3600000);
    const diffD   = Math.floor(diffMs / 86400000);
    if (diffMin < 1)  return 'visto hace un momento';
    if (diffMin < 60) return `visto hace ${diffMin} min`;
    if (diffH < 24)   return `visto hoy a las ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
    if (diffD === 1)  return `visto ayer a las ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
    return `visto el ${d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })} a las ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
}

function _actualizarChatStatusPresencia() {
    if (!currentChat || currentChat.startsWith('group_')) return;
    let targetUsername = currentChat;
    if (currentChat.startsWith('phone:')) {
        const ph = currentChat.replace('phone:', '');
        targetUsername = window._phoneToUsername ? window._phoneToUsername[ph] : null;
        if (!targetUsername) return;
    }
    const isOnline = lastKnownUsers.includes(targetUsername);
    const isAway   = isOnline && window._awayUsers && window._awayUsers.has(targetUsername);
    let statusText, statusColor;
    if (isOnline && !isAway) {
        statusText  = '● En línea';
        statusColor = 'var(--online)';
    } else if (isAway) {
        statusText  = '🌙 Ausente';
        statusColor = '#f59e0b';
    } else {
        // Mostrar "última vez visto" si lo tenemos
        const lastSeen = userLastSeen[targetUsername];
        statusText  = lastSeen ? _formatLastSeen(lastSeen) : '○ Desconectado';
        statusColor = 'var(--text-muted)';
    }
    document.getElementById('chatStatus').textContent = statusText;
    document.getElementById('chatStatus').style.color = statusColor;
}

// ── Reconexión limpia + reporte de presencia al volver de background ──────────
// Al pasar a background:  parar heartbeat + notificar al servidor estado 'away'.
// Al volver al foreground: reanudar heartbeat + notificar 'active'.
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        // App va a background → parar heartbeat y marcar ausente
        window._appIsAway = true;
        _pararHeartbeat();
        if (socket && socket.readyState === WebSocket.OPEN) {
            try {
                socket.send(JSON.stringify({ type: 'set_presence', status: 'away' }));
            } catch(_) {}
        }
    } else {
        // App vuelve al foreground
        window._appIsAway = false;
        console.log('👀 Usuario volvió → reconexión limpia');

        // Si hay un chat activo, marcar sus mensajes como leídos ahora que el usuario los ve
        if (currentChat && socket && socket.readyState === WebSocket.OPEN) {
            try {
                const mkKey = currentChat.startsWith('phone:')
                    ? (window._phoneToUsername && window._phoneToUsername[currentChat.replace('phone:', '')]) || currentChat
                    : currentChat;
                socket.send(JSON.stringify({ type: 'markRead', chatKey: mkKey }));
            } catch(_) {}
        }

        // 1. Cancelar timer de reconexión pendiente
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }

        // 2. Si el socket no está OPEN, cerrarlo silenciosamente y reconectar
        if (socket && socket.readyState !== WebSocket.OPEN) {
            socket.onclose = null;
            socket.onerror = null;
            try { socket.close(); } catch(_) {}
            socket = null;
        }

        reconnectInterval = 500;

        if (socket && socket.readyState === WebSocket.OPEN) {
            // Socket sigue vivo → reanudar heartbeat y marcar activo
            try {
                socket.send(JSON.stringify({ type: 'set_presence', status: 'active' }));
            } catch(_) {}
            _iniciarHeartbeat();
        } else {
            // Socket muerto → reconectar (el onopen iniciará el heartbeat)
            conectarWS();
        }
    }
});

window.addEventListener('online', () => {
    console.log('🌐 Internet volvió');
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    if (socket && socket.readyState !== WebSocket.OPEN) {
        socket.onclose = null;
        socket.onerror = null;
        try { socket.close(); } catch(_) {}
        socket = null;
    }
    reconnectInterval = 500;
    conectarWS();
});

// ============================================================
// EMOJI PICKER
// ============================================================
emojiPicker.addEventListener('emoji-click', (e) => {
    const emoji = e.detail.unicode;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const before = input.value.slice(0, start);
    const after = input.value.slice(end);
    input.value = before + emoji + after;
    input.selectionStart = input.selectionEnd = start + emoji.length;
    input.focus();
    actualizarBtnEnviar();
});

function toggleEmoji() {
    // El emoji picker está ahora integrado en el panel unificado — abrir en pestaña emojis
    if (_sgOpen && _sgTab === 'emojis') {
        cerrarSGPanel();
    } else {
        _sgTab = 'emojis';
        _sgOpen = false; // forzar apertura limpia
        toggleStickerGiftPanel(null);
    }
}

// (El cierre del panel unificado lo gestiona el listener global en renderSGPanel)

// ============================================================
// IMAGEN
// ============================================================
// ── Comprimir imagen antes de enviarla ──────────────────────────────────────
// Redimensiona al máximo 1200px y comprime al 82% JPEG con Canvas.
// No requiere librerías externas. Si la imagen ya es pequeña, no la agranda.
function comprimirImagen(file, callback) {
    const MAX_PX   = 1200;
    const QUALITY  = 0.82;
    const reader   = new FileReader();
    reader.onload  = (ev) => {
        const img  = new Image();
        img.onload = () => {
            let { width, height } = img;
            // Solo reducir, nunca agrandar
            if (width > MAX_PX || height > MAX_PX) {
                const ratio = Math.min(MAX_PX / width, MAX_PX / height);
                width  = Math.round(width  * ratio);
                height = Math.round(height * ratio);
            }
            const canvas = document.createElement('canvas');
            canvas.width  = width;
            canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);
            callback(dataUrl);
        };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
}

function seleccionarImagen(event) {
    const file = event.target.files[0];
    if (!file) return;
    comprimirImagen(file, (dataUrl) => {
        pendingImage = { dataUrl, file };
        imgPreviewEl.src = dataUrl;
        document.getElementById('imgPreviewName').textContent = file.name;
        imgPreviewContainer.classList.add('visible');
        actualizarBtnEnviar();
    });
}

document.addEventListener('paste', (e) => {
    if (!conectado || !currentChat) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let item of items) {
        if (item.type.startsWith('image/')) {
            const file = item.getAsFile();
            comprimirImagen(file, (dataUrl) => {
                pendingImage = { dataUrl, file };
                imgPreviewEl.src = dataUrl;
                document.getElementById('imgPreviewName').textContent = 'Imagen del portapapeles';
                imgPreviewContainer.classList.add('visible');
                actualizarBtnEnviar();
            });
            break;
        }
    }
});

function cancelarImagen() {
    pendingImage = null;
    imgPreviewContainer.classList.remove('visible');
    document.getElementById('fileInput').value = '';
    actualizarBtnEnviar();
}

// ============================================================
// LIGHTBOX
// ============================================================
function openLightbox(src) {
    document.getElementById('lightboxImg').src = src;
    document.getElementById('lightbox').classList.add('visible');
}

function closeLightbox() {
    document.getElementById('lightbox').classList.remove('visible');
}

// ============================================================
// UTILS
// ============================================================
function horaActual(date) {
    return new Date(date || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function obtenerDia(date) {
    const d = new Date(date);
    const hoy = new Date();
    return d.toDateString() === hoy.toDateString() ? 'Hoy' : d.toLocaleDateString();
}

function _actualizarIndicadorPaginacion() {
    const el = document.getElementById('historyLoadingIndicator');
    if (!el) return;
    // Mostrar el indicador de "scroll para cargar más" solo si hay mensajes anteriores
    el.style.display = _historyHasMore ? 'flex' : 'none';
    el.textContent   = _historyHasMore ? '⬆ Cargando mensajes anteriores…' : '';
}

function scrollChat() {
    chat.scrollTop = chat.scrollHeight;
}

let _scrollRafId = null;
chat.addEventListener('scroll', () => {
    if (_scrollRafId) return;
    _scrollRafId = requestAnimationFrame(() => {
        autoScroll = (chat.scrollHeight - chat.scrollTop - chat.clientHeight) < 50;

        // Scroll infinito hacia arriba: cuando el usuario llega al top, cargar página anterior
        if (chat.scrollTop < 80 && _historyHasMore && !_historyLoading && _historyOldestId && socket && socket.readyState === WebSocket.OPEN) {
            _cargarHistorialAnterior();
        }

        _scrollRafId = null;
    });
}, { passive: true });

function _cargarHistorialAnterior() {
    if (_historyLoading || !_historyHasMore || !_historyOldestId) return;
    _historyLoading = true;
    // Mostrar indicador de carga al top
    const loadingEl = document.getElementById('historyLoadingIndicator');
    if (loadingEl) loadingEl.style.display = 'flex';

    if (currentChat && currentChat.startsWith('group_')) {
        socket.send(JSON.stringify({
            type:     'loadGroupConversation',
            groupId:  currentChat.replace('group_', ''),
            beforeId: _historyOldestId
        }));
    } else if (currentChat && currentChat.startsWith('phone:')) {
        socket.send(JSON.stringify({
            type:      'loadConversation',
            withPhone: currentChat.replace('phone:', ''),
            beforeId:  _historyOldestId
        }));
    } else if (currentChat) {
        socket.send(JSON.stringify({
            type:     'loadConversation',
            with:     currentChat,
            beforeId: _historyOldestId
        }));
    }
}

function actualizarBtnEnviar() {
    // Habilitado si: hay texto, hay imagen pendiente, o estamos editando con texto
    btnEnviar.disabled = (input.value.trim() === '' && !pendingImage && !_editState);
}

// ============================================================
// MANEJADOR MENSAJES WEBSOCKET
// ============================================================
function handleMessage(data) {

    if (data.type === 'history') {
        const chatKey = currentChat;
        const isLoadMore = !!data.isLoadMore;

        // Ocultar indicador de carga
        _historyLoading = false;
        const loadingEl = document.getElementById('historyLoadingIndicator');
        if (loadingEl) loadingEl.style.display = 'none';

        // Actualizar paginación
        _historyHasMore = !!data.hasMore;
        if (data.messages && data.messages.length > 0) {
            _historyOldestId = data.messages[0].id;
        }

        // Obtener lista de mensajes ocultos localmente
        let _hiddenMsgs;
        try { _hiddenMsgs = new Set(JSON.parse(localStorage.getItem('kvs_hidden_msgs') || '[]')); }
        catch(_) { _hiddenMsgs = new Set(); }

        if (!isLoadMore) {
            // Primera carga: reemplazar todo el historial
            // (incluye el caso donde el array existía con __onlyPending = true)
            conversations[chatKey] = data.messages;
            // Limpiar el flag __onlyPending ya que ahora tenemos el historial completo
            delete conversations[chatKey].__onlyPending;
            if (data.withUsername && currentChat.startsWith('phone:')) {
                conversations[data.withUsername] = data.messages;
            }
            chat.innerHTML = '';
            let lastDay = '';
            window._kvsLoadingHistory = true;
            data.messages.forEach(msg => {
                if (_hiddenMsgs.has(msg.id)) return;
                const day = obtenerDia(msg.time);
                if (day !== lastDay) { addDaySeparator(day); lastDay = day; }
                addMessage(msg);
            });
            window._kvsLoadingHistory = false;
            // Mostrar indicador de "más mensajes" al top si hay paginación
            _actualizarIndicadorPaginacion();
            // Informar al servidor que hemos leído esta conversación
            // (marca en BD + notifica a los remitentes + resetea contador push)
            if (socket && socket.readyState === WebSocket.OPEN && chatKey) {
                const markKey = chatKey.startsWith('phone:')
                    ? (window._phoneToUsername && window._phoneToUsername[chatKey.replace('phone:', '')])
                        || chatKey
                    : chatKey;
                try { socket.send(JSON.stringify({ type: 'markRead', chatKey: markKey })); } catch(_) {}
            }
            // Actualizar badge inmediatamente tras cargar el historial
            renderContactsList();
            renderGroupsList();
        } else {
            // Load more: PREPEND mensajes al inicio, conservando posición de scroll
            if (!conversations[chatKey]) conversations[chatKey] = [];
            conversations[chatKey].unshift(...data.messages);

            const scrollHeightBefore = chat.scrollHeight;
            const scrollTopBefore    = chat.scrollTop;

            // Crear un contenedor temporal, renderizar ahí, luego mover al inicio
            const tempList = document.createElement('ul');
            tempList.style.display = 'none';
            document.body.appendChild(tempList);

            // Guardar y redirigir temporalmente el chat target
            const realChat = chat;
            // Monkey-patch appendChild para redirigir a tempList
            const origAppendChild  = realChat.appendChild.bind(realChat);
            const origInsertBefore = realChat.insertBefore.bind(realChat);
            realChat.appendChild  = (n) => tempList.appendChild(n);
            realChat.insertBefore = (n, ref) => tempList.insertBefore(n, ref);

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
                addMessage(msg);
            });
            window._kvsLoadingHistory = false;

            // Restaurar métodos originales
            realChat.appendChild  = origAppendChild;
            realChat.insertBefore = origInsertBefore;

            // Mover los nodos renderizados al inicio del chat real
            const nodes = [...tempList.childNodes];
            nodes.reverse().forEach(n => {
                realChat.insertBefore(n, realChat.firstChild);
            });
            document.body.removeChild(tempList);

            // Restaurar posición de scroll para que no salte
            chat.scrollTop = scrollTopBefore + (chat.scrollHeight - scrollHeightBefore);

            _actualizarIndicadorPaginacion();
        }
        return;
    }

    if (data.type === 'message') {
        // Ignorar mensajes de llamada perdida aquí — se tratan por separado
        if (data.message === '__missed_call__') {
            mostrarLlamadaPerdida(data);
            return;
        }

        // Mensajes de hilo: se gestionan por thread_message, ignorar aquí
        if (data.threadId) return;

        // isEcho: true  → el servidor confirma que NOSOTROS enviamos este mensaje
        // isEcho: false → mensaje recibido DE otro usuario
        // Para compatibilidad con mensajes del historial (sin isEcho), usar from===username como fallback
        const isOwnMsg = data.isEcho === true || (data.isEcho === undefined && data.from === username);

        let otherUser = isOwnMsg ? data.to : (data.to === username ? data.from : null);
        // Fallback: si to no coincide con username pero from coincide, es eco
        if (!otherUser && data.from === username) { otherUser = data.to; }
        if (!otherUser) return;

        // Actualizar caché de avatar del remitente
        if (data.avatar && !isOwnMsg) {
            userAvatars[data.from] = data.avatar;
            if (window._phoneToUsername) {
                const senderPhone = Object.entries(window._phoneToUsername).find(([ph, un]) => un === data.from)?.[0];
                if (senderPhone && myContacts.has(senderPhone)) {
                    const c = myContacts.get(senderPhone);
                    c.avatar = data.avatar;
                    myContacts.set(senderPhone, c);
                    userAvatars['__phone__' + senderPhone] = data.avatar;
                }
            }
        }

        // Determinar el chatKey
        let chatKey = otherUser;
        if (window._phoneToUsername) {
            const phone = Object.entries(window._phoneToUsername).find(([ph, un]) => un === otherUser)?.[0];
            if (phone && currentChat === 'phone:' + phone) {
                chatKey = 'phone:' + phone;
            }
        }

        if (!conversations[chatKey]) {
            conversations[chatKey] = [];
            // __onlyPending solo para mensajes entrantes de otro usuario en ventana de join
            if (!isOwnMsg &&
                window._kvsJoinTimestamp && (Date.now() - window._kvsJoinTimestamp) < 4000) {
                conversations[chatKey].__onlyPending = true;
            }
        }
        if (!conversations[otherUser]) conversations[otherUser] = conversations[chatKey];

        // Gestión del array: evitar duplicados y sustituir local_ por ID real
        if (!conversations[chatKey].some(m => m.id === data.id)) {
            if (isOwnMsg) {
                // Eco propio: buscar local_ coincidente y sustituir
                const localIdx = conversations[chatKey].findIndex(m =>
                    typeof m.id === 'string' && m.id.startsWith('local_') && (
                        (data.imageData  && m.imageData)  ||
                        (data.audioData  && m.audioData)  ||
                        (!data.imageData && !data.audioData && (m.message || '') === (data.message || ''))
                    )
                );
                if (localIdx >= 0) {
                    if (conversations[chatKey][localIdx].editedAt && !data.editedAt) {
                        data.editedAt = conversations[chatKey][localIdx].editedAt;
                    }
                    conversations[chatKey][localIdx] = { ...data, delivered: true };
                } else {
                    conversations[chatKey].push(data);
                }
            } else {
                conversations[chatKey].push(data);
            }
        }

        const preview = data.imageData ? '📷 Imagen'
            : data.audioData ? '🎙️ Audio'
            : data.message;
        lastMessages[chatKey]   = preview;
        lastMessages[otherUser] = preview;

        // Registrar actividad reciente del contacto para ordenación
        if (!isOwnMsg) {
            window._contactLastActivity = window._contactLastActivity || {};
            if (window._phoneToUsername) {
                const senderPhone = Object.entries(window._phoneToUsername).find(([ph, un]) => un === data.from)?.[0];
                if (senderPhone) window._contactLastActivity[senderPhone] = Date.now();
            }
        }

        if (currentChat === chatKey || currentChat === otherUser) {
            // Limpiar contador de no leídos y notificaciones push ya que el chat está activo
            if (!isOwnMsg) {
                unreadCounts[chatKey]   = 0;
                unreadCounts[otherUser] = 0;
                if (window._phoneToUsername) {
                    const phone = Object.entries(window._phoneToUsername).find(([,un]) => un === data.from)?.[0];
                    if (phone) {
                        unreadCounts['phone:' + phone] = 0;
                        unreadCounts[phone] = 0;
                    }
                }
                _cerrarNotificacionesDeChat(chatKey);
            }
            if (isOwnMsg) {
                // Eco propio: actualizar el local_ en el DOM con el ID real
                const localRows = [...chat.querySelectorAll('.msg-row.me[data-msgid^="local_"]')];
                let matchedRow = null;
                for (const lr of localRows) {
                    const bubble = lr.querySelector('.bubble');
                    if (!bubble) continue;
                    const textEl = bubble.querySelector('.msg-text');
                    const imgEl  = bubble.querySelector('.img-msg');
                    const rowHasImg = !!imgEl;
                    let rowText = '';
                    if (textEl) {
                        const cloned = textEl.cloneNode(true);
                        cloned.querySelectorAll('.reply-preview,.forward-label,.meta,.edited-label,.star-badge,.estado,.hora,.audio-msg-wrap').forEach(el => el.remove());
                        rowText = cloned.textContent.trim();
                    }
                    if (data.imageData && rowHasImg) { matchedRow = lr; break; }
                    if (data.audioData && bubble.querySelector('.audio-msg-wrap')) { matchedRow = lr; break; }
                    if (!data.imageData && !data.audioData && rowText === (data.message || '').trim()) { matchedRow = lr; break; }
                }
                // Fallback: último local_ si no hay match por contenido
                if (!matchedRow && localRows.length > 0) {
                    matchedRow = localRows[localRows.length - 1];
                }
                if (matchedRow) {
                    const oldLocalId = matchedRow.dataset.msgid;
                    matchedRow.dataset.msgid = data.id;
                    const bubble = matchedRow.querySelector('.bubble');
                    if (bubble) bubble.id = data.id;
                    const estadoEl = bubble ? bubble.querySelector(`#estado_${oldLocalId}`) : null;
                    if (estadoEl) estadoEl.id = `estado_${data.id}`;
                    // Actualizar el id en todos los arrays de conversations
                    for (const arr of Object.values(conversations)) { if (!Array.isArray(arr)) continue;
                        if (!Array.isArray(arr)) continue;
                        const localIdx = arr.findIndex(m => m.id === oldLocalId);
                        if (localIdx >= 0) {
                            if (arr[localIdx].editedAt && !data.editedAt) {
                                data.editedAt = arr[localIdx].editedAt;
                            }
                            arr[localIdx].id        = data.id;
                            arr[localIdx].delivered = true;
                            if (data.read) arr[localIdx].read = true;
                            const dupIdx = arr.findIndex((m, i) => i !== localIdx && m.id === data.id);
                            if (dupIdx >= 0) arr.splice(dupIdx, 1);
                        } else {
                            // El local_ ya fue sustituido en el array: actualizar estado por ID real
                            const realIdx = arr.findIndex(m => m.id === data.id);
                            if (realIdx >= 0) {
                                arr[realIdx].delivered = true;
                                if (data.read) arr[realIdx].read = true;
                            }
                        }
                    }
                    // Aplicar estado correcto si read/delivered llegaron antes del eco
                    if (data.read) {
                        if (estadoEl) estadoEl.textContent = '✔✔ leído';
                    } else if (data.delivered) {
                        if (estadoEl) estadoEl.textContent = '✔✔';
                    }
                    _attachBubbleClickMenu(matchedRow, data.id, true, false,
                        currentChat.startsWith('group_'));

                    // Si había una eliminación pendiente para este mensaje local, enviarla ahora
                    if (window._pendingDeletes && window._pendingDeletes[oldLocalId]) {
                        delete window._pendingDeletes[oldLocalId];
                        if (socket && socket.readyState === WebSocket.OPEN) {
                            socket.send(JSON.stringify({ type: 'deleteMessage', id: data.id }));
                        }
                        const rowStill = document.querySelector(`[data-msgid="${data.id}"]`);
                        if (rowStill) rowStill.remove();
                        Object.values(conversations).forEach(arr => { if (!Array.isArray(arr)) return;
                            if (!Array.isArray(arr)) return;
                            const idx = arr.findIndex(m => m.id === data.id);
                            if (idx >= 0) arr.splice(idx, 1);
                        });
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
                    // No hay local_ en el DOM: solo añadir si no está ya renderizado
                    const yaRenderizado = !!document.querySelector(`[data-msgid="${data.id}"]`);
                    if (!yaRenderizado) addMessage(data);
                }
            } else {
                addMessage(data);
            }
        } else {
            // Chat no activo: solo contar no leídos para mensajes de otros
            if (!isOwnMsg) {
                unreadCounts[chatKey] = (unreadCounts[chatKey] || 0) + 1;
                playNotifSound();
                mostrarNotificacion(data.from, preview);
            }
        }
        renderUsers(lastKnownUsers);
        renderContactsList();
        _actualizarChatStatusPresencia();
        return;
    }

    if (data.type === 'users') {
        // data.online es array de {username, avatar, phone, isAway}
        window._phoneToUsername = window._phoneToUsername || {};
        window._onlinePhones    = new Set();
        window._awayUsers       = window._awayUsers || new Set();
        window._awayUsers.clear();
        const list = data.online.map(u => {
            if (typeof u === 'object') {
                if (u.avatar && u.username) userAvatars[u.username] = u.avatar;
                if (u.phone && u.username) {
                    window._phoneToUsername[u.phone] = u.username;
                    window._onlinePhones.add(u.phone);
                }
                if (u.isAway && u.username) window._awayUsers.add(u.username);
                return u.username || null;
            }
            return u || null;
        // Eliminar entradas nulas, vacías o que no sean strings válidos
        }).filter(u => u && typeof u === 'string' && u.trim() !== '');
        lastKnownUsers = list;
        renderUsers(list);
        renderContactsList(); // actualizar estado online de contactos
        // Actualizar chatStatus si el chat activo es con alguien cuyo estado cambió
        _actualizarChatStatusPresencia();
        return;
    }

    if (data.type === 'typing') {
        if (data.username === username) return;
        if (currentChat !== data.username) return;
        if (data.status === 'stop') {
            typingDiv.classList.remove('visible');
        } else {
            typingText.textContent = `${data.username} está escribiendo`;
            typingDiv.classList.add('visible');
        }
        return;
    }
    if (data.type === 'recording') {
        if (data.username === username) return;
        if (currentChat !== data.username) return;
        if (data.status === 'stop') {
            typingDiv.classList.remove('visible');
        } else {
            typingText.textContent = `${data.username} está grabando audio 🎙️`;
            typingDiv.classList.add('visible');
        }
        return;
    }

    if (data.type === 'delivered') {
        updateEstado(data.id, '✔✔');
        // Actualizar en caché — buscar también en mensajes aún con id local_
        for (const arr of Object.values(conversations)) { if (!Array.isArray(arr)) continue;
            if (!Array.isArray(arr)) continue;
            const m = arr.find(m => m.id === data.id);
            if (m) { m.delivered = true; }
        }
        return;
    }
    if (data.type === 'read') {
        updateEstado(data.id, '✔✔ leído');
        // Actualizar en caché — ya lo hace updateEstado pero dejamos esto para seguridad
        for (const arr of Object.values(conversations)) { if (!Array.isArray(arr)) continue;
            if (!Array.isArray(arr)) continue;
            const m = arr.find(m => m.id === data.id);
            if (m) { m.read = true; m.delivered = true; }
        }
        return;
    }
    if (data.type === 'info') {
        const infoText = data.message || '';
        const esSistema = /se ha unido al chat|sali[oó] del chat/.test(infoText);
        if (!esSistema) addInfo(infoText);
        return;
    }
    if (data.type === 'kvs_pong')  { return; } // respuesta al heartbeat, ignorar

    // ── Acciones sobre mensajes ──────────────────────────────────────────
    if (data.type === 'message_edited') {
        onMensajeEditado(data.id, data.newText, data.editedAt);
        // También actualizar en el panel del hilo si está abierto
        _onThreadMsgEditado(data.id, data.newText);
        return;
    }
    if (data.type === 'message_deleted') {
        onMensajeEliminado(data.id);
        // También actualizar en el panel del hilo si está abierto
        _onThreadMsgEliminado(data.id);
        return;
    }
    // Borrado en batch (deleteMessages optimizado)
    if (data.type === 'messages_deleted') {
        if (Array.isArray(data.ids)) {
            data.ids.forEach(id => {
                onMensajeEliminado(id);
                _onThreadMsgEliminado(id);
            });
        }
        return;
    }
    if (data.type === 'message_reaction') {
        onReaccionActualizada(data.id, data.reactions);
        return;
    }
    if (data.type === 'message_starred') {
        onMensajeDestacado(data.id, data.starred);
        return;
    }
    if (data.type === 'thread_message') {
        onMensajeHilo(data);
        return;
    }
    if (data.type === 'thread_history') {
        onHistorialHilo(data);
        return;
    }

    // ── WebRTC signaling ──
    if (data.type === 'call_offer')    { recibirLlamada(data); return; }
    if (data.type === 'call_answer')   { recibirRespuesta(data); return; }
    if (data.type === 'call_ice')      { recibirICE(data); return; }
    if (data.type === 'call_rejected') { llamadaRechazada(); return; }
    if (data.type === 'call_ended')    { llamadaTerminada(); return; }

    if (data.type === 'contactAdded') {
        onContactAdded(data.contactPhone, data.customName, data.avatar, data.username);
        return;
    }
    if (data.type === 'contactRemoved') {
        onContactRemoved(data.contactPhone);
        return;
    }
    if (data.type === 'contactBlocked') {
        // El bloqueo fue exitoso: marcar el contacto como bloqueado (NO eliminarlo de la lista)
        if (myContacts.has(data.contactPhone)) {
            const c = myContacts.get(data.contactPhone);
            c.blocked = true;
            myContacts.set(data.contactPhone, c);
        }
        renderContactsList();
        mostrarToast('Contacto bloqueado 🚫');
        return;
    }
    if (data.type === 'contactUnblocked') {
        // Desbloqueo exitoso: quitar flag blocked
        if (myContacts.has(data.contactPhone)) {
            const c = myContacts.get(data.contactPhone);
            c.blocked = false;
            myContacts.set(data.contactPhone, c);
        }
        renderContactsList();
        mostrarToast('Contacto desbloqueado ✅');
        return;
    }
    if (data.type === 'youWereUnblocked') {
        // El otro usuario nos desbloqueó: quitar flag blockedUs
        if (myContacts.has(data.byPhone)) {
            const c = myContacts.get(data.byPhone);
            c.blockedUs = false;
            myContacts.set(data.byPhone, c);
        }
        renderContactsList();
        return;
    }
    if (data.type === 'youWereBlocked') {
        // El otro usuario nos ha bloqueado: marcarlo en nuestra lista como que nos bloqueó
        if (myContacts.has(data.byPhone)) {
            const c = myContacts.get(data.byPhone);
            c.blockedUs = true;
            myContacts.set(data.byPhone, c);
        }
        renderContactsList();
        mostrarToast('⚠️ ' + data.byUsername + ' te ha bloqueado', true);
        return;
    }
    if (data.type === 'contactRenamed') {
        onContactRenamed(data.contactPhone, data.newName);
        return;
    }
    if (data.type === 'conversation_cleared') {
        onConversacionBorrada(data.conversationId);
        return;
    }
    if (data.type === 'auto_destruct_set') {
        _onAutoDestructSet(data.conversationId, data.seconds);
        return;
    }
    if (data.type === 'chat_archived') {
        _onChatArchivado(data.conversationId, data.archived);
        return;
    }
    if (data.type === 'group_read') {
        // Alguien leyó un mensaje de grupo — registrar y actualizar tick
        if (data.id && data.by) {
            _registrarGrupoLectura(data.id, data.by);
        }
        return;
    }
    if (data.type === 'audio_read') {
        // Alguien escuchó nuestro audio: mostrar indicador en la burbuja
        const bubble = document.getElementById(data.id);
        if (bubble) {
            const meta = bubble.querySelector('.meta');
            if (meta && !meta.querySelector('.audio-listened')) {
                const span = document.createElement('span');
                span.className = 'audio-listened';
                span.title = 'Escuchado';
                span.textContent = '🎧';
                meta.appendChild(span);
            }
        }
        // Actualizar en conversations[]
        for (const arr of Object.values(conversations)) { if (!Array.isArray(arr)) continue;
            const m = arr.find(m => m.id === data.id);
            if (m) { if (!m.audioReadBy) m.audioReadBy = []; if (!m.audioReadBy.includes(data.by)) m.audioReadBy.push(data.by); break; }
        }
        return;
    }
    if (data.type === 'user_last_seen') {
        // Un contacto se desconectó: guardar su lastSeen y actualizar el header si su chat está abierto
        if (data.username && data.lastSeen) {
            userLastSeen[data.username] = data.lastSeen;
            if (currentChat === data.username || (currentChat && currentChat.startsWith('phone:'))) {
                _actualizarChatStatusPresencia();
            }
        }
        return;
    }
    if (data.type === 'contactError') {
        // Puede ser error de addContact o de renameContact: reactivar ambos botones
        const addErrEl = document.getElementById('addContactError');
        if (addErrEl) addErrEl.textContent = 'Error: ' + data.message;
        const btnGuardar = document.getElementById('btnGuardarContacto');
        if (btnGuardar) btnGuardar.disabled = false;
        const btnRenombre = document.getElementById('btnGuardarRenombre');
        if (btnRenombre) btnRenombre.disabled = false;
        // Revertir contactos optimistas si los hay (para que vuelvan a "Conectados ahora")
        myContacts.forEach((c, phone) => {
            if (c._optimistic) myContacts.delete(phone);
        });
        renderContactsList();
        renderUsers(lastKnownUsers);
        mostrarToast('⚠ ' + (data.message || 'Error al agregar contacto'), true);
        return;
    }

    // ── Solicitudes de contacto ──────────────────────────────────────────
    if (data.type === 'contact_request') {
        mostrarSolicitudContacto(data);
        return;
    }
    if (data.type === 'contactRequestSent') {
        // Confirmación de que la solicitud se envió correctamente
        mostrarToast('Solicitud enviada ✓');
        return;
    }
    if (data.type === 'contactRequestError') {
        mostrarToast('⚠ ' + data.message, true);
        return;
    }
    if (data.type === 'contactRequestAccepted') {
        // La otra persona aceptó nuestra solicitud — ya tenemos el contactAdded pero avisamos
        mostrarToast(data.byUsername + ' aceptó tu solicitud ✓');
        return;
    }
    if (data.type === 'contactRequestRejected') {
        // Rechazo silencioso — solo mostramos un toast discreto
        mostrarToast(data.byUsername + ' no aceptó la solicitud');
        return;
    }

    // ── Sesión expulsada (mismo número en otro dispositivo) ──
    if (data.type === 'session_kicked') {
        if (socket) { socket.onclose = null; socket.close(); socket = null; }
        mostrarToast('⚠️ Autorizaste el acceso desde otro dispositivo. Cerrando sesión…', true);
        setTimeout(() => logout(), 2000);
        return;
    }

    // ── Solicitud de autorización de nueva sesión ──
    if (data.type === 'session_auth_request') {
        mostrarModalAutorizacionSesion(data.reqId, data.username, data.deviceInfo);
        return;
    }

    // ── El nuevo dispositivo está esperando aprobación ──
    if (data.type === 'session_waiting_approval') {
        mostrarPantallaEsperandoAprobacion(data.message);
        return;
    }

    // ── Sesión rechazada por el dispositivo activo ──
    if (data.type === 'session_rejected') {
        ocultarPantallaEsperandoAprobacion();
        mostrarErrorSesionRechazada(data.message);
        return;
    }

    // ── Sesión aprobada: completar el login ──
    if (data.type === 'session_approved') {
        ocultarPantallaEsperandoAprobacion();
        completarLoginTrasSesionAprobada();
        return;
    }

    // ── Grupos ──
    if (data.type === 'groupCreated') {
        onGroupCreated(data);
        return;
    }
    if (data.type === 'groupDeleted') {
        onGroupDeleted(data.groupId);
        return;
    }
    if (data.type === 'groupLeft') {
        onGroupDeleted(data.groupId);
        return;
    }
    if (data.type === 'groupMemberLeft') {
        const g = myGroups.get(data.groupId);
        if (g) {
            g.members = g.members.filter(m => m !== data.phone);
            if (data.newOwner) g.ownerPhone = data.newOwner;
            myGroups.set(data.groupId, g);
            // Añadir mensaje de info en el chat si estamos en ese grupo
            if (currentChat === 'group_' + data.groupId) {
                addInfo(`${data.username} abandonó el grupo.`);
            }
        }
        return;
    }
    if (data.type === 'groupMessage') {
        onGroupMessage(data);
        return;
    }
    if (data.type === 'groupHistory') {
        onGroupHistory(data);
        return;
    }
    if (data.type === 'groupError') {
        const errEl = document.getElementById('createGroupError');
        if (errEl) errEl.textContent = 'Error: ' + data.message;
        const editErrEl = document.getElementById('editGroupError');
        if (editErrEl) editErrEl.textContent = 'Error: ' + data.message;
        const editBtn = document.getElementById('btnGuardarEditarGrupo');
        if (editBtn) editBtn.disabled = false;
        return;
    }
    if (data.type === 'groupUpdated') {
        onGroupUpdated(data);
        return;
    }
    if (data.type === 'groupAvatarUpdated') {
        const grp = myGroups.get(data.groupId);
        if (grp) { grp.avatar = data.avatar; myGroups.set(data.groupId, grp); }
        // Actualizar header si es el grupo activo
        if (currentChat === 'group_' + data.groupId) actualizarHeaderGrupo(grp || { groupId: data.groupId, avatar: data.avatar, name: '' });
        renderGroupsList();
        return;
    }
    if (data.type === 'group_call_offer')    { recibirLlamadaGrupal(data); return; }
    if (data.type === 'group_call_answer')   { onGroupCallAnswer(data); return; }
    if (data.type === 'group_call_ice')      { onGroupCallIce(data); return; }
    if (data.type === 'group_call_rejected') { onGroupCallRejected(data); return; }
    if (data.type === 'group_call_ended')    { onGroupCallEnded(data); return; }
}

let lastKnownUsers = [];

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
// SELECCIONAR USUARIO
// ============================================================
// Limpia todos los estados transitorios al cambiar de chat
function _mostrarWelcomePanel(visible) {
    const wp = document.getElementById('welcomePanel');
    if (!wp) return;
    if (visible) {
        wp.classList.remove('hidden');
    } else {
        wp.classList.add('hidden');
    }
}

function _limpiarEstadoChat() {
    // Cerrar menú contextual abierto
    cerrarMenuMensaje();
    // Salir del modo selección si estaba activo
    salirModoSeleccion();
    // Resetear paginación
    _historyHasMore  = false;
    _historyLoading  = false;
    _historyOldestId = null;
    // Cancelar edición o respuesta activa sin pedir confirmación
    if (_editState || _replyState) {
        _editState  = null;
        _replyState = null;
        input.value = '';
        input.style.height = 'auto';
        btnEnviar.onclick = enviar;
        btnEnviar.disabled = true;
        document.getElementById('replyBar').classList.remove('visible');
        document.getElementById('replyBarName').textContent = '';
        document.getElementById('replyBarText').textContent = '';
    }
    // Cerrar panel de emojis/favoritos
    cerrarSGPanel();
    // Cerrar panel de hilo si está abierto
    if (_threadId) cerrarHilo();
}

function seleccionarUsuario(user) {
    if (!user) return;

    // ── Bloquear chat con desconocidos (el admin puede chatear con todos) ──
    const phoneOfUser = window._phoneToUsername
        ? Object.entries(window._phoneToUsername).find(([ph, un]) => un === user)?.[0]
        : null;
    const _isAdminUser = loginPhone && (loginPhone === '+34693001834' || loginPhone.endsWith('693001834'));
    if (phoneOfUser && !myContacts.has(phoneOfUser) && !_isAdminUser) return;

    if (currentChat === user) return;
    _limpiarEstadoChat();
    _mostrarWelcomePanel(false);
    currentChat = user;
    unreadCounts[user] = 0;
    // Limpiar también la clave phone: si existía
    if (window._phoneToUsername) {
        const phoneKey = Object.entries(window._phoneToUsername).find(([,un]) => un === user)?.[0];
        if (phoneKey) {
            unreadCounts['phone:' + phoneKey] = 0;
            unreadCounts[phoneKey] = 0;
        }
    }
    _actualizarBadgeGlobal();
    // Cerrar notificaciones de la bandeja del sistema para este chat
    _cerrarNotificacionesDeChat(user);
    // Actualizar botones de cabecera
    document.getElementById('btnArchiveChat').classList.toggle('active', _archivedChats.has(user));
    _actualizarBtnAutoDestruct();
    // Cerrar barra de búsqueda si estaba abierta
    if (_searchActive) toggleSearchBar();
    // Cerrar lista de menciones
    _cerrarMentionList();
    chat.innerHTML = '';

    // Check if this user is a contact and get custom name
    const phone = window._phoneToUsername
        ? Object.entries(window._phoneToUsername).find(([ph, un]) => un === user)?.[0]
        : null;
    const contact = phone ? myContacts.get(phone) : null;
    const displayName = contact ? contact.customName : user;

    document.getElementById('chatName').textContent = displayName;
    document.getElementById('chatName').style.color = '';
    document.getElementById('chatName').style.fontWeight = '';
    document.getElementById('chatName').style.fontSize = '';
    const av = document.getElementById('chatAvatar');
    av.src = userAvatars[user] || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(user)}`;
    av.style.display = 'block';

    // Mostrar teléfono del contacto si lo tenemos
    const chatPhoneEl = document.getElementById('chatPhone');
    if (phone) {
        chatPhoneEl.textContent = formatearTelefono(phone);
        chatPhoneEl.style.display = 'block';
    } else {
        chatPhoneEl.style.display = 'none';
    }

    // Ocultar avatar de grupo; configurar botón unificado para llamada 1:1
    document.getElementById('chatGroupAvatar').classList.remove('visible');

    // Restaurar placeholder normal
    input.placeholder = 'Escribe un mensaje...';
    input.disabled = false;
    document.getElementById('btnMic').style.display = 'flex';

    const isOnline = lastKnownUsers.includes(user);
    const isAway   = isOnline && window._awayUsers && window._awayUsers.has(user);
    let statusText, statusColor;
    if (isOnline && !isAway)  { statusText = '● En línea'; statusColor = 'var(--online)'; }
    else if (isAway)          { statusText = '🌙 Ausente'; statusColor = '#f59e0b'; }
    else {
        const ls = userLastSeen[user];
        statusText = ls ? _formatLastSeen(ls) : '○ Desconectado';
        statusColor = 'var(--text-muted)';
        // Fetch lastSeen from server if not cached
        if (!ls && phone) {
            fetch(`/api/user?phone=${encodeURIComponent(phone)}`)
                .then(r => r.ok ? r.json() : null)
                .then(u => {
                    if (u && u.lastSeen) {
                        userLastSeen[user] = u.lastSeen;
                        if (currentChat === user) _actualizarChatStatusPresencia();
                    }
                }).catch(() => {});
        }
    }
    document.getElementById('chatStatus').textContent = statusText;
    document.getElementById('chatStatus').style.color = statusColor;
    const btnU = document.getElementById('btnCallUnified');
    // El botón de llamada siempre está disponible en chats 1:1.
    // Si el contacto está offline, iniciarLlamada() deja una llamada perdida.
    btnU.disabled = false;
    btnU.dataset.mode = '1to1';
    btnU.title = isOnline ? 'Llamada de voz' : 'Llamar (dejará notificación de llamada perdida)';

    // Siempre pedir historial fresco al abrir un chat 1:1 para tener
    // los estados read/delivered actualizados desde la BD.
    delete conversations[user];
    socket.send(JSON.stringify({ type: 'loadConversation', with: user }));

    renderUsers(lastKnownUsers);
    renderContactsList();
    // Cerrar sidebar en móvil y tablet al seleccionar usuario
    if (window.innerWidth <= 900 || document.documentElement.classList.contains('is-mobile')) {
        const sidebar = document.getElementById('sidebar');
        if (sidebar.classList.contains('visible')) toggleSidebar();
        _pushChatState();
    }
}

// ============================================================
// SELECCIONAR CONTACTO OFFLINE (chatKey = 'phone:XXXXX')
// ============================================================
function seleccionarContactoOffline(phone) {
    const chatKey = 'phone:' + phone;
    if (currentChat === chatKey) return;
    _limpiarEstadoChat();
    _mostrarWelcomePanel(false);
    currentChat = chatKey;
    unreadCounts[chatKey] = 0;
    unreadCounts[phone] = 0;
    // Limpiar también por username si lo conocemos
    if (window._phoneToUsername && window._phoneToUsername[phone]) {
        unreadCounts[window._phoneToUsername[phone]] = 0;
    }
    _actualizarBadgeGlobal();
    // Cerrar notificaciones de la bandeja del sistema para este chat
    _cerrarNotificacionesDeChat(chatKey);
    chat.innerHTML = '';

    const contact = myContacts.get(phone);
    const displayName = contact ? contact.customName : phone;
    const seedName = contact ? (contact.username || contact.customName) : phone;
    const avatarUrl = contact
        ? (contact.avatar || userAvatars['__phone__' + phone] || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(seedName)}`)
        : `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(seedName)}`;

    document.getElementById('chatName').textContent = displayName;
    document.getElementById('chatName').style.color = '';
    document.getElementById('chatName').style.fontWeight = '';
    document.getElementById('chatName').style.fontSize = '';

    const av = document.getElementById('chatAvatar');
    av.src = avatarUrl;
    av.style.display = 'block';
    document.getElementById('chatGroupAvatar').classList.remove('visible');

    // Mostrar teléfono siempre en chats offline (tenemos el phone directamente)
    const chatPhoneEl = document.getElementById('chatPhone');
    chatPhoneEl.textContent = formatearTelefono(phone);
    chatPhoneEl.style.display = 'block';

    document.getElementById('chatStatus').textContent = '○ Desconectado';
    document.getElementById('chatStatus').style.color = 'var(--text-muted)';

    // Botón de llamada habilitado — al llamar a offline se guarda missed call
    const btnU = document.getElementById('btnCallUnified');
    btnU.disabled = false;
    btnU.dataset.mode = '1to1';
    btnU.dataset.phone = phone;  // guardar phone para la llamada a offline
    btnU.title = 'Llamar (dejará notificación de llamada perdida)';

    // Habilitar escritura
    input.disabled = false;
    input.placeholder = 'Escribe un mensaje… (se entregará al conectarse)';
    document.getElementById('btnMic').style.display = 'flex';

    renderContactsList();
    renderGroupsList();

    // Siempre pedir historial fresco al abrir un chat por phone para tener
    // los estados read/delivered actualizados desde la BD.
    delete conversations[chatKey];
    socket.send(JSON.stringify({ type: 'loadConversation', withPhone: phone }));

    if (window.innerWidth <= 900 || document.documentElement.classList.contains('is-mobile')) {
        const sidebar = document.getElementById('sidebar');
        if (sidebar.classList.contains('visible')) toggleSidebar();
        _pushChatState();
    }
}

// ============================================================
// ENVIAR MENSAJE
// ============================================================
function enviar() {
    // Si estamos en modo edición, delegar a guardarEdicion
    if (_editState) { guardarEdicion(); return; }

    const text = input.value.trim();
    if (!text && !pendingImage) return;
    if (!currentChat) return;

    // ── Bloquear envío a desconocidos en chat 1:1 (el admin puede enviar a todos) ──
    if (!currentChat.startsWith('group_') && !currentChat.startsWith('phone:')) {
        const chatPhone = window._phoneToUsername
            ? Object.entries(window._phoneToUsername).find(([ph, un]) => un === currentChat)?.[0]
            : null;
        const _isAdminSend = loginPhone && (loginPhone === '+34693001834' || loginPhone.endsWith('693001834'));
        if (chatPhone && !myContacts.has(chatPhone) && !_isAdminSend) return;
    }

    // ── Mensaje de grupo ──────────────────────────────
    if (currentChat.startsWith('group_')) {
        const groupId = currentChat.replace('group_', '');
        const grpChatKey = 'group_' + groupId;

        // Helper: añade mensaje local al conversations[] del grupo
        const _addLocalToGrpConversations = (localMsg) => {
            if (!conversations[grpChatKey]) conversations[grpChatKey] = [];
            conversations[grpChatKey].push(localMsg);
        };

        if (_replyState && _replyState.id) {
            const replySnap = { ..._replyState };
            socket.send(JSON.stringify({
                type: 'replyMessage',
                groupId,
                message: text || '',
                imageData: pendingImage ? pendingImage.dataUrl : undefined,
                replyToId: replySnap.id
            }));
            const localGrpReply = {
                id: 'local_' + Date.now(),
                from: username,
                to: groupId,
                groupId,
                message: text || '',
                imageData: pendingImage ? pendingImage.dataUrl : null,
                time: new Date(),
                avatar: myAvatarDataUrl,
                replyToId:   replySnap.id,
                replyToFrom: replySnap.from === 'Tú' ? username : replySnap.from,
                replyToText: replySnap.text
            };
            _addLocalToGrpConversations(localGrpReply);
            addGroupMessage(localGrpReply);
            if (pendingImage) cancelarImagen();
            cancelarRespuesta();
        } else if (pendingImage) {
            socket.send(JSON.stringify({ type: 'groupMessage', groupId, message: text || '', imageData: pendingImage.dataUrl }));
            const localGrpImg = { id: 'local_' + Date.now(), from: username, to: groupId, groupId, message: text || '', imageData: pendingImage.dataUrl, time: new Date(), avatar: myAvatarDataUrl };
            _addLocalToGrpConversations(localGrpImg);
            addGroupMessage(localGrpImg);
            cancelarImagen();
        } else {
            socket.send(JSON.stringify({ type: 'groupMessage', groupId, message: text }));
            const localGrpMsg = { id: 'local_' + Date.now(), from: username, to: groupId, groupId, message: text, time: new Date(), avatar: myAvatarDataUrl };
            _addLocalToGrpConversations(localGrpMsg);
            addGroupMessage(localGrpMsg);
        }
        input.value = '';
        input.style.height = 'auto';
        btnEnviar.disabled = true;
        cerrarSGPanel();
        return;
    }

    // ── Mensaje 1:1 (online o offline) ───────────────────────
    const isOfflineChat = currentChat.startsWith('phone:');
    const toPhone    = isOfflineChat ? currentChat.replace('phone:', '') : null;
    const toUsername = isOfflineChat ? null : currentChat;

    // Helper: añade un mensaje local al array conversations[] para que
    // iniciarEdicion() pueda encontrarlo antes de que llegue el eco del servidor.
    const _addLocalToConversations = (localMsg) => {
        const ck = toUsername || ('phone:' + toPhone);
        if (!conversations[ck]) conversations[ck] = [];
        conversations[ck].push(localMsg);
        if (toUsername && ck !== toUsername) {
            if (!conversations[toUsername]) conversations[toUsername] = conversations[ck];
        }
    };

    if (_replyState && _replyState.id) {
        const replySnap = { ..._replyState };
        socket.send(JSON.stringify({
            type: 'replyMessage',
            ...(toUsername ? { to: toUsername } : { toPhone }),
            message: text || '',
            imageData: pendingImage ? pendingImage.dataUrl : undefined,
            replyToId: replySnap.id
        }));
        const localReply = {
            id: 'local_' + Date.now(),
            from: username,
            to: toUsername || null,
            message: text || '',
            imageData: pendingImage ? pendingImage.dataUrl : null,
            time: new Date(),
            self: true,
            avatar: myAvatarDataUrl,
            replyToId:   replySnap.id,
            replyToFrom: replySnap.from === 'Tú' ? username : replySnap.from,
            replyToText: replySnap.text
        };
        _addLocalToConversations(localReply);
        addMessage(localReply);
        if (pendingImage) cancelarImagen();
        cancelarRespuesta();
    } else if (pendingImage) {
        socket.send(JSON.stringify({
            type: 'message',
            ...(toUsername ? { to: toUsername } : { toPhone }),
            message: text || '',
            imageData: pendingImage.dataUrl
        }));
        const localImg = { id: 'local_' + Date.now(), from: username, to: toUsername, toPhone, message: text || '', imageData: pendingImage.dataUrl, time: new Date(), self: true, avatar: myAvatarDataUrl };
        _addLocalToConversations(localImg);
        addMessage(localImg);
        cancelarImagen();
    } else {
        socket.send(JSON.stringify({
            type: 'message',
            ...(toUsername ? { to: toUsername } : { toPhone }),
            message: text
        }));
        const localMsg = { id: 'local_' + Date.now(), from: username, to: toUsername, toPhone, message: text, time: new Date(), self: true, avatar: myAvatarDataUrl };
        _addLocalToConversations(localMsg);
        addMessage(localMsg);
    }

    input.value = '';
    input.style.height = 'auto';
    btnEnviar.disabled = true;
    cerrarSGPanel();
    // Animación visual del botón enviar
    btnEnviar.style.transform = 'scale(0.85)';
    setTimeout(() => { btnEnviar.style.transform = ''; }, 150);
    // Feedback háptico en móvil
    _vibrarEnvio();
}

// ============================================================
// INPUT HANDLERS
// ============================================================
input.addEventListener('input', () => {
    actualizarBtnEnviar();
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    // Solo activar menciones en grupos
    if (currentChat && currentChat.startsWith('group_')) {
        _onInputMention();
    } else {
        _cerrarMentionList();
    }

    if (!socket || !currentChat) return;
    if (currentChat.startsWith('group_')) return; // no typing en grupos
    if (currentChat.startsWith('phone:')) return;  // no typing para contactos offline
    socket.send(JSON.stringify({ type: 'typing', to: currentChat, status: 'start' }));
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
        if (socket && socket.readyState === WebSocket.OPEN)
            socket.send(JSON.stringify({ type: 'typing', to: currentChat, status: 'stop' }));
    }, 1500);
});

input.addEventListener('keydown', (e) => {
    // Mention list intercepts arrow keys, Enter, Tab, Escape
    _onKeydownMention(e);
    if (e.defaultPrevented) return;
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        // enviar() ya detecta internamente si hay _editState activo
        enviar();
    }
});

// Cerrar mention list al hacer click fuera del input o del panel de menciones
document.addEventListener('click', (e) => {
    const list = document.getElementById('mentionList');
    if (!list || !list.classList.contains('visible')) return;
    if (!list.contains(e.target) && e.target !== input) {
        _cerrarMentionList();
    }
}, true);

// ============================================================
// ADD MESSAGE AL DOM
// ============================================================

// Adjunta el listener de click para el menú contextual a la burbuja de un mensaje.
// Click en la burbuja → abre/cierra el menú. Click en imagen → lightbox (no menú).
function _attachBubbleClickMenu(row, msgId, isMe, isDeleted, isGroup) {
    const bubble = row.querySelector('.bubble');
    if (!bubble) return;

    // Usar una propiedad en el elemento para guardar el handler y poder reemplazarlo.
    // Así si se llama de nuevo (al reemplazar local_ por id real) no acumulamos listeners.
    if (bubble._kvsMenuHandler) {
        bubble.removeEventListener('click', bubble._kvsMenuHandler);
    }

    // Si el mensaje está eliminado solo adjuntamos el handler si es propio
    // (para poder hacer "ocultar para mí")
    if (isDeleted && !isMe) {
        bubble._kvsMenuHandler = null;
        return;
    }

    const handler = (e) => {
        // En modo selección: seleccionar en lugar de abrir menú
        if (chat.classList.contains('chat-in-select-mode')) {
            if (bubble.classList.contains('deleted')) return;
            e.stopPropagation();
            _toggleSeleccion(msgId, row);
            return;
        }
        if (e.target.tagName === 'IMG' && e.target.classList.contains('img-msg')) return;
        if (e.target.closest('.msg-ctx-menu')) return;
        if (e.target.closest('.reply-preview')) return;
        e.stopPropagation();
        // Pasar isMe e isDeleted como señales — abrirMenuMensaje los recalcula del DOM internamente
        abrirMenuMensaje(e, msgId, isMe, isDeleted, isGroup);
    };

    bubble._kvsMenuHandler = handler;
    bubble.addEventListener('click', handler);

    // Checkbox de selección
    const check = row.querySelector('.msg-select-check');
    if (check && !check._kvsCheckHandler) {
        const checkHandler = (e) => {
            e.stopPropagation();
            if (bubble.classList.contains('deleted')) return;
            if (!chat.classList.contains('chat-in-select-mode')) {
                entrarModoSeleccion(msgId);
            } else {
                _toggleSeleccion(msgId, row);
            }
        };
        check._kvsCheckHandler = checkHandler;
        check.addEventListener('click', checkHandler);
    }
}

function _buildReactionsHtml(reactions, msgId) {
    if (!reactions || typeof reactions !== 'object') return '';
    const entries = reactions instanceof Map ? [...reactions.entries()] : Object.entries(reactions);
    if (!entries.length) return '';
    const chips = entries.map(([emoji, users]) => {
        if (!users || !users.length) return '';
        const mine = users.includes(username);
        return `<span class="reaction-chip${mine ? ' mine' : ''}" onclick="toggleReaccion('${msgId}','${emoji}')" title="${users.join(', ')}">
            ${emoji}<span class="rc-count">${users.length}</span>
        </span>`;
    }).join('');
    return chips ? `<div class="reactions-row">${chips}</div>` : '';
}

function _buildMsgActionsBtn(msgId, isMe, isDeleted, isGroup) {
    // Ya no usamos un botón flotante invisible.
    // El menú se abre haciendo click directamente en la burbuja (ver addMessage).
    return '';
}

function addMessage(msg) {
    const isMe = msg.self || msg.from === username;

    // Mensajes de hilo: pertenecen al panel de hilo, nunca al chat principal
    if (msg.threadId) return;

    // Saltar mensajes que el usuario ha ocultado localmente
    if (msg.id && !msg.id.startsWith('local_')) {
        try {
            const hidden = JSON.parse(localStorage.getItem('kvs_hidden_msgs') || '[]');
            if (hidden.includes(msg.id)) return;
        } catch(_) {}
    }

    // ── Llamada perdida ──
    if (msg.message === '__missed_call__') {
        const li = document.createElement('li');
        li.className = 'info-msg';
        li.innerHTML = isMe
            ? `📵 Llamada perdida enviada a <b>${escapeHTML(msg.to)}</b> · ${horaActual(msg.time)}`
            : `📵 Llamada perdida de <b>${escapeHTML(msg.from)}</b> · ${horaActual(msg.time)}`;
        li.style.cssText = 'color:#ef4444;background:rgba(239,68,68,0.08);border-radius:8px;padding:6px 12px;';
        chat.appendChild(li);
        if (autoScroll) { scrollChat(); } else if (window._scrollBtnNewMsg && !window._kvsLoadingHistory) { window._scrollBtnNewMsg(); }
        return;
    }

    const isDeleted  = !!msg.deletedAt;
    const isEdited   = !!msg.editedAt && !isDeleted;
    const isForward  = !!msg.forwardedFrom;
    const isGroup    = !!(msg.groupId || (currentChat && currentChat.startsWith('group_')));
    const isStarred  = msg.starredBy && msg.starredBy.includes(username);
    const row = document.createElement('li');
    row.className = `msg-row ${isMe ? 'me' : ''}`;
    row.dataset.msgid = msg.id;

    const avatarSrc  = msg.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${msg.from}`;
    const estadoHtml = isMe
        ? `<span class="estado" id="estado_${msg.id}">${msg.read ? '✔✔ leído' : msg.delivered ? '✔✔' : '✔'}</span>`
        : '';
    const onlyImage  = msg.imageData && !msg.message && !msg.audioData && !isDeleted;
    const bubbleClass = `bubble ${isMe ? 'me' : 'other'}${onlyImage ? ' img-only' : ''}${isDeleted ? ' deleted' : ''}`;

    // Reply preview
    let replyHtml = '';
    if (msg.replyToId && !isDeleted) {
        const rpName = msg.replyToFrom || '';
        const rpText = escapeHTML(msg.replyToText || '');
        replyHtml = `<div class="reply-preview" onclick="scrollToMsg('${msg.replyToId}')">
            <div class="rp-name">${escapeHTML(rpName)}</div>
            <div class="rp-text">${rpText}</div>
        </div>`;
    }

    // Forward label
    const forwardHtml = isForward && !isDeleted
        ? `<div class="forward-label">↗ Reenviado de <b>${escapeHTML(msg.forwardedFrom)}</b></div>` : '';

    // Edited label
    const editedHtml  = isEdited ? `<span class="edited-label">(editado)</span>` : '';

    // Star badge
    const starHtml    = isStarred ? `<span class="star-badge">⭐</span>` : '';

    // Thread button
    const threadHtml  = (!isDeleted && !isGroup && msg.threadCount)
        ? `<button class="thread-btn" onclick="abrirHilo('${msg.id}')">🧵 ${msg.threadCount} respuesta${msg.threadCount > 1 ? 's' : ''}</button>`
        : '';

    // Reactions
    const reactHtml = _buildReactionsHtml(msg.reactions, msg.id);

    // ── Audio ──
    if (msg.audioData && !isDeleted) {
        const audioId = 'aud_' + (msg.id || ('r' + Math.random().toString(36).slice(2)));
        const waveHeights = [10,16,8,20,14,18,10,22,12,16];
        const bars = waveHeights.map(h => `<span style="height:${h}px"></span>`).join('');

        row.innerHTML = `
            <div class="msg-select-check" title="Seleccionar">✓</div>
            ${_buildMsgActionsBtn(msg.id, isMe, false, isGroup)}
            <img class="msg-avatar" src="${avatarSrc}" alt="${msg.from}">
            <div class="bubble-wrap">
                ${forwardHtml}
                <div class="${bubbleClass}" id="${msg.id || audioId}">
                    ${replyHtml}
                    <span class="msg-text">
                        <div class="audio-msg-wrap">
                            <button class="btn-play-audio" id="playbtn_${audioId}">▶</button>
                            <div class="audio-progress-wrap">
                                <div class="audio-waveform" id="wave_${audioId}">${bars}</div>
                                <input class="audio-progress" type="range" min="0" max="100" value="0" id="prog_${audioId}">
                                <span class="audio-duration" id="dur_${audioId}">0:00</span>
                            </div>
                        </div>
                        ${msg.message ? `<div style="margin-top:6px">${escapeHTML(msg.message)}</div>` : ''}
                    </span>
                    <span class="meta">
                        ${starHtml}<span class="hora">${horaActual(msg.time)}</span>${editedHtml}${estadoHtml}
                    </span>
                </div>
                ${reactHtml ? `<div class="reactions-outer" id="react_${msg.id}">${reactHtml}</div>` : `<div class="reactions-outer" id="react_${msg.id}"></div>`}
                ${threadHtml ? `<div id="thread_${msg.id}">${threadHtml}</div>` : `<div id="thread_${msg.id}"></div>`}
            </div>`;

        const audioEl = document.createElement('audio');
        audioEl.id = audioId; audioEl.src = msg.audioData; audioEl.preload = 'metadata'; audioEl.style.display = 'none';
        row.appendChild(audioEl);

        const playBtn = row.querySelector('#playbtn_' + audioId);
        const progEl  = row.querySelector('#prog_'    + audioId);
        const waveEl  = row.querySelector('#wave_'    + audioId);
        const durEl   = row.querySelector('#dur_'     + audioId);
        playBtn.addEventListener('click', () => toggleAudioPlay(audioId));
        progEl.addEventListener('input',  () => seekAudio(audioId, progEl.value));
        audioEl.addEventListener('loadedmetadata', () => { if (durEl) durEl.textContent = formatAudioTime(audioEl.duration); });
        audioEl.addEventListener('timeupdate', () => {
            if (audioEl.duration) {
                if (progEl) progEl.value = (audioEl.currentTime / audioEl.duration) * 100;
                if (durEl)  durEl.textContent = formatAudioTime(audioEl.currentTime) + ' / ' + formatAudioTime(audioEl.duration);
            }
        });
        audioEl.addEventListener('ended', () => {
            if (playBtn) playBtn.textContent = '▶';
            if (waveEl)  waveEl.classList.remove('playing');
            if (progEl)  progEl.value = 0;
            if (durEl && audioEl.duration) durEl.textContent = formatAudioTime(audioEl.duration);
        });
        chat.appendChild(row);
        _attachBubbleClickMenu(row, msg.id, isMe, false, isGroup);
        if (autoScroll) { scrollChat(); } else if (window._scrollBtnNewMsg && !window._kvsLoadingHistory) { window._scrollBtnNewMsg(); }
        // Solo enviar read si: mensaje nuevo en tiempo real + chat visible + documento en primer plano
        if (!isMe && socket && !window._kvsLoadingHistory && !document.hidden && !window._appIsAway) {
            socket.send(JSON.stringify({ type: 'read', id: msg.id }));
        }
        return;
    }

    // ── Imagen / Texto / Sticker / Gift / Eliminado ──
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
        <div class="msg-select-check" title="Seleccionar">✓</div>
        ${_buildMsgActionsBtn(msg.id, isMe, isDeleted, isGroup)}
        <img class="msg-avatar" src="${avatarSrc}" alt="${msg.from}">
        <div class="bubble-wrap">
            ${forwardHtml}
            <div class="${bubbleClass}" id="${msg.id}">
                ${replyHtml}
                <span class="msg-text">${content}</span>
                <span class="meta">
                    ${starHtml}<span class="hora">${horaActual(msg.time)}</span>${editedHtml}${estadoHtml}
                </span>
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
    _attachBubbleClickMenu(row, msg.id, isMe, isDeleted, isGroup);
    // Previsualización de enlace en mensajes de texto
    if (!isDeleted && !msg.imageData && !msg.audioData && msg.message) {
        const bubble = row.querySelector('.bubble');
        if (bubble) _adjuntarLinkPreview(bubble, msg.message);
    }
    if (autoScroll) { scrollChat(); } else if (window._scrollBtnNewMsg && !window._kvsLoadingHistory) { window._scrollBtnNewMsg(); }
    // Solo enviar read si: mensaje nuevo en tiempo real + chat visible + documento en primer plano
    if (!isMe && socket && !isDeleted && !window._kvsLoadingHistory && !document.hidden && !window._appIsAway) {
        socket.send(JSON.stringify({ type: 'read', id: msg.id }));
    }
}

function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
}

function renderMentions(html) {
    if (!html) return html || '';
    // Match @username — letras, números, guión bajo, caracteres acentuados
    return html.replace(/@([^\s<>&"']+)/g, (match, uname) => {
        let cls = 'mention-chip';
        if (uname === 'todos' || uname === 'all') {
            cls += ' all';
        } else if (uname === username) {
            cls += ' self';
        }
        return `<span class="${cls}">@${escapeHTML(uname)}</span>`;
    });
}

function addDaySeparator(day) {
    const li = document.createElement('li');
    li.className = 'info-msg';
    li.textContent = `— ${day} —`;
    chat.appendChild(li);
}

function addInfo(text) {
    const li = document.createElement('li');
    li.className = 'info-msg';
    li.textContent = text;
    chat.appendChild(li);
}

// Mostrar notificación de llamada perdida (recibida al reconectar)
function mostrarLlamadaPerdida(data) {
    // Añadir al historial de conversación
    const chatKey = currentChat && (currentChat === data.from || currentChat === 'phone:' + (window._phoneToUsername ? Object.entries(window._phoneToUsername).find(([,un]) => un === data.from)?.[0] : null))
        ? currentChat : data.from;

    if (!conversations[chatKey]) conversations[chatKey] = [];
    if (!conversations[chatKey].some(m => m.id === data.id)) conversations[chatKey].push(data);

    // Si el chat con ese usuario está abierto, renderizar inline
    if (currentChat === data.from || currentChat === chatKey) {
        addMessage(data);
    } else {
        // Notificación flotante
        unreadCounts[data.from] = (unreadCounts[data.from] || 0) + 1;
        playNotifSound();
        mostrarNotificacion('📵 Llamada perdida', data.from);
    }
    renderContactsList();
    renderUsers(lastKnownUsers);
}

function updateEstado(id, estado) {
    const el = document.getElementById(`estado_${id}`);
    if (el) el.textContent = estado;
    // Aunque el elemento no esté en el DOM (p.ej. aún es local_ o el chat no está visible),
    // actualizar la caché para que la próxima vez que se renderice muestre el estado correcto.
    if (estado === '✔✔ leído') {
        for (const arr of Object.values(conversations)) { if (!Array.isArray(arr)) continue;
            if (!Array.isArray(arr)) continue;
            const m = arr.find(m => m.id === id);
            if (m) { m.read = true; m.delivered = true; }
        }
    } else if (estado === '✔✔') {
        for (const arr of Object.values(conversations)) { if (!Array.isArray(arr)) continue;
            if (!Array.isArray(arr)) continue;
            const m = arr.find(m => m.id === id);
            if (m) { m.delivered = true; }
        }
    }
}


// ============================================================
// ============================================================
//   LLAMADAS WEBRTC (VOZ)
// ============================================================
// ============================================================

let peerConnection = null;
let localStream = null;
let callTarget = null;
let isCaller = false;
let callTimerInterval = null;
let callStartTime = null;
let isMuted = false;

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

async function iniciarLlamada() {
    if (!currentChat || !socket) return;

    // Resolver destinatario: puede ser username (online) o phone: (offline)
    const isOfflineChat = currentChat.startsWith('phone:');
    const offlinePhone = isOfflineChat ? currentChat.replace('phone:', '') : null;

    // Para offline: obtener username del contacto desde la BD via servidor
    // El servidor resuelve el username al recibir call_offer con toPhone
    // Aquí simplemente enviamos la oferta — el servidor la guarda como missed call y devuelve call_rejected
    if (isOfflineChat) {
        // Llamada a offline: el servidor guardará missed call automáticamente
        const contact = myContacts.get(offlinePhone);
        const displayName = contact ? contact.customName : offlinePhone;
        // Necesitamos el username del destinatario para enviar la oferta
        // Buscamos si lo tenemos en caché (puede que lo hayamos visto online antes)
        let targetUsername = contact && contact.username ? contact.username : null;
        if (!targetUsername) {
            addInfo(`📵 Llamada perdida enviada a ${displayName}. Le llegará la notificación al conectarse.`);
            // Guardar missed call via mensaje especial
            socket.send(JSON.stringify({
                type: 'message',
                toPhone: offlinePhone,
                message: '__missed_call__'
            }));
            return;
        }
        callTarget = targetUsername;
    } else {
        callTarget = currentChat;
    }

    isCaller = true;

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch(e) {
        alert('No se pudo acceder al micrófono: ' + e.message);
        return;
    }

    peerConnection = crearPeer();
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    socket.send(JSON.stringify({
        type: 'call_offer',
        to: callTarget,
        from: username,
        sdp: offer.sdp
    }));

    mostrarCallOverlay(callTarget, 'Llamando…');
}

async function recibirLlamada(data) {
    callTarget = data.from;
    isCaller = false;

    // Guardar oferta para cuando se acepte
    window._pendingOffer = data;

    // Mostrar banner de llamada entrante
    document.getElementById('incomingName').textContent = data.from;
    document.getElementById('incomingAvatar').src = `https://api.dicebear.com/7.x/initials/svg?seed=${data.from}`;
    document.getElementById('incomingCall').classList.add('visible');
    playRingtone();
}

async function aceptarLlamada() {
    stopRingtone();
    document.getElementById('incomingCall').classList.remove('visible');

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch(e) {
        alert('No se pudo acceder al micrófono: ' + e.message);
        return;
    }

    peerConnection = crearPeer();
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    const offer = window._pendingOffer;
    await peerConnection.setRemoteDescription({ type: 'offer', sdp: offer.sdp });

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.send(JSON.stringify({
        type: 'call_answer',
        to: callTarget,
        from: username,
        sdp: answer.sdp
    }));

    mostrarCallOverlay(callTarget, 'Conectando…');
}

function rechazarLlamada() {
    stopRingtone();
    document.getElementById('incomingCall').classList.remove('visible');
    socket.send(JSON.stringify({ type: 'call_rejected', to: callTarget }));
    callTarget = null;
    window._pendingOffer = null;
}

async function recibirRespuesta(data) {
    if (!peerConnection) return;
    await peerConnection.setRemoteDescription({ type: 'answer', sdp: data.sdp });
}

async function recibirICE(data) {
    if (!peerConnection || !data.candidate) return;
    try {
        await peerConnection.addIceCandidate(data.candidate);
    } catch(e) {}
}

function terminarLlamada() {
    socket.send(JSON.stringify({ type: 'call_ended', to: callTarget }));
    limpiarLlamada();
}

function llamadaRechazada() {
    addInfo(`${callTarget} rechazó la llamada.`);
    limpiarLlamada();
}

function llamadaTerminada() {
    addInfo(`Llamada con ${callTarget} finalizada.`);
    limpiarLlamada();
}

function limpiarLlamada() {
    stopRingtone();
    if (callTimerInterval) { clearInterval(callTimerInterval); callTimerInterval = null; }
    if (peerConnection) { peerConnection.close(); peerConnection = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    document.getElementById('callOverlay').classList.remove('visible');
    document.getElementById('incomingCall').classList.remove('visible');
    document.getElementById('remoteAudio').srcObject = null;
    callTarget = null;
    isMuted = false;
    isCaller = false;
}

function crearPeer() {
    const pc = new RTCPeerConnection(rtcConfig);

    pc.onicecandidate = (e) => {
        if (e.candidate && callTarget) {
            socket.send(JSON.stringify({
                type: 'call_ice',
                to: callTarget,
                candidate: e.candidate
            }));
        }
    };

    pc.ontrack = (e) => {
        const audio = document.getElementById('remoteAudio');
        audio.srcObject = e.streams[0];
    };

    pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
            document.getElementById('callStatusText').textContent = 'En llamada';
            document.getElementById('callTimer').style.display = 'block';
            callStartTime = Date.now();
            callTimerInterval = setInterval(actualizarTimer, 1000);
        }
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            llamadaTerminada();
        }
    };

    return pc;
}

function mostrarCallOverlay(name, status) {
    document.getElementById('callName').textContent = name;
    document.getElementById('callStatusText').textContent = status;
    document.getElementById('callAvatar').src = userAvatars[name] || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name)}`;
    document.getElementById('callTimer').style.display = 'none';
    document.getElementById('callTimer').textContent = '00:00';
    const overlay = document.getElementById('callOverlay');
    // Resetear posición al inicio de cada llamada
    overlay.style.left   = '';
    overlay.style.bottom = '';
    overlay.style.right  = '16px';
    overlay.classList.add('visible');
    activarDragPanel(overlay);
}

function actualizarTimer() {
    if (!callStartTime) return;
    const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
    const m = String(Math.floor(elapsed / 60)).padStart(2,'0');
    const s = String(elapsed % 60).padStart(2,'0');
    document.getElementById('callTimer').textContent = `${m}:${s}`;
}

function toggleMute() {
    if (!localStream) return;
    isMuted = !isMuted;
    localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
    const btn = document.getElementById('btnMute');
    btn.textContent = isMuted ? '🔇' : '🎤';
    btn.classList.toggle('muted', isMuted);
}

// ============================================================
// GRABACIÓN Y ENVÍO DE AUDIOS
// ============================================================
let mediaRecorder = null;
let audioChunks = [];
let recTimerInterval = null;
let recSeconds = 0;
let isRecording = false;
let pendingAudio = null; // { dataUrl }

// Mapa de audios activos (id → HTMLAudioElement)
const audioElements = {};

function formatAudioTime(s) {
    if (!isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + ':' + String(sec).padStart(2,'0');
}

async function toggleGrabacion() {
    if (isRecording) {
        detenerGrabacion();
    } else {
        await iniciarGrabacion();
    }
}

async function iniciarGrabacion() {
    if (!currentChat) return;

    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch(e) {
        alert('No se pudo acceder al micrófono: ' + e.message);
        return;
    }

    // Elegir el formato más compatible
    const mimeType = getSupportedMimeType();
    const options = mimeType ? { mimeType } : {};

    mediaRecorder = new MediaRecorder(stream, options);
    audioChunks = [];
    isRecording = true;

    mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        // Usar el mimeType base sin ;codecs= para que el data URL sea limpio
        const blobType = (mimeType || 'audio/webm').split(';')[0];
        const blob = new Blob(audioChunks, { type: blobType });
        const reader = new FileReader();
        reader.onload = (ev) => {
            pendingAudio = { dataUrl: ev.target.result };
        };
        reader.readAsDataURL(blob);
    };

    mediaRecorder.start(200); // chunk cada 200ms

    // ── Visualización de forma de onda en tiempo real ──
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source   = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 32;
        source.connect(analyser);
        const dataArr   = new Uint8Array(analyser.frequencyBinCount);
        const waveEl    = document.getElementById('recWaveform');
        const bars      = waveEl ? [...waveEl.querySelectorAll('span')] : [];
        waveEl && waveEl.classList.add('live');
        let _waveRAF;
        const _animateWave = () => {
            analyser.getByteFrequencyData(dataArr);
            bars.forEach((bar, i) => {
                const val = dataArr[i % dataArr.length] || 0;
                const h = Math.max(4, Math.round((val / 255) * 24));
                bar.style.height = h + 'px';
            });
            _waveRAF = requestAnimationFrame(_animateWave);
        };
        _animateWave();
        // Guardar referencia para cancelar al detener
        window._recWaveRAF     = _waveRAF;
        window._recAudioCtx    = audioCtx;
        window._recWaveAnimate = _animateWave;
        window._recWaveRAFRef  = { raf: _waveRAF };
        // Actualizar referencia en cada frame
        const _wrapAnimate = () => {
            analyser.getByteFrequencyData(dataArr);
            bars.forEach((bar, i) => {
                const val = dataArr[i % dataArr.length] || 0;
                bar.style.height = Math.max(4, Math.round((val / 255) * 24)) + 'px';
            });
            window._recWaveRAFRef.raf = requestAnimationFrame(_wrapAnimate);
        };
        cancelAnimationFrame(_waveRAF);
        window._recWaveRAFRef.raf = requestAnimationFrame(_wrapAnimate);
    } catch(_) { /* si falla la visualización, no bloquear la grabación */ }

    // UI
    document.getElementById('audioRecordBar').classList.add('visible');
    document.getElementById('btnMic').textContent = '⏹️';
    document.getElementById('btnMic').style.background = '#fecaca';

    // Notificar al destinatario que estamos grabando
    _enviarEstadoGrabacion('start');

    recSeconds = 0;
    actualizarRecTimer();
    recTimerInterval = setInterval(() => {
        recSeconds++;
        actualizarRecTimer();
        // Límite de 3 minutos
        if (recSeconds >= 180) detenerGrabacion();
    }, 1000);
}

function detenerGrabacion() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
    mediaRecorder.stop();
    isRecording = false;
    clearInterval(recTimerInterval);
    // Notificar que dejamos de grabar
    _enviarEstadoGrabacion('stop');
    // Detener animación de onda
    if (window._recWaveRAFRef) { cancelAnimationFrame(window._recWaveRAFRef.raf); window._recWaveRAFRef = null; }
    if (window._recAudioCtx)   { try { window._recAudioCtx.close(); } catch(_) {} window._recAudioCtx = null; }
    const waveEl = document.getElementById('recWaveform');
    if (waveEl) { waveEl.classList.remove('live'); [...waveEl.querySelectorAll('span')].forEach(s => s.style.height = ''); }
    document.getElementById('btnMic').textContent = '🎙️';
    document.getElementById('btnMic').style.background = '';
}

function actualizarRecTimer() {
    const m = Math.floor(recSeconds / 60);
    const s = String(recSeconds % 60).padStart(2,'0');
    document.getElementById('recTimer').textContent = m + ':' + s;
}

function cancelarAudio() {
    detenerGrabacion();
    pendingAudio = null;
    audioChunks = [];
    document.getElementById('audioRecordBar').classList.remove('visible');
}

function enviarAudio() {
    // Esperar a que onstop haya generado pendingAudio
    const esperar = () => {
        if (!pendingAudio) { setTimeout(esperar, 80); return; }
        doEnviarAudio();
    };

    detenerGrabacion();
    document.getElementById('audioRecordBar').classList.remove('visible');

    // Si ya tenemos el dataUrl listo (grabación muy corta puede no estar lista aún)
    if (pendingAudio) {
        doEnviarAudio();
    } else {
        setTimeout(esperar, 100);
    }
}

function doEnviarAudio() {
    if (!pendingAudio || !currentChat || !socket) return;
    if (socket.readyState !== WebSocket.OPEN) {
        mostrarToast('Sin conexión. Inténtalo de nuevo.', true);
        pendingAudio = null;
        return;
    }

    // Validar tamaño (~5MB máx)
    const approxBytes = pendingAudio.dataUrl.length * 0.75;
    if (approxBytes > 5 * 1024 * 1024) {
        alert('El audio es demasiado largo. Máximo 3 minutos.');
        pendingAudio = null;
        return;
    }

    if (currentChat.startsWith('group_')) {
        // ── Mensaje de grupo ──
        const groupId = currentChat.replace('group_', '');
        socket.send(JSON.stringify({
            type: 'groupMessage',
            groupId,
            message: '',
            audioData: pendingAudio.dataUrl
        }));
        // Preview local en el chat de grupo
        const grpKey = 'group_' + groupId;
        const localGrpAudio = {
            id: 'local_' + Date.now(),
            from: username,
            to: groupId,
            groupId,
            message: '',
            audioData: pendingAudio.dataUrl,
            time: new Date(),
            avatar: myAvatarDataUrl
        };
        if (!conversations[grpKey]) conversations[grpKey] = [];
        conversations[grpKey].push(localGrpAudio);
        addGroupMessage(localGrpAudio);
    } else if (currentChat.startsWith('phone:')) {
        // ── Contacto offline: enviar por teléfono ──
        const toPhone = currentChat.replace('phone:', '');
        socket.send(JSON.stringify({
            type: 'message',
            toPhone,
            message: '',
            audioData: pendingAudio.dataUrl
        }));
        // Preview local
        const localOffAudio = {
            id: 'local_' + Date.now(),
            from: username,
            to: null,
            toPhone,
            message: '',
            audioData: pendingAudio.dataUrl,
            time: new Date(),
            self: true,
            avatar: myAvatarDataUrl
        };
        if (!conversations[currentChat]) conversations[currentChat] = [];
        conversations[currentChat].push(localOffAudio);
        addMessage(localOffAudio);
    } else {
        // ── Chat 1:1 con usuario online ──
        socket.send(JSON.stringify({
            type: 'message',
            to: currentChat,
            message: '',
            audioData: pendingAudio.dataUrl
        }));
        // Preview local
        const localAudio = {
            id: 'local_' + Date.now(),
            from: username,
            to: currentChat,
            message: '',
            audioData: pendingAudio.dataUrl,
            time: new Date(),
            self: true,
            avatar: myAvatarDataUrl
        };
        if (!conversations[currentChat]) conversations[currentChat] = [];
        conversations[currentChat].push(localAudio);
        addMessage(localAudio);
    }

    pendingAudio = null;
    audioChunks = [];
}

function getSupportedMimeType() {
    // Preferimos tipos sin ;codecs= para que el base64 resultante
    // tenga un mime type limpio que el servidor pueda validar fácilmente.
    // Orden: webm > ogg > mp4 > sin especificar
    const types = [
        'audio/webm',
        'audio/ogg',
        'audio/mp4',
    ];
    for (const t of types) {
        if (MediaRecorder.isTypeSupported(t)) return t;
    }
    // Fallback: usar lo que el navegador elija
    return '';
}

// ============================================================
// REPRODUCTOR DE AUDIOS EN CHAT
// ============================================================
function toggleAudioPlay(audioId) {
    const audioEl = document.getElementById(audioId);
    const playBtn = document.getElementById('playbtn_' + audioId);
    const waveEl  = document.getElementById('wave_' + audioId);
    if (!audioEl) return;

    // Pausar cualquier otro audio en reproducción
    document.querySelectorAll('audio').forEach(a => {
        if (a.id !== audioId && !a.paused) {
            a.pause();
            const ob = document.getElementById('playbtn_' + a.id);
            const ow = document.getElementById('wave_' + a.id);
            if (ob) ob.textContent = '▶';
            if (ow) ow.classList.remove('playing');
        }
    });

    if (audioEl.paused) {
        audioEl.play();
        if (playBtn) playBtn.textContent = '⏸';
        if (waveEl) waveEl.classList.add('playing');
        // Notificar al servidor que escuchamos el audio (solo si no es nuestro)
        const msgId = audioId.startsWith('aud_') ? audioId.slice(4) : audioId;
        const row = audioEl.closest ? null : document.querySelector(`[data-msgid="${msgId}"]`);
        const isMine = row
            ? row.classList.contains('me')
            : !!document.querySelector(`.msg-row.me[data-msgid="${msgId}"]`);
        if (!isMine && socket && socket.readyState === WebSocket.OPEN && !audioEl._readSent) {
            audioEl._readSent = true;
            socket.send(JSON.stringify({ type: 'audioRead', id: msgId }));
        }
    } else {
        audioEl.pause();
        if (playBtn) playBtn.textContent = '▶';
        if (waveEl) waveEl.classList.remove('playing');
    }
}

function seekAudio(audioId, value) {
    const audioEl = document.getElementById(audioId);
    if (!audioEl || !audioEl.duration) return;
    audioEl.currentTime = (value / 100) * audioEl.duration;
}

// ============================================================
// CAMBIO DE FOTO DE PERFIL
// ============================================================
function abrirModalAvatar() {
    pendingAvatarDataUrl = '';
    // Mostrar la foto actual como preview
    document.getElementById('avatarPreviewBig').src = myAvatarDataUrl;
    document.getElementById('btnGuardarAvatar').disabled = true;
    document.getElementById('avatarModal').classList.add('visible');
}

function cerrarModalAvatar() {
    document.getElementById('avatarModal').classList.remove('visible');
    // Reset el input file para que se pueda volver a seleccionar la misma foto
    document.getElementById('avatarFileInput').value = '';
    pendingAvatarDataUrl = '';
}

function onAvatarFileSelected(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Validar que sea imagen
    if (!file.type.startsWith('image/')) {
        alert('Por favor selecciona un archivo de imagen.');
        return;
    }

    // Validar tamaño (máx 5MB antes de comprimir)
    if (file.size > 5 * 1024 * 1024) {
        alert('La imagen es demasiado grande. Máximo 5MB.');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        // Comprimir/recortar a cuadrado usando canvas
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const SIZE = 256; // 256x256px es suficiente para avatar
            canvas.width = SIZE;
            canvas.height = SIZE;
            const ctx = canvas.getContext('2d');

            // Recortar al centro en cuadrado
            const minSide = Math.min(img.width, img.height);
            const sx = (img.width  - minSide) / 2;
            const sy = (img.height - minSide) / 2;
            ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, SIZE, SIZE);

            // Exportar como JPEG comprimido (calidad 0.85)
            pendingAvatarDataUrl = canvas.toDataURL('image/jpeg', 0.85);

            // Mostrar preview
            document.getElementById('avatarPreviewBig').src = pendingAvatarDataUrl;
            document.getElementById('btnGuardarAvatar').disabled = false;
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function guardarAvatar() {
    if (!pendingAvatarDataUrl) return;

    myAvatarDataUrl = pendingAvatarDataUrl;

    // Guardar en localStorage para persistir entre sesiones
    localStorage.setItem(`kvs_avatar_${loginPhone}`, myAvatarDataUrl);

    // Actualizar la foto en el sidebar inmediatamente
    document.getElementById('myAvatar').src = myAvatarDataUrl;

    // Notificar al servidor para que actualice el avatar en los próximos mensajes
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'updateAvatar',
            avatar: myAvatarDataUrl
        }));
    }

    cerrarModalAvatar();
}

// Cerrar modal al hacer click fuera
document.getElementById('avatarModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('avatarModal')) cerrarModalAvatar();
});

// ============================================================
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
        renderContactsList();
        // Marcar contactos como listos y abrir chat pendiente si procede
        _contactosListos = true;
        if (window._pendingOpenChat) _abrirChatPendienteDesdeNotif();
    } catch(e) {
        console.error('Error cargando contactos:', e);
        _contactosListos = true; // marcar igualmente para no bloquear el flujo
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
    // Cachear avatar para uso offline
    if (avatar) {
        if (username) userAvatars[username] = avatar;
        userAvatars['__phone__' + contactPhone] = avatar;
    }
    renderContactsList();
    renderUsers(lastKnownUsers); // quitar al usuario de "Conectados ahora" si estaba ahí
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
        myContacts.set(contactPhone, contact);
    }
    // Si el chat actual es este contacto, actualizar el header
    const onlineUsername = getOnlineUsernameByPhone(contactPhone);
    if (onlineUsername && currentChat === onlineUsername) {
        document.getElementById('chatName').textContent = newName;
    }
    renderContactsList();
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
// LLAMADA GRUPAL (admin inicia, WebRTC mesh)
// ============================================================
// Estado de la llamada grupal
let groupCallState = {
    groupId: null,
    peers: {},       // username → { pc, stream, phone }
    localStream: null,
    timerInterval: null,
    startTime: null,
    isMuted: false
};

function iniciarLlamadaGrupal() {
    if (!currentChat || !currentChat.startsWith('group_')) return;
    const groupId = currentChat.replace('group_', '');
    const g = myGroups.get(groupId);
    if (!g) return;
    // Cualquier miembro puede iniciar la llamada

    // Obtener miembros online (excluir al propio admin)
    const onlineMembers = g.members.filter(phone => {
        if (phone === loginPhone) return false;
        return window._phoneToUsername && window._phoneToUsername[phone];
    });
    if (onlineMembers.length === 0) {
        alert('No hay miembros del grupo conectados en este momento.');
        return;
    }

    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        groupCallState.groupId = groupId;
        groupCallState.localStream = stream;
        groupCallState.peers = {};
        groupCallState.isMuted = false;

        mostrarOverlayLlamadaGrupal(g, onlineMembers);

        // Crear un peer por cada miembro online y enviar ofertas
        onlineMembers.forEach(memberPhone => {
            const memberUsername = window._phoneToUsername[memberPhone];
            if (!memberUsername) return;
            crearPeerGrupal(memberUsername, memberPhone, true, groupId);
        });
    }).catch(e => { alert('No se pudo acceder al micrófono: ' + e.message); });
}

function crearPeerGrupal(targetUsername, targetPhone, isInitiator, groupId) {
    const pc = new RTCPeerConnection(rtcConfig);
    groupCallState.peers[targetUsername] = { pc, phone: targetPhone };

    groupCallState.localStream.getTracks().forEach(t => pc.addTrack(t, groupCallState.localStream));

    pc.onicecandidate = (e) => {
        if (e.candidate) {
            socket.send(JSON.stringify({
                type: 'group_call_ice',
                to: targetUsername,
                groupId,
                candidate: e.candidate
            }));
        }
    };

    pc.ontrack = (e) => {
        // Reproducir audio del participante
        let audioEl = document.getElementById('groupAudio_' + targetUsername);
        if (!audioEl) {
            audioEl = document.createElement('audio');
            audioEl.id = 'groupAudio_' + targetUsername;
            audioEl.autoplay = true;
            audioEl.style.display = 'none';
            document.body.appendChild(audioEl);
        }
        audioEl.srcObject = e.streams[0];
        actualizarEstadoParticipante(targetUsername, 'connected');
    };

    pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
            actualizarEstadoParticipante(targetUsername, 'connected');
            // Iniciar timer cuando al menos uno conecte
            if (!groupCallState.startTime) {
                groupCallState.startTime = Date.now();
                groupCallState.timerInterval = setInterval(actualizarTimerGrupal, 1000);
                document.getElementById('groupCallTimer').style.display = 'block';
            }
        }
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            actualizarEstadoParticipante(targetUsername, 'rejected');
        }
    };

    if (isInitiator) {
        pc.createOffer().then(offer => pc.setLocalDescription(offer)).then(() => {
            socket.send(JSON.stringify({
                type: 'group_call_offer',
                groupId,
                sdp: pc.localDescription.sdp
            }));
        });
    }
}

function mostrarOverlayLlamadaGrupal(g, onlineMembers) {
    document.getElementById('groupCallTitle').textContent = '📞 ' + g.name;
    document.getElementById('groupCallSubtitle').textContent = 'Llamando a ' + onlineMembers.length + ' miembro(s)…';
    document.getElementById('groupCallTimer').style.display = 'none';
    document.getElementById('groupCallTimer').textContent = '00:00';

    const avatarsEl = document.getElementById('groupCallAvatars');
    avatarsEl.innerHTML = onlineMembers.map(phone => {
        const uname = window._phoneToUsername[phone] || phone;
        const contact = myContacts.get(phone);
        const displayName = contact ? contact.customName : uname;
        const avatarUrl = contact
            ? (contact.avatar || userAvatars['__phone__' + phone] || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(uname)}`)
            : (userAvatars['__phone__' + phone] || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(uname)}`);
        return `<div class="group-call-participant calling" id="gcpart_${uname}">
            <img src="${avatarUrl}" alt="${escapeHTML(displayName)}">
            <div class="group-call-participant-name">${escapeHTML(displayName)}</div>
        </div>`;
    }).join('');

    const overlay = document.getElementById('groupCallOverlay');
    // Resetear posición al inicio de cada llamada
    overlay.style.left   = '';
    overlay.style.bottom = '';
    overlay.style.right  = '16px';
    overlay.classList.add('visible');

    // Hacer el panel arrastrable
    activarDragPanel(overlay);
}

function actualizarEstadoParticipante(username, state) {
    const el = document.getElementById('gcpart_' + username);
    if (!el) return;
    el.className = 'group-call-participant ' + state;
    const connectedCount = document.querySelectorAll('.group-call-participant.connected').length;
    if (connectedCount > 0) {
        document.getElementById('groupCallSubtitle').textContent = connectedCount + ' conectado(s)';
    }
}

function actualizarTimerGrupal() {
    if (!groupCallState.startTime) return;
    const elapsed = Math.floor((Date.now() - groupCallState.startTime) / 1000);
    const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    document.getElementById('groupCallTimer').textContent = m + ':' + s;
}

function toggleGroupMute() {
    if (!groupCallState.localStream) return;
    groupCallState.isMuted = !groupCallState.isMuted;
    groupCallState.localStream.getAudioTracks().forEach(t => t.enabled = !groupCallState.isMuted);
    const btn = document.getElementById('btnGroupCallMute');
    btn.textContent = groupCallState.isMuted ? '🔇' : '🎤';
    btn.classList.toggle('muted', groupCallState.isMuted);
}

function terminarLlamadaGrupal() {
    if (groupCallState.groupId) {
        socket.send(JSON.stringify({ type: 'group_call_ended', groupId: groupCallState.groupId }));
    }
    limpiarLlamadaGrupal();
}

function limpiarLlamadaGrupal() {
    if (groupCallState.timerInterval) { clearInterval(groupCallState.timerInterval); }
    Object.values(groupCallState.peers).forEach(({ pc }) => { try { pc.close(); } catch(e) {} });
    document.querySelectorAll('[id^="groupAudio_"]').forEach(el => { el.srcObject = null; el.remove(); });
    if (groupCallState.localStream) groupCallState.localStream.getTracks().forEach(t => t.stop());
    groupCallState = { groupId: null, peers: {}, localStream: null, timerInterval: null, startTime: null, isMuted: false };
    document.getElementById('groupCallOverlay').classList.remove('visible');
}

// --- Recibir llamada grupal (miembro) ---
let _pendingGroupOffer = null;

function recibirLlamadaGrupal(data) {
    _pendingGroupOffer = data;
    document.getElementById('incomingGroupName').textContent = data.from + ' · ' + data.groupName;
    document.getElementById('incomingGroupCall').classList.add('visible');
    playRingtone();
}

function aceptarLlamadaGrupal() {
    stopRingtone();
    document.getElementById('incomingGroupCall').classList.remove('visible');
    const offer = _pendingGroupOffer;
    if (!offer) return;

    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        groupCallState.groupId = offer.groupId;
        groupCallState.localStream = stream;
        groupCallState.peers = {};

        // Crear peer con el admin que llama
        const pc = new RTCPeerConnection(rtcConfig);
        groupCallState.peers[offer.from] = { pc };

        stream.getTracks().forEach(t => pc.addTrack(t, stream));

        pc.onicecandidate = (e) => {
            if (e.candidate) {
                socket.send(JSON.stringify({ type: 'group_call_ice', to: offer.from, groupId: offer.groupId, candidate: e.candidate }));
            }
        };

        pc.ontrack = (e) => {
            let audioEl = document.getElementById('groupAudio_' + offer.from);
            if (!audioEl) {
                audioEl = document.createElement('audio');
                audioEl.id = 'groupAudio_' + offer.from;
                audioEl.autoplay = true;
                audioEl.style.display = 'none';
                document.body.appendChild(audioEl);
            }
            audioEl.srcObject = e.streams[0];
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'connected' && !groupCallState.startTime) {
                groupCallState.startTime = Date.now();
            }
            if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
                limpiarLlamadaGrupal();
                addInfo('La llamada grupal ha finalizado.');
            }
        };

        pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp })
            .then(() => pc.createAnswer())
            .then(answer => pc.setLocalDescription(answer))
            .then(() => {
                socket.send(JSON.stringify({ type: 'group_call_answer', to: offer.from, groupId: offer.groupId, sdp: pc.localDescription.sdp }));
            });

        _pendingGroupOffer = null;
    }).catch(e => { alert('No se pudo acceder al micrófono: ' + e.message); rechazarLlamadaGrupal(); });
}

function rechazarLlamadaGrupal() {
    stopRingtone();
    document.getElementById('incomingGroupCall').classList.remove('visible');
    if (_pendingGroupOffer) {
        socket.send(JSON.stringify({ type: 'group_call_rejected', to: _pendingGroupOffer.from, groupId: _pendingGroupOffer.groupId }));
        _pendingGroupOffer = null;
    }
}

function onGroupCallAnswer(data) {
    const peer = groupCallState.peers[data.from];
    if (!peer) return;
    peer.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp }).catch(e => console.error('setRemoteDesc error:', e));
}

function onGroupCallIce(data) {
    const peer = groupCallState.peers[data.from];
    if (!peer || !data.candidate) return;
    peer.pc.addIceCandidate(data.candidate).catch(e => {});
}

function onGroupCallRejected(data) {
    actualizarEstadoParticipante(data.from, 'rejected');
    const peer = groupCallState.peers[data.from];
    if (peer) { try { peer.pc.close(); } catch(e) {} delete groupCallState.peers[data.from]; }
}

function onGroupCallEnded(data) {
    limpiarLlamadaGrupal();
    addInfo('La llamada grupal ha finalizado.');
}

// ============================================================
// DRAG — hace arrastrable un panel flotante (touch + mouse)
// ============================================================
function activarDragPanel(el) {
    // Evitar doble-bind
    if (el._dragBound) return;
    el._dragBound = true;

    let startX, startY, origLeft, origBottom;

    function onDown(e) {
        // Solo arrastrar desde el propio fondo del panel (no los botones)
        if (e.target.closest('button') || e.target.closest('img')) return;
        const touch = e.touches ? e.touches[0] : e;
        startX = touch.clientX;
        startY = touch.clientY;
        const rect = el.getBoundingClientRect();
        origLeft   = rect.left;
        origBottom = window.innerHeight - rect.bottom;
        // Fijar posición absoluta en left/bottom para el drag
        el.style.right  = 'auto';
        el.style.left   = origLeft + 'px';
        el.style.bottom = origBottom + 'px';
        document.addEventListener(e.touches ? 'touchmove' : 'mousemove', onMove, { passive: false });
        document.addEventListener(e.touches ? 'touchend'  : 'mouseup',   onUp);
    }
    function onMove(e) {
        e.preventDefault();
        const touch = e.touches ? e.touches[0] : e;
        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;
        let newLeft   = origLeft   + dx;
        let newBottom = origBottom - dy;
        // Mantener dentro de la ventana
        newLeft   = Math.max(0, Math.min(window.innerWidth  - el.offsetWidth,  newLeft));
        newBottom = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, newBottom));
        el.style.left   = newLeft   + 'px';
        el.style.bottom = newBottom + 'px';
    }
    function onUp(e) {
        document.removeEventListener(e.type === 'touchend' ? 'touchmove' : 'mousemove', onMove);
        document.removeEventListener(e.type,  onUp);
    }
    el.addEventListener('mousedown',  onDown);
    el.addEventListener('touchstart', onDown, { passive: false });
}

// ============================================================
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
// TOAST (notificación flotante no intrusiva)
// ============================================================
let _toastTimer = null;
function mostrarToast(msg, esError = false) {
    let toast = document.getElementById('kvsToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'kvsToast';
        toast.style.cssText = [
            'position:fixed','bottom:28px','left:50%',
            'transform:translateX(-50%) translateY(20px)',
            'background:rgba(30,27,75,0.92)','color:#fff','border-radius:22px',
            'padding:11px 22px','font-size:14px','font-weight:600',
            "font-family:'DM Sans',sans-serif",
            'box-shadow:0 6px 28px rgba(0,0,0,0.28)','z-index:99999',
            'opacity:0','transition:opacity .22s, transform .22s',
            'white-space:nowrap','max-width:90vw','text-align:center',
            'pointer-events:none'
        ].join(';');
        document.body.appendChild(toast);
    }
    if (esError) toast.style.background = '#ef4444';
    else toast.style.background = 'rgba(30,27,75,0.92)';
    toast.textContent = msg;
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(20px)';
    }, 3000);
}

// ============================================================
// ACCIONES SOBRE MENSAJES
// ============================================================

// Estado de respuesta activa
let _replyState = null; // { id, from, text }
// Estado de edición activa
let _editState  = null; // { id }
// Menú contextual abierto
let _openMenuRow = null;

/* ─── Menú contextual ──────────────────────────────────────── */
const QUICK_EMOJIS = ['👍','❤️','😂','😮','😢','🔥'];
function abrirMenuMensaje(e, msgId, isMe, isDeleted, isGroup) {
    e.stopPropagation();
    e.preventDefault(); // Añadido para evitar comportamientos por defecto del navegador

    // Si el menú ya está abierto para este mensaje, cerrarlo (toggle)
    const existingMenu = document.getElementById('msgCtxMenu');
    if (existingMenu) {
        const wasThisMsg = existingMenu.dataset.formsgid === msgId;
        cerrarMenuMensaje();
        if (wasThisMsg) return; // toggle off
    }

    const row = document.querySelector(`[data-msgid="${msgId}"]`);
    if (!row) return;
    const bubble = row.querySelector('.bubble');

    // ── Determinar isMe e isDeleted directamente del DOM ──
    const isMeFinal      = row.classList.contains('me');
    const isDeletedFinal = bubble ? bubble.classList.contains('deleted') : isDeleted;

    row.classList.add('menu-open');
    _openMenuRow = row;

    // Construir menú
    const menu = document.createElement('div');
    menu.className = 'msg-ctx-menu visible';
    menu.id = 'msgCtxMenu';
    menu.dataset.formsgid = msgId;

    // Barra de reacciones rápidas (solo si no eliminado)
    if (!isDeletedFinal) {
        const reactBar = document.createElement('div');
        reactBar.className = 'react-quick-bar';
        QUICK_EMOJIS.forEach(emoji => {
            const btn = document.createElement('button');
            btn.className = 'react-quick-btn';
            btn.textContent = emoji;
            btn.title = emoji;
            btn.onclick = (ev) => { ev.stopPropagation(); toggleReaccion(msgId, emoji); cerrarMenuMensaje(); };
            reactBar.appendChild(btn);
        });
        menu.appendChild(reactBar);
    }

    // Opciones del menú (Mantenemos toda tu lógica original)
    const ops = [];
    if (!isDeletedFinal) ops.push({ icon: '↩', label: 'Responder',    fn: () => iniciarRespuesta(msgId) });
    if (!isDeletedFinal) ops.push({ icon: '🧵', label: 'Ver hilo',     fn: () => abrirHilo(msgId) });
    if (!isDeletedFinal) ops.push({ icon: '↗', label: 'Reenviar',    fn: () => abrirModalReenviar(msgId) });
    if (!isDeletedFinal) ops.push({ icon: '☑️', label: 'Seleccionar', fn: () => entrarModoSeleccion(msgId) });
    if (!isDeletedFinal) ops.push({ icon: '⭐', label: 'Destacar',    fn: () => destacarMensaje(msgId) });
    if (!isDeletedFinal && isMeFinal) ops.push({ icon: '✏️', label: 'Editar',               fn: () => iniciarEdicion(msgId) });
    if (!isDeletedFinal && isMeFinal) ops.push({ icon: '🗑',  label: 'Eliminar para todos', fn: () => eliminarMensaje(msgId), danger: true });
    if (isMeFinal)                     ops.push({ icon: '👁',  label: isDeletedFinal ? 'Ocultar para mí' : 'Ocultar solo para mí', fn: () => ocultarMensajeParaMi(msgId), danger: true });

    ops.forEach((op, i) => {
        if (op.danger && i > 0) {
            const sep = document.createElement('div');
            sep.className = 'ctx-sep';
            menu.appendChild(sep);
        }
        const btn = document.createElement('button');
        btn.className = 'ctx-item' + (op.danger ? ' danger' : '');
        btn.innerHTML = `<span>${op.icon}</span><span>${op.label}</span>`;
        btn.onclick = (ev) => { ev.stopPropagation(); cerrarMenuMensaje(); op.fn(); };
        menu.appendChild(btn);
    });

    // Añadir al BODY invisible para poder medir dimensiones reales
    menu.style.visibility = 'hidden';
    document.body.appendChild(menu);

    // Medir y posicionar correctamente antes de mostrar
    requestAnimationFrame(() => {
        const menuRect = menu.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const margin = 8;

        let posX = e.clientX;
        let posY = e.clientY;

        // No salirse por la derecha
        if (posX + menuRect.width + margin > vw) {
            posX = vw - menuRect.width - margin;
        }
        if (posX < margin) posX = margin;

        // Preferir abrir hacia abajo; si no cabe, abrir hacia arriba
        if (posY + menuRect.height + margin > vh) {
            posY = e.clientY - menuRect.height;
        }
        if (posY < margin) posY = margin;

        menu.style.left       = posX + 'px';
        menu.style.top        = posY + 'px';
        menu.style.visibility = 'visible';
    });

    // Cerrar al pulsar fuera (Mantenemos tu lógica de 300ms)
    const openedAt = Date.now();
    const _closeHandler = (ev) => {
        if (Date.now() - openedAt < 300) return; 
        const menu = document.getElementById('msgCtxMenu');
        if (menu && menu.contains(ev.target)) return; 
        document.removeEventListener('click', _closeHandler, true);
        document.removeEventListener('touchend', _closeHandler, true);
        cerrarMenuMensaje();
    };

    setTimeout(() => {
        document.addEventListener('click', _closeHandler, true);
        document.addEventListener('touchend', _closeHandler, true);
    }, 50);

    menu._closeHandler = _closeHandler;
}

function _onClickOutsideMenu(ev) {
    // Legacy — kept for safety but new menus use menu._closeHandler
    const menu = document.getElementById('msgCtxMenu');
    if (menu && menu.contains(ev.target)) return;
    document.removeEventListener('click', _onClickOutsideMenu);
    cerrarMenuMensaje();
}

function cerrarMenuMensaje() {
    document.removeEventListener('click', _onClickOutsideMenu);
    const existing = document.getElementById('msgCtxMenu');
    if (existing) {
        // Quitar el handler de cierre por click-fuera si existe
        if (existing._closeHandler) {
            document.removeEventListener('click',    existing._closeHandler, true);
            document.removeEventListener('touchend', existing._closeHandler, true);
        }
        existing.remove();
    }
    if (_openMenuRow) { _openMenuRow.classList.remove('menu-open'); _openMenuRow = null; }
}

/* ─── Scroll a mensaje referenciado ────────────────────────── */
function scrollToMsg(msgId) {
    const el = document.getElementById(msgId);
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.transition = 'background .2s';
        el.style.background = 'rgba(79,70,229,0.18)';
        setTimeout(() => { el.style.background = ''; }, 1200);
    }
}

/* ─── RESPONDER ─────────────────────────────────────────────── */
function iniciarRespuesta(msgId) {
    // Buscar el mensaje en conversations para obtener datos fiables
    let msgFrom = '', msgText = '';
    for (const arr of Object.values(conversations)) { if (!Array.isArray(arr)) continue;
        const m = arr.find(m => m.id === msgId);
        if (m) {
            msgFrom = m.from === username ? 'Tú' : m.from;
            if (m.deletedAt) { msgText = '🗑 Mensaje eliminado'; }
            else if (m.imageData) { msgText = '📷 Imagen'; }
            else if (m.audioData) { msgText = '🎙 Audio'; }
            else { msgText = (m.message || '').trim().slice(0, 80); }
            break;
        }
    }
    // Fallback al DOM si no está en conversations (mensaje local)
    if (!msgFrom) {
        const bubble = document.getElementById(msgId);
        const row = bubble ? bubble.closest('.msg-row') : null;
        msgFrom = row ? (row.querySelector('.msg-avatar')?.alt || 'Mensaje') : 'Mensaje';
        const textEl = bubble ? bubble.querySelector('.msg-text') : null;
        msgText = textEl ? (textEl.textContent || '').trim().slice(0, 80) : '';
    }

    _replyState = { id: msgId, from: msgFrom, text: msgText };
    document.getElementById('replyBarName').textContent = msgFrom;
    document.getElementById('replyBarText').textContent = msgText || '📷 Imagen';
    document.getElementById('replyBar').classList.add('visible');
    input.focus();
}

function cancelarRespuesta() {
    _replyState = null;
    // Si estábamos en modo edición, cancelar la edición completamente
    if (_editState) {
        _editState = null;
        input.value = '';
        input.style.height = 'auto';
        actualizarBtnEnviar();
        // Restaurar onclick al enviar normal
        btnEnviar.onclick = enviar;
    }
    document.getElementById('replyBar').classList.remove('visible');
    document.getElementById('replyBarName').textContent = '';
    document.getElementById('replyBarText').textContent = '';
}

/* ─── EDITAR ────────────────────────────────────────────────── */
function iniciarEdicion(msgId) {
    // Leer el texto original de conversations (fuente de verdad), no del DOM
    let currentText = '';
    for (const arr of Object.values(conversations)) { if (!Array.isArray(arr)) continue;
        const m = arr.find(m => m.id === msgId);
        if (m && !m.deletedAt) { currentText = m.message || ''; break; }
    }
    // Fallback robusto al DOM: clonar msg-text, quitar reply-preview/forward-label/meta
    if (!currentText) {
        const bubble = document.getElementById(msgId);
        const textEl = bubble ? bubble.querySelector('.msg-text') : null;
        if (textEl) {
            const cloned = textEl.cloneNode(true);
            cloned.querySelectorAll('.reply-preview,.forward-label,.meta,.edited-label,.star-badge,.estado,.hora').forEach(el => el.remove());
            currentText = cloned.textContent.trim();
        }
    }

    // Cancelar cualquier respuesta pendiente sin borrar el input (lo ponemos nosotros)
    if (_replyState) {
        _replyState = null;
        document.getElementById('replyBar').classList.remove('visible');
    }

    _editState = { id: msgId };
    input.value = currentText;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    // Mover cursor al final
    input.selectionStart = input.selectionEnd = input.value.length;
    input.focus();

    document.getElementById('replyBarName').textContent = '✏️ Editando mensaje';
    document.getElementById('replyBarText').textContent = currentText.slice(0, 60) || '(sin texto)';
    document.getElementById('replyBar').classList.add('visible');

    actualizarBtnEnviar();
    // Override de enviar → guardarEdicion (solo onclick; keydown Enter ya lo maneja)
    btnEnviar.onclick = guardarEdicion;
}

function guardarEdicion() {
    if (!_editState) return;
    const newText = input.value.trim();
    if (!newText) {
        // Texto vacío: simplemente cancelar sin enviar
        cancelarRespuesta();
        return;
    }

    const editId = _editState.id;

    // Si el id todavía es local_ (eco aún no llegó), no enviamos la edición
    // al servidor: actualizamos el texto local en conversations[] y en el DOM,
    // y guardamos el nuevo texto para cuando llegue el id real.
    if (editId.startsWith('local_')) {
        // Actualizar texto en conversations[] (la fuente de verdad local)
        for (const arr of Object.values(conversations)) { if (!Array.isArray(arr)) continue;
            const m = arr.find(m => m.id === editId);
            if (m) { m.message = newText; m._pendingEdit = newText; m.editedAt = new Date(); break; }
        }
        // Actualizar DOM: texto + label (editado)
        const bubble = document.getElementById(editId);
        if (bubble) {
            const textEl = bubble.querySelector('.msg-text');
            if (textEl) {
                const replyPreview = textEl.querySelector('.reply-preview');
                if (replyPreview) {
                    textEl.innerHTML = '';
                    textEl.appendChild(replyPreview);
                    const span = document.createElement('span');
                    span.innerHTML = escapeHTML(newText);
                    textEl.appendChild(span);
                } else {
                    textEl.innerHTML = escapeHTML(newText);
                }
            }
            // Añadir (editado) en .meta si no existe aún
            const meta = bubble.querySelector('.meta');
            if (meta && !meta.querySelector('.edited-label')) {
                meta.insertAdjacentHTML('beforeend', '<span class="edited-label">(editado)</span>');
            }
        }
        // Marcar que cuando llegue el eco con el id real, hay que enviar una edición
        window._pendingEdits = window._pendingEdits || {};
        window._pendingEdits[editId] = newText;
    } else {
        socket.send(JSON.stringify({ type: 'editMessage', id: editId, newText }));
    }

    // Reset limpio del estado
    _editState = null;
    _replyState = null;
    input.value = '';
    input.style.height = 'auto';
    btnEnviar.onclick = enviar;
    actualizarBtnEnviar();
    document.getElementById('replyBar').classList.remove('visible');
    document.getElementById('replyBarName').textContent = '';
    document.getElementById('replyBarText').textContent = '';
}

function onMensajeEditado(msgId, newText, editedAt) {
    // Actualizar en conversations
    Object.values(conversations).forEach(arr => { if (!Array.isArray(arr)) return;
        const m = arr.find(m => m.id === msgId);
        if (m) { m.message = newText; m.editedAt = editedAt || m.editedAt || new Date(); }
    });
    // Actualizar en DOM — preservando reply-preview si existe
    const bubble = document.getElementById(msgId);
    if (!bubble) return;
    const textEl = bubble.querySelector('.msg-text');
    if (textEl) {
        const replyPreview = textEl.querySelector('.reply-preview');
        if (replyPreview) {
            textEl.innerHTML = '';
            textEl.appendChild(replyPreview);
            const span = document.createElement('span');
            span.innerHTML = escapeHTML(newText);
            textEl.appendChild(span);
        } else {
            textEl.innerHTML = escapeHTML(newText);
        }
    }
    // Añadir o mantener label "(editado)" en .meta
    const meta = bubble.querySelector('.meta');
    if (meta) {
        // Quitar cualquier edited-label existente y añadir uno fresco
        const existing = meta.querySelector('.edited-label');
        if (existing) existing.remove();
        meta.insertAdjacentHTML('beforeend', '<span class="edited-label">(editado)</span>');
    }
}

/* ─── MODO SELECCIÓN MÚLTIPLE ───────────────────────────────── */
// Set con los msgIds seleccionados
const _seleccion = new Set();

function entrarModoSeleccion(primerMsgId) {
    cerrarMenuMensaje();
    _seleccion.clear();
    chat.classList.add('chat-in-select-mode');
    // Ocultar input area y mostrar barra de selección
    const inputArea   = document.querySelector('.input-area');
    const selBar      = document.getElementById('selectionBar');
    if (inputArea) inputArea.style.display = 'none';
    if (selBar)    selBar.classList.add('visible');
    // Seleccionar el primer mensaje
    if (primerMsgId) {
        const row = document.querySelector(`[data-msgid="${primerMsgId}"]`);
        if (row) _toggleSeleccion(primerMsgId, row);
    }
}

function salirModoSeleccion() {
    _seleccion.clear();
    chat.classList.remove('chat-in-select-mode');
    // Quitar clase selected de todos los rows
    chat.querySelectorAll('.msg-row.msg-selected').forEach(r => r.classList.remove('msg-selected'));
    // Restaurar input y ocultar barra
    const inputArea = document.querySelector('.input-area');
    const selBar    = document.getElementById('selectionBar');
    if (inputArea) inputArea.style.display = '';
    if (selBar)    selBar.classList.remove('visible');
}

function _toggleSeleccion(msgId, row) {
    if (_seleccion.has(msgId)) {
        _seleccion.delete(msgId);
        row.classList.remove('msg-selected');
    } else {
        _seleccion.add(msgId);
        row.classList.add('msg-selected');
    }
    _actualizarBarraSeleccion();
}

function _actualizarBarraSeleccion() {
    const count   = _seleccion.size;
    const countEl = document.getElementById('selBarCount');
    if (countEl) countEl.textContent = count === 0 ? 'Ninguno seleccionado'
        : count === 1 ? '1 mensaje seleccionado'
        : `${count} mensajes seleccionados`;
    // Habilitar/deshabilitar botones
    const delBtn = document.querySelector('.btn-sel-del');
    const fwdBtn = document.querySelector('.btn-sel-fwd');
    const cpyBtn = document.querySelector('.btn-sel-copy');
    [delBtn, fwdBtn, cpyBtn].forEach(b => { if (b) b.disabled = count === 0; });
}

function selCopiar() {
    if (_seleccion.size === 0) return;
    // Copiar el texto de los mensajes seleccionados en orden de aparición en el DOM
    const rows = [...chat.querySelectorAll('.msg-row')];
    const textos = [];
    rows.forEach(row => {
        const msgId = row.dataset.msgid;
        if (!msgId || !_seleccion.has(msgId)) return;
        const bubble = row.querySelector('.bubble');
        if (!bubble || bubble.classList.contains('deleted')) return;
        const textEl = bubble.querySelector('.msg-text');
        if (!textEl) return;
        // Extraer texto puro (sin reply-preview, meta, etc.)
        const clone = textEl.cloneNode(true);
        clone.querySelectorAll('.reply-preview,.forward-label,.meta,.edited-label,.star-badge,.estado,.hora').forEach(el => el.remove());
        const txt = clone.textContent.trim();
        if (txt) textos.push(txt);
    });
    if (textos.length === 0) { mostrarToast('No hay texto que copiar.', true); return; }
    navigator.clipboard.writeText(textos.join('\n')).then(() => {
        mostrarToast(`📋 ${textos.length === 1 ? 'Mensaje copiado' : textos.length + ' mensajes copiados'}`);
        salirModoSeleccion();
    }).catch(() => {
        mostrarToast('No se pudo copiar.', true);
    });
}

function selReenviar() {
    if (_seleccion.size === 0) return;
    if (_seleccion.size === 1) {
        // Un solo mensaje: usar el modal de reenvío normal
        const msgId = [..._seleccion][0];
        salirModoSeleccion();
        abrirModalReenviar(msgId);
        return;
    }
    // Múltiples: reenviar uno a uno al destino elegido
    const ids = [..._seleccion];
    salirModoSeleccion();
    // Reutilizar el modal de reenvío enviando todos los ids
    _forwardMultipleIds = ids;
    _abrirModalReenviarMultiple();
}

// Reenvío múltiple: abrir el mismo modal de reenvío pero enviar todos los mensajes
let _forwardMultipleIds = [];

function _abrirModalReenviarMultiple() {
    if (!_forwardMultipleIds.length) return;
    const list = document.getElementById('forwardList');
    list.innerHTML = '';
    // Construir lista de contactos igual que abrirModalReenviar
    myContacts.forEach((c) => {
        const onlineUsername = getOnlineUsernameByPhone(c.contactPhone);
        const avatarUrl = c.avatar || userAvatars['__phone__' + c.contactPhone]
            || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(c.customName)}`;
        const item = document.createElement('div');
        item.className = 'forward-item';
        item.innerHTML = `<img src="${avatarUrl}" alt="${escapeHTML(c.customName)}"><span class="forward-item-name">${escapeHTML(c.customName)}</span>`;
        item.onclick = () => {
            _forwardMultipleIds.forEach(msgId => {
                const payload = { type: 'forwardMessage', id: msgId };
                if (onlineUsername) payload.to = onlineUsername;
                else payload.toPhone = c.contactPhone;
                socket.send(JSON.stringify(payload));
            });
            mostrarToast(`↗ ${_forwardMultipleIds.length} mensajes reenviados`);
            _forwardMultipleIds = [];
            cerrarModalReenviar();
        };
        list.appendChild(item);
    });
    // Grupos también
    myGroups.forEach((g) => {
        const item = document.createElement('div');
        item.className = 'forward-item';
        const avatarHtml = g.avatar
            ? `<img src="${g.avatar}" alt="${escapeHTML(g.name)}">`
            : `<div style="width:36px;height:36px;border-radius:50%;background:var(--purple-pale);display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--purple-deep);font-size:15px;">${(g.name||'?').charAt(0).toUpperCase()}</div>`;
        item.innerHTML = `${avatarHtml}<span class="forward-item-name">${escapeHTML(g.name)}</span>`;
        item.onclick = () => {
            _forwardMultipleIds.forEach(msgId => {
                socket.send(JSON.stringify({ type: 'forwardMessage', id: msgId, toGroup: g.groupId }));
            });
            mostrarToast(`↗ ${_forwardMultipleIds.length} mensajes reenviados`);
            _forwardMultipleIds = [];
            cerrarModalReenviar();
        };
        list.appendChild(item);
    });
    document.getElementById('forwardModal').classList.add('visible');
}

function selEliminar() {
    if (_seleccion.size === 0) return;
    const count = _seleccion.size;
    const ids   = [..._seleccion];
    salirModoSeleccion();
    setTimeout(() => {
        if (!confirm(`¿Eliminar ${count === 1 ? 'este mensaje' : 'estos ' + count + ' mensajes'} para todos?`)) return;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            mostrarToast('Sin conexión. Inténtalo de nuevo.', true);
            return;
        }
        socket.send(JSON.stringify({ type: 'deleteMessages', ids }));
    }, 50);
}

/* ─── ELIMINAR ──────────────────────────────────────────────── */
function eliminarMensaje(msgId) {
    cerrarMenuMensaje();
    setTimeout(() => {
        if (!confirm('¿Eliminar este mensaje para todos?')) return;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            mostrarToast('Sin conexión. Inténtalo de nuevo.', true);
            return;
        }

        // Si el id todavía es local_ (el eco del servidor no ha llegado aún):
        // ocultar el mensaje del DOM inmediatamente y marcar como "pendiente de eliminar".
        // Cuando llegue el eco con el id real, lo eliminaremos del servidor.
        if (typeof msgId === 'string' && msgId.startsWith('local_')) {
            // Ocultar del DOM
            const row = document.querySelector(`[data-msgid="${msgId}"]`);
            if (row) row.remove();
            // Quitar de conversations
            Object.values(conversations).forEach(arr => { if (!Array.isArray(arr)) return;
                const idx = arr.findIndex(m => m.id === msgId);
                if (idx >= 0) arr.splice(idx, 1);
            });
            // Marcar como pendiente de eliminar cuando llegue el id real
            window._pendingDeletes = window._pendingDeletes || {};
            window._pendingDeletes[msgId] = true;
            mostrarToast('Mensaje eliminado ✓');
            return;
        }

        socket.send(JSON.stringify({ type: 'deleteMessage', id: msgId }));
    }, 50);
}

// Ocultar un mensaje solo en el dispositivo local (no afecta a otros usuarios)
function ocultarMensajeParaMi(msgId) {
    cerrarMenuMensaje();
    setTimeout(() => {
        if (!confirm('¿Ocultar este mensaje solo para ti? Solo desaparecerá en tu pantalla.')) return;
        // Eliminar del DOM
        const row = document.querySelector(`[data-msgid="${msgId}"]`);
        if (row) row.remove();
        // Eliminar de conversations local para que no reaparezca al recargar historial
        Object.values(conversations).forEach(arr => { if (!Array.isArray(arr)) return;
            const idx = arr.findIndex(m => m.id === msgId);
            if (idx >= 0) arr.splice(idx, 1);
        });
        // Guardar en localStorage para que siga oculto tras reconectar
        try {
            const hidden = JSON.parse(localStorage.getItem('kvs_hidden_msgs') || '[]');
            if (!hidden.includes(msgId)) {
                hidden.push(msgId);
                // Mantener máximo 500 ids para no crecer indefinidamente
                if (hidden.length > 500) hidden.splice(0, hidden.length - 500);
                localStorage.setItem('kvs_hidden_msgs', JSON.stringify(hidden));
            }
        } catch(_) {}
        mostrarToast('Mensaje ocultado 👁');
    }, 50);
}

function onMensajeEliminado(msgId) {
    // Actualizar conversations
    Object.values(conversations).forEach(arr => { if (!Array.isArray(arr)) return;
        const m = arr.find(m => m.id === msgId);
        if (m) { m.deletedAt = new Date(); m.message = ''; m.imageData = null; m.audioData = null; }
    });
    // Actualizar DOM sin cloneNode
    const bubble = document.getElementById(msgId);
    if (!bubble) return;
    bubble.classList.add('deleted');
    // Limpiar contenido: dejar solo el texto de eliminado y el .meta
    const meta = bubble.querySelector('.meta');
    const metaClone = meta ? meta.cloneNode(true) : null;
    bubble.innerHTML = '';
    const textEl = document.createElement('span');
    textEl.className = 'msg-text';
    textEl.textContent = '🗑 Mensaje eliminado';
    bubble.appendChild(textEl);
    if (metaClone) bubble.appendChild(metaClone);
    // Quitar reacciones
    const reactEl = document.getElementById('react_' + msgId);
    if (reactEl) reactEl.innerHTML = '';
    // Quitar el menú contextual si estaba abierto para este mensaje
    const openMenu = document.getElementById('msgCtxMenu');
    if (openMenu && openMenu.dataset.formsgid === msgId) cerrarMenuMensaje();
    // Quitar el modo selección de este mensaje si estaba seleccionado
    const row = bubble.closest('.msg-row');
    if (row) {
        row.classList.remove('msg-selected');
        _seleccion.delete(msgId);
        _actualizarBarraSeleccion();
        // Re-adjuntar handler: ahora es deleted=true, pero si es propio
        // el usuario puede usar "Ocultar para mí"
        const isMine = row.classList.contains('me');
        const isGrp  = !!(currentChat && currentChat.startsWith('group_'));
        // Quitar handler antiguo y adjuntar nuevo que refleje estado deleted
        if (bubble._kvsMenuHandler) {
            bubble.removeEventListener('click', bubble._kvsMenuHandler);
            bubble._kvsMenuHandler = null;
        }
        if (isMine) {
            const handler = (e) => {
                if (e.target.closest('.msg-ctx-menu')) return;
                e.stopPropagation();
                // abrirMenuMensaje lee isMe e isDeleted del DOM directamente
                abrirMenuMensaje(e, msgId, true, true, isGrp);
            };
            bubble._kvsMenuHandler = handler;
            bubble.addEventListener('click', handler);
            bubble.style.cursor = 'pointer';
        } else {
            bubble.style.cursor = 'default';
        }
    }
}

/* ─── REACCIONAR ────────────────────────────────────────────── */
function toggleReaccion(msgId, emoji) {
    if (!socket || !emoji) return;
    socket.send(JSON.stringify({ type: 'addReaction', id: msgId, emoji }));
}

function onReaccionActualizada(msgId, reactions) {
    // Actualizar conversations
    Object.values(conversations).forEach(arr => { if (!Array.isArray(arr)) return;
        const m = arr.find(m => m.id === msgId);
        if (m) m.reactions = reactions;
    });
    // Actualizar DOM
    const reactEl = document.getElementById('react_' + msgId);
    if (!reactEl) return;
    reactEl.innerHTML = _buildReactionsHtml(reactions, msgId);
}

/* ─── DESTACAR ──────────────────────────────────────────────── */
function destacarMensaje(msgId) {
    socket.send(JSON.stringify({ type: 'starMessage', id: msgId }));
}

function onMensajeDestacado(msgId, starred) {
    const bubble = document.getElementById(msgId);
    if (!bubble) return;
    const meta = bubble.querySelector('.meta');
    if (!meta) return;
    const existing = meta.querySelector('.star-badge');
    if (starred && !existing) {
        meta.insertAdjacentHTML('afterbegin', '<span class="star-badge">⭐</span>');
    } else if (!starred && existing) {
        existing.remove();
    }
    // Actualizar conversations
    Object.values(conversations).forEach(arr => { if (!Array.isArray(arr)) return;
        const m = arr.find(m => m.id === msgId);
        if (m) {
            if (!m.starredBy) m.starredBy = [];
            const idx = m.starredBy.indexOf(username);
            if (starred && idx < 0) m.starredBy.push(username);
            if (!starred && idx >= 0) m.starredBy.splice(idx, 1);
        }
    });
}

/* ─── REENVIAR ──────────────────────────────────────────────── */
let _forwardMsgId = null;

function abrirModalReenviar(msgId) {
    _forwardMsgId = msgId;
    const list = document.getElementById('forwardList');
    list.innerHTML = '';

    // Buscar mensaje original: primero en conversations, luego en el DOM
    let origMsg = null;
    for (const arr of Object.values(conversations)) { if (!Array.isArray(arr)) continue;
        const m = arr.find(m => m.id === msgId);
        if (m) { origMsg = { ...m }; break; }
    }
    // Fallback al DOM si no está en conversations (puede ser un id real recién llegado
    // cuyo entry en conversations aún tiene el id local antiguo)
    if (!origMsg) {
        const bubble = document.getElementById(msgId);
        if (bubble) {
            const row = bubble.closest('.msg-row');
            const textEl = bubble.querySelector('.msg-text');
            origMsg = {
                id: msgId,
                message: textEl ? textEl.textContent.trim() : '',
                imageData: null,
                audioData: null,
                from: row ? (row.querySelector('.msg-avatar')?.alt || username) : username,
                forwardedFrom: null
            };
            // Si hay imagen en la burbuja, recuperarla
            const imgEl = bubble.querySelector('.img-msg');
            if (imgEl) origMsg.imageData = imgEl.src;
        }
    }

    // Contactos
    myContacts.forEach((c) => {
        const onlineUsername = getOnlineUsernameByPhone(c.contactPhone);
        const avatarUrl = c.avatar || userAvatars['__phone__' + c.contactPhone]
            || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(c.customName)}`;
        const item = document.createElement('div');
        item.className = 'forward-item';
        item.innerHTML = `<img src="${avatarUrl}" alt="${escapeHTML(c.customName)}"><span class="forward-item-name">${escapeHTML(c.customName)}</span>`;
        item.onclick = () => {
            const payload = { type: 'forwardMessage', id: msgId };
            if (onlineUsername) payload.to = onlineUsername;
            else payload.toPhone = c.contactPhone;
            socket.send(JSON.stringify(payload));
            // Preview local inmediato solo si el destino es el chat activo
            const destKey = onlineUsername || ('phone:' + c.contactPhone);
            if (currentChat === destKey || (onlineUsername && currentChat === onlineUsername)) {
                const fwdPreview = {
                    id: 'local_fwd_' + Date.now(),
                    from: username,
                    to: onlineUsername || null,
                    message: origMsg ? (origMsg.message || '') : '',
                    imageData: origMsg ? origMsg.imageData : null,
                    audioData: origMsg ? origMsg.audioData : null,
                    time: new Date(),
                    self: true,
                    avatar: myAvatarDataUrl,
                    forwardedFrom: origMsg ? origMsg.from : username
                };
                if (!conversations[destKey]) conversations[destKey] = [];
                conversations[destKey].push(fwdPreview);
                addMessage(fwdPreview);
            }
            mostrarToast('Reenviado ✓');
            cerrarModalReenviar();
        };
        list.appendChild(item);
    });

    // Grupos
    myGroups.forEach((g) => {
        const item = document.createElement('div');
        item.className = 'forward-item';
        item.innerHTML = `<div style="width:36px;height:36px;border-radius:50%;background:var(--purple-pale);display:flex;align-items:center;justify-content:center;font-size:18px;">👥</div><span class="forward-item-name">${escapeHTML(g.name)}</span>`;
        item.onclick = () => {
            socket.send(JSON.stringify({ type: 'forwardMessage', id: msgId, groupId: g.groupId }));
            const grpKey = 'group_' + g.groupId;
            if (currentChat === grpKey) {
                const fwdGrpPreview = {
                    id: 'local_fwd_' + Date.now(),
                    from: username,
                    to: g.groupId,
                    groupId: g.groupId,
                    message: origMsg ? (origMsg.message || '') : '',
                    imageData: origMsg ? origMsg.imageData : null,
                    audioData: origMsg ? origMsg.audioData : null,
                    time: new Date(),
                    avatar: myAvatarDataUrl,
                    forwardedFrom: origMsg ? origMsg.from : username
                };
                if (!conversations[grpKey]) conversations[grpKey] = [];
                conversations[grpKey].push(fwdGrpPreview);
                addGroupMessage(fwdGrpPreview);
            }
            mostrarToast('Reenviado ✓');
            cerrarModalReenviar();
        };
        list.appendChild(item);
    });

    if (list.children.length === 0) {
        list.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:13px;text-align:center;">No tienes contactos ni grupos para reenviar.</div>';
    }

    document.getElementById('forwardModal').classList.add('visible');
}

function cerrarModalReenviar() {
    _forwardMsgId = null;
    document.getElementById('forwardModal').classList.remove('visible');
}

document.getElementById('forwardModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('forwardModal')) cerrarModalReenviar();
});

/* ─── HILO (THREAD) ─────────────────────────────────────────── */
let _threadId   = null;
let _threadInputListenerAttached = false;

function _attachThreadInputListener() {
    const threadInputEl = document.getElementById('threadInput');
    if (!threadInputEl || _threadInputListenerAttached) return;
    _threadInputListenerAttached = true;

    threadInputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            enviarEnHilo();
        } else if (e.key === 'Escape') {
            if (_threadEditState) {
                e.preventDefault();
                _cancelarEdicionHilo();
            }
        }
    });

    threadInputEl.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 90) + 'px';
    });

    threadInputEl.addEventListener('touchstart', (e) => {
        e.stopPropagation();
        threadInputEl.focus();
    }, { passive: true });

    threadInputEl.addEventListener('click', (e) => {
        e.stopPropagation();
    });
}

function abrirHilo(msgId) {
    _threadId = msgId;

    // Intentar obtener el mensaje raíz del DOM (puede no estar si no está en pantalla)
    const bubble = document.getElementById(msgId);
    const row    = bubble ? bubble.closest('.msg-row') : null;
    const from   = row ? (row.querySelector('.msg-avatar')?.alt || '') : '';
    const textEl = bubble ? bubble.querySelector('.msg-text') : null;
    const text   = textEl ? (textEl.textContent || textEl.innerText || '').trim() : '';

    // Mostrar lo que tenemos (puede actualizarse cuando llegue thread_history)
    document.getElementById('threadRootFrom').textContent = from || '…';
    document.getElementById('threadRootText').textContent = text ? text.slice(0, 200) : '…';

    // Limpiar mensajes anteriores del hilo
    document.getElementById('threadMessages').innerHTML = '';

    // Abrir el panel
    const panel = document.getElementById('threadPanel');
    panel.classList.add('open');

    // En móvil: empujar estado al historial para que el botón atrás cierre el hilo
    if (_esMobile()) {
        history.pushState({ kvs: 'thread' }, '');
    }

    // Adjuntar listener (solo una vez)
    _attachThreadInputListener();

    // Dar foco al input con pequeño delay para que la transición CSS termine
    setTimeout(() => {
        const threadInputEl = document.getElementById('threadInput');
        if (threadInputEl) {
            threadInputEl.removeAttribute('disabled');
            threadInputEl.focus();
        }
    }, 320);

    // Pedir historial del hilo al servidor (siempre, para ambos dispositivos)
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'loadThread', threadId: msgId }));
    }
}

function cerrarHilo() {
    _threadId = null;
    _cerrarMenuHilo();
    _cancelarEdicionHilo();
    document.getElementById('threadPanel').classList.remove('open');
    // Limpiar el input al cerrar
    const threadInputEl = document.getElementById('threadInput');
    if (threadInputEl) {
        threadInputEl.value = '';
        threadInputEl.style.height = 'auto';
        threadInputEl.style.borderColor = '';
        threadInputEl.placeholder = 'Responder en el hilo…';
        threadInputEl.blur();
    }
}

function enviarEnHilo() {
    const threadInputEl = document.getElementById('threadInput');
    if (!threadInputEl) return;
    const text = threadInputEl.value.trim();
    if (!text || !_threadId) return;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        mostrarToast('Sin conexión. Inténtalo de nuevo.', true);
        return;
    }

    // ── Modo edición ────────────────────────────────────────────
    if (_threadEditState) {
        const editId = _threadEditState.id;
        socket.send(JSON.stringify({ type: 'editMessage', id: editId, newText: text }));
        _onThreadMsgEditado(editId, text);
        _cancelarEdicionHilo();
        return;
    }

    // ── Envío normal con renderizado optimista ───────────────────
    const localId = 'local_thread_' + Date.now();
    const localMsg = {
        id:       localId,
        from:     username,
        message:  text,
        avatar:   myAvatarDataUrl,
        time:     new Date(),
        threadId: _threadId,
        self:     true
    };

    // Actualizar threadCount optimistamente en conversations[] y en el DOM
    let newCount = 1;
    Object.values(conversations).forEach(arr => {
        if (!Array.isArray(arr)) return;
        const m = arr.find(m => m.id === _threadId);
        if (m) {
            m.threadCount = (m.threadCount || 0) + 1;
            newCount = m.threadCount;
        }
    });
    const threadDiv = document.getElementById('thread_' + _threadId);
    if (threadDiv) {
        const tid = _threadId;
        threadDiv.innerHTML = `<button class="thread-btn" onclick="abrirHilo('${tid}')">🧵 ${newCount} respuesta${newCount > 1 ? 's' : ''}</button>`;
    }

    // Mostrar inmediatamente en el panel del hilo
    const ul = document.getElementById('threadMessages');
    if (ul) {
        ul.appendChild(_renderThreadMsg(localMsg));
        ul.scrollTop = ul.scrollHeight;
    }

    // Enviar al servidor
    socket.send(JSON.stringify({ type: 'threadMessage', threadId: _threadId, message: text }));

    threadInputEl.value = '';
    threadInputEl.style.height = 'auto';
    threadInputEl.focus();
}

// El listener del threadInput se registra en DOMContentLoaded (ver más abajo)

function _renderThreadMsg(msg) {
    const isMe      = msg.from === username || msg.self === true;
    const isDeleted = !!msg.deletedAt;
    const isEdited  = !!msg.editedAt && !isDeleted;
    const avatarSrc = msg.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(msg.from)}`;

    const li = document.createElement('li');
    li.className = 'thread-msg-item' + (isMe ? ' me' : '');
    li.id = 'thread_item_' + msg.id;
    li.dataset.msgid = msg.id;

    const textContent = isDeleted
        ? '🗑 Mensaje eliminado'
        : escapeHTML(msg.message || '');
    const editedBadge = isEdited ? '<span class="thread-msg-edited">(editado)</span>' : '';
    const timeStr     = horaActual(msg.time);

    li.innerHTML = `
        <img class="thread-msg-avatar" src="${avatarSrc}" alt="${escapeHTML(msg.from)}">
        <div class="thread-msg-body">
            <div class="thread-msg-from">${escapeHTML(msg.from)}</div>
            <div class="thread-msg-text${isDeleted ? ' deleted' : ''}">${textContent}${editedBadge}</div>
            <div class="thread-msg-time">${timeStr}</div>
        </div>`;

    // Menú contextual al hacer click (solo si no está eliminado o es el autor)
    if (!isDeleted || isMe) {
        li.addEventListener('click', (e) => {
            e.stopPropagation();
            _abrirMenuHilo(e, msg.id, isMe, isDeleted);
        });
    }

    return li;
}

/* ── Menú contextual dentro del hilo ─────────────────────── */
let _openThreadMenu = null;

function _cerrarMenuHilo() {
    if (_openThreadMenu) {
        _openThreadMenu.remove();
        _openThreadMenu = null;
    }
}

function _abrirMenuHilo(e, msgId, isMe, isDeleted) {
    _cerrarMenuHilo();

    const menu = document.createElement('div');
    menu.className = 'msg-ctx-menu visible';
    menu.id = 'threadCtxMenu';
    menu.style.cssText = 'position:fixed;z-index:9999;min-width:160px;';
    _openThreadMenu = menu;

    const ops = [];
    if (!isDeleted) ops.push({ icon: '✏️', label: 'Editar',   fn: () => _editarEnHilo(msgId),   show: isMe });
    if (!isDeleted) ops.push({ icon: '🗑',  label: 'Eliminar', fn: () => _eliminarEnHilo(msgId), show: isMe, danger: true });
    if (!isDeleted) ops.push({ icon: '👁',  label: 'Ocultar para mí', fn: () => _ocultarEnHilo(msgId), show: true, danger: true });

    const visibleOps = ops.filter(o => o.show);
    if (visibleOps.length === 0) return;

    visibleOps.forEach((op, i) => {
        if (op.danger && i > 0) {
            const sep = document.createElement('div');
            sep.className = 'ctx-sep';
            menu.appendChild(sep);
        }
        const btn = document.createElement('button');
        btn.className = 'ctx-item' + (op.danger ? ' danger' : '');
        btn.innerHTML = `<span>${op.icon}</span><span>${op.label}</span>`;
        btn.onclick = (ev) => { ev.stopPropagation(); _cerrarMenuHilo(); op.fn(); };
        menu.appendChild(btn);
    });

    document.body.appendChild(menu);

    // Posicionar
    const rect = e.currentTarget ? e.currentTarget.getBoundingClientRect() : { bottom: e.clientY, left: e.clientX };
    let top = rect.bottom + 4;
    let left = isMe ? rect.right - menu.offsetWidth : rect.left;
    if (top + menu.offsetHeight > window.innerHeight - 10) top = rect.top - menu.offsetHeight - 4;
    if (left < 4) left = 4;
    if (left + menu.offsetWidth > window.innerWidth - 4) left = window.innerWidth - menu.offsetWidth - 4;
    menu.style.top  = top  + 'px';
    menu.style.left = left + 'px';

    // Cerrar al hacer click fuera
    setTimeout(() => {
        document.addEventListener('click', _cerrarMenuHilo, { once: true });
    }, 0);
}

/* ── Editar mensaje dentro del hilo ────────────────────────── */
let _threadEditState = null;

function _editarEnHilo(msgId) {
    // Obtener texto actual del DOM del hilo
    const li     = document.getElementById('thread_item_' + msgId);
    const textEl = li ? li.querySelector('.thread-msg-text') : null;
    const current = textEl ? (textEl.textContent || '').replace('(editado)', '').trim() : '';

    _threadEditState = { id: msgId };

    const threadInputEl = document.getElementById('threadInput');
    if (threadInputEl) {
        threadInputEl.value = current;
        threadInputEl.style.height = 'auto';
        threadInputEl.style.height = Math.min(threadInputEl.scrollHeight, 90) + 'px';
        threadInputEl.focus();
        threadInputEl.selectionStart = threadInputEl.selectionEnd = threadInputEl.value.length;
        threadInputEl.style.borderColor = '#f59e0b'; // naranja = modo edición
        threadInputEl.placeholder = '✏️ Editando mensaje del hilo…';
    }
}

function _cancelarEdicionHilo() {
    _threadEditState = null;
    const threadInputEl = document.getElementById('threadInput');
    if (threadInputEl) {
        threadInputEl.value = '';
        threadInputEl.style.height = 'auto';
        threadInputEl.style.borderColor = '';
        threadInputEl.placeholder = 'Responder en el hilo…';
    }
}

/* ── Eliminar mensaje dentro del hilo ──────────────────────── */
function _eliminarEnHilo(msgId) {
    if (!confirm('¿Eliminar este mensaje del hilo?')) return;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        mostrarToast('Sin conexión', true); return;
    }
    socket.send(JSON.stringify({ type: 'deleteMessage', id: msgId }));
    // Actualización optimista
    _onThreadMsgEliminado(msgId);
}

function _ocultarEnHilo(msgId) {
    try {
        const hidden = JSON.parse(localStorage.getItem('kvs_hidden_msgs') || '[]');
        if (!hidden.includes(msgId)) { hidden.push(msgId); localStorage.setItem('kvs_hidden_msgs', JSON.stringify(hidden)); }
    } catch(_) {}
    const li = document.getElementById('thread_item_' + msgId);
    if (li) li.remove();
    mostrarToast('Mensaje ocultado para ti');
}

function _onThreadMsgEliminado(msgId) {
    const li     = document.getElementById('thread_item_' + msgId);
    const textEl = li ? li.querySelector('.thread-msg-text') : null;
    if (textEl) {
        textEl.textContent = '🗑 Mensaje eliminado';
        textEl.classList.add('deleted');
        // Quitar badge (editado) si lo había
        const badge = li.querySelector('.thread-msg-edited');
        if (badge) badge.remove();
    }
    if (li) li.removeEventListener('click', li._menuHandler);
}

function _onThreadMsgEditado(msgId, newText) {
    const li     = document.getElementById('thread_item_' + msgId);
    const textEl = li ? li.querySelector('.thread-msg-text') : null;
    if (textEl) {
        textEl.innerHTML = escapeHTML(newText) + '<span class="thread-msg-edited">(editado)</span>';
    }
}

function onHistorialHilo(data) {
    if (data.threadId !== _threadId) return;
    // Actualizar el mensaje raíz con los datos del servidor (fiable en ambos dispositivos)
    if (data.rootMsg) {
        const root = data.rootMsg;
        document.getElementById('threadRootFrom').textContent = root.from || '';
        document.getElementById('threadRootText').textContent =
            (root.deletedAt ? '🗑 Mensaje eliminado' : (root.message || '')).slice(0, 200);
    }
    const ul = document.getElementById('threadMessages');
    ul.innerHTML = '';
    (data.messages || []).forEach(msg => ul.appendChild(_renderThreadMsg(msg)));
    ul.scrollTop = ul.scrollHeight;
}

function onMensajeHilo(data) {
    // Actualizar threadCount en conversations[] (fuente de verdad para recargas)
    Object.values(conversations).forEach(arr => {
        if (!Array.isArray(arr)) return;
        const m = arr.find(m => m.id === data.threadId);
        if (m) m.threadCount = data.threadCount;
    });

    // Actualizar el botón "🧵 N respuestas" en el chat principal si el div está en el DOM
    const threadDiv = document.getElementById('thread_' + data.threadId);
    if (threadDiv) {
        const count = data.threadCount;
        threadDiv.innerHTML = `<button class="thread-btn" onclick="abrirHilo('${data.threadId}')">🧵 ${count} respuesta${count > 1 ? 's' : ''}</button>`;
    }

    // Si el panel está abierto para este hilo
    if (_threadId === data.threadId) {
        const ul = document.getElementById('threadMessages');
        if (!ul) return;

        const incoming = data.msg;
        const isMyMsg  = incoming.from === username;

        if (isMyMsg) {
            // Confirmación del servidor: reemplazar el mensaje optimista local
            const localItems = ul.querySelectorAll('[id^="thread_item_local_thread_"]');
            let replaced = false;
            localItems.forEach(li => {
                if (!replaced) {
                    const textEl = li.querySelector('.thread-msg-text');
                    if (textEl && textEl.textContent.trim() === (incoming.message || '').trim()) {
                        const newLi = _renderThreadMsg(incoming);
                        li.replaceWith(newLi);
                        replaced = true;
                    }
                }
            });
            // Si no encontramos el optimista, añadir solo si no existe ya
            if (!replaced && !ul.querySelector('#thread_item_' + incoming.id)) {
                ul.appendChild(_renderThreadMsg(incoming));
                ul.scrollTop = ul.scrollHeight;
            }
        } else {
            // Mensaje del otro usuario: añadir si no existe ya
            if (!ul.querySelector('#thread_item_' + incoming.id)) {
                ul.appendChild(_renderThreadMsg(incoming));
                ul.scrollTop = ul.scrollHeight;
            }
        }
    }
}

// ============================================================
// IDIOMA DEL TECLADO
// ============================================================


// ============================================================
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


