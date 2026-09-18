// PWA Install Prompt & Toast Notification Manager
const installToast = document.getElementById('install-toast');
const btnInstallApp = document.getElementById('btn-install-app');

let deferredInstallPrompt = null;

export function isStandaloneApp() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export function updateInstallButtonVisibility() {
  if (isStandaloneApp()) {
    btnInstallApp?.classList.add('hidden');
  }
}

export function showInstallToast(message) {
  if (!installToast) return;
  installToast.textContent = message;
  installToast.classList.add('visible');
  window.clearTimeout(showInstallToast.timer);
  showInstallToast.timer = window.setTimeout(() => {
    installToast.classList.remove('visible');
  }, 5000);
}

export function initToastAndInstall() {
  updateInstallButtonVisibility();

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    btnInstallApp?.classList.add('available');
    updateInstallButtonVisibility();
  });

  btnInstallApp?.addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        showInstallToast('BRUTAL PARTY ana ekrana eklendi.');
      }
      deferredInstallPrompt = null;
      btnInstallApp.classList.remove('available');
      return;
    }

    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    showInstallToast(
      isIos
        ? 'Safari: Paylaş → Ana Ekrana Ekle seçeneğini kullan.'
        : 'Tarayıcı menüsünden "Ana ekrana ekle" veya "Uygulamayı yükle" seçeneğini kullan.'
    );
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    btnInstallApp?.classList.add('hidden');
    showInstallToast('BRUTAL PARTY ana ekrana eklendi.');
  });
}
