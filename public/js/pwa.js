
// ── Registro del Service Worker + suscripción Push ──────────
let _swRegistration = null;   // referencia global al SW registrado
let _pushSubscription = null; // suscripción push activa

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => {
                console.log('[SW] Registrado:', reg.scope);
                _swRegistration = reg;
            })
            .catch(err => console.warn('[SW] Error al registrar:', err));
    });

    // Escuchar mensajes del SW (p.ej. OPEN_CHAT al tocar una notificación)
    navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'OPEN_CHAT') {
            const chatKey = event.data.chatKey;
            if (!chatKey || typeof chatKey !== 'string') return;
            // Guardar siempre como pendiente y usar el sistema reactivo,
            // que espera a que contactos y grupos estén cargados antes de navegar
            window._pendingOpenChat = chatKey;
            // Si el socket ya está conectado y los datos ya cargaron, abrir de inmediato
            if (typeof socket !== 'undefined' && socket && socket.readyState === 1
                && typeof _contactosListos !== 'undefined' && _contactosListos
                && typeof _gruposListos !== 'undefined' && _gruposListos) {
                if (typeof _ejecutarAperturaChatPendiente === 'function') {
                    _ejecutarAperturaChatPendiente();
                }
            }
            // Si no, _abrirChatPendienteDesdeNotif se llamará cuando terminen cargarContactos/cargarGrupos
        }
    });
}

// Abrir chat pendiente si venimos de una notificación push (URL con ?openChat=)
window.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const openChat = params.get('openChat');
    if (openChat) {
        window._pendingOpenChat = openChat;
        // Limpiar la URL sin recargar
        history.replaceState({}, '', '/');
    }
    // Empujar un estado base para que el botón atrás siempre tenga algo que interceptar
    if (_esMobile()) {
        history.pushState({ kvs: 'menu' }, '');
    }
});

// ── Capturar evento de instalación PWA ───────────────────────
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const btn = document.getElementById('btnInstalarPWA');
    if (btn) btn.style.display = 'flex';
});
window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    const btn = document.getElementById('btnInstalarPWA');
    if (btn) btn.style.display = 'none';
});
async function instalarPWA() {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    console.log('[PWA] Resultado instalación:', outcome);
    deferredInstallPrompt = null;
    const btn = document.getElementById('btnInstalarPWA');
    if (btn) btn.style.display = 'none';
}

// ── Botón atrás del sistema → volver al menú/lista ───────────
// Funciona en Android (botón físico/gestual) e iOS (gesto swipe back en PWA)
// Estrategia: cuando se abre un chat, empujamos un estado al historial.
// Al pulsar atrás, el navegador dispara 'popstate' y nosotros volvemos
// al sidebar en vez de salir de la app.

// ── Helpers de navegación móvil ─────────────────────────────────────────────
function _esMobile() {
    return window.innerWidth <= 900 || document.documentElement.classList.contains('is-mobile');
}

function _pushChatState() {
    const esMobil = _esMobile();
    if (!esMobil) return;
    if (!history.state || history.state.kvs !== 'chat') {
        history.pushState({ kvs: 'chat' }, '');
    }
}

function _volverAlMenu() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebar && !sidebar.classList.contains('visible')) {
        sidebar.classList.add('visible');
        if (overlay) overlay.classList.add('visible');
    }
}

// Alias para compatibilidad con botón atrás del header
function volverALista() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebar && sidebar.classList.contains('visible')) {
        sidebar.classList.remove('visible');
        if (overlay) overlay.classList.remove('visible');
    }
}

window.addEventListener('popstate', (e) => {
    const esMobil = window.innerWidth <= 900 || document.documentElement.classList.contains('is-mobile');
    if (!esMobil) return;

    // Si el panel de hilo está abierto, cerrarlo primero
    const threadPanel = document.getElementById('threadPanel');
    if (threadPanel && threadPanel.classList.contains('open')) {
        cerrarHilo();
        history.pushState({ kvs: 'chat' }, '');
        return;
    }

    // Si hay algún modal abierto, cerrarlo primero
    const modalesAbiertos = [
        document.getElementById('avatarModal'),
        document.getElementById('settingsModal'),
        document.getElementById('addContactModal'),
        document.getElementById('newGroupModal'),
        document.getElementById('editGroupModal'),
        document.getElementById('contactRequestModal'),
    ].filter(m => m && (m.classList.contains('visible') || m.classList.contains('open')
        || (m.style && m.style.display && m.style.display !== 'none')));

    if (modalesAbiertos.length > 0) {
        modalesAbiertos.forEach(m => {
            m.classList.remove('visible');
            m.classList.remove('open');
            if (m.style) m.style.display = 'none';
        });
        history.pushState({ kvs: 'chat' }, '');
        return;
    }

    // Si el sidebar está oculto (estamos dentro de un chat) → volver al menú
    const sidebar = document.getElementById('sidebar');
    if (sidebar && !sidebar.classList.contains('visible')) {
        _volverAlMenu();
        // Volver a empujar un estado base para que la siguiente pulsación
        // de atrás no saque al usuario de la app
        history.pushState({ kvs: 'menu' }, '');
        return;
    }

    // Si el sidebar está visible (estamos en el menú) → empujar estado base
    // para interceptar la siguiente pulsación y evitar salir de la app
    history.pushState({ kvs: 'menu' }, '');
});

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('visible');
    document.getElementById('sidebarOverlay').classList.toggle('visible');
}

// ── Swipe para abrir/cerrar sidebar en móvil ────────────────────────────────
(function initSwipeGestures() {
    let touchStartX = 0;
    let touchStartY = 0;
    let isSwiping = false;
    const EDGE_THRESHOLD = 22;   // px desde el borde izquierdo para activar swipe-open
    const SWIPE_MIN = 55;        // px mínimos de swipe para considerar gesto

    document.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        isSwiping = false;
        const sidebar = document.getElementById('sidebar');
        const isMobil = window.innerWidth <= 900 || document.documentElement.classList.contains('is-mobile');
        if (!isMobil) return;
        // Swipe-open: solo desde el borde izquierdo cuando sidebar está oculto
        if (!sidebar.classList.contains('visible') && touchStartX <= EDGE_THRESHOLD) {
            isSwiping = true;
        }
        // Swipe-close: desde cualquier parte cuando sidebar está abierto
        if (sidebar.classList.contains('visible')) {
            isSwiping = true;
        }
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
        if (!isSwiping) return;
        const isMobil = window.innerWidth <= 900 || document.documentElement.classList.contains('is-mobile');
        if (!isMobil) return;
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = Math.abs(e.changedTouches[0].clientY - touchStartY);
        if (dy > 60) return; // swipe más vertical que horizontal → ignorar
        const sidebar = document.getElementById('sidebar');
        // Swipe derecha (>55px) → abrir sidebar
        if (dx > SWIPE_MIN && !sidebar.classList.contains('visible') && touchStartX <= EDGE_THRESHOLD) {
            sidebar.classList.add('visible');
            document.getElementById('sidebarOverlay').classList.add('visible');
        }
        // Swipe izquierda (<-55px) → cerrar sidebar
        if (dx < -SWIPE_MIN && sidebar.classList.contains('visible')) {
            sidebar.classList.remove('visible');
            document.getElementById('sidebarOverlay').classList.remove('visible');
        }
        isSwiping = false;
    }, { passive: true });
})();

// ── Feedback háptico al enviar mensaje (solo si el dispositivo lo soporta) ──
function _vibrarEnvio() {
    try {
        if (navigator.vibrate) navigator.vibrate(30);
    } catch(_) {}
}


