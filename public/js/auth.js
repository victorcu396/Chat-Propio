
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

