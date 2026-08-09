import { useState, useEffect } from 'react';
import { Download, X, Share, PlusSquare } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || 
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isInStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false;
  
  // Check display-mode media query (works on most browsers)
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  
  // Check iOS standalone mode
  if ((navigator as unknown as { standalone?: boolean }).standalone === true) return true;
  
  // Check if running in TWA (Trusted Web Activity)
  if (document.referrer.includes('android-app://')) return true;
  
  return false;
}

export default function PWAInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [isIOSDevice] = useState(isIOS());

  useEffect(() => {
    // Don't show if already installed
    if (isInStandaloneMode()) return;

    // Check if dismissed in this session
    const wasDismissed = sessionStorage.getItem('pwa-banner-dismissed');
    if (wasDismissed) {
      setDismissed(true);
      return;
    }

    // For non-iOS devices, listen for beforeinstallprompt
    if (!isIOSDevice) {
      const handler = (e: Event) => {
        e.preventDefault();
        setDeferredPrompt(e as BeforeInstallPromptEvent);
        setShowBanner(true);
      };

      window.addEventListener('beforeinstallprompt', handler);

      // Also show after a delay if no prompt (browser might not support it)
      const timer = setTimeout(() => {
        setShowBanner(true);
      }, 3000);

      return () => {
        window.removeEventListener('beforeinstallprompt', handler);
        clearTimeout(timer);
      };
    } else {
      // For iOS, show banner after a short delay
      const timer = setTimeout(() => {
        setShowBanner(true);
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [isIOSDevice]);

  const handleInstall = async () => {
    if (isIOSDevice) {
      setShowIOSInstructions(true);
      return;
    }

    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      if (result.outcome === 'accepted') {
        setShowBanner(false);
      }
      setDeferredPrompt(null);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    setShowBanner(false);
    setShowIOSInstructions(false);
    sessionStorage.setItem('pwa-banner-dismissed', 'true');
  };

  // Don't render if standalone or dismissed
  if (isInStandaloneMode() || dismissed || !showBanner) return null;

  return (
    <>
      {/* Main Install Banner */}
      <div className="bg-primary text-white px-4 py-2.5 flex items-center justify-between gap-3 animate-fade-in z-50 relative">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Download className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm font-medium truncate">
            {isIOSDevice ? 'Add Adimat to Home Screen' : 'Install Adimat App'}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleInstall}
            className="bg-white text-primary px-3 py-1.5 rounded-full text-xs font-bold touch-target flex items-center justify-center gap-1"
          >
            {isIOSDevice ? (
              <>
                <Share className="w-3 h-3" />
                How
              </>
            ) : (
              'Install'
            )}
          </button>
          <button
            onClick={handleDismiss}
            className="p-1.5 rounded-full hover:bg-white/20 touch-target flex items-center justify-center"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* iOS Instructions Modal */}
      {showIOSInstructions && (
        <div className="sheet-backdrop animate-fade-in" style={{ zIndex: 100, background: 'rgba(15,23,42,0.7)' }}>
          <div className="sheet-panel p-6 animate-slide-up">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">Install Adimat</h2>
              <button 
                onClick={() => setShowIOSInstructions(false)}
                className="p-2 rounded-full hover:bg-gray-100 touch-target"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-gray-600 text-sm mb-6">
              Install this app on your iPhone for the best experience:
            </p>

            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-blue-600 font-bold">1</span>
                </div>
                <div>
                  <p className="font-medium text-gray-900 flex items-center gap-2">
                    Tap the Share button
                    <Share className="w-5 h-5 text-blue-500" />
                  </p>
                  <p className="text-sm text-gray-500">
                    Find it at the bottom of Safari
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-blue-600 font-bold">2</span>
                </div>
                <div>
                  <p className="font-medium text-gray-900 flex items-center gap-2">
                    Tap "Add to Home Screen"
                    <PlusSquare className="w-5 h-5 text-gray-600" />
                  </p>
                  <p className="text-sm text-gray-500">
                    Scroll down in the share menu
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-blue-600 font-bold">3</span>
                </div>
                <div>
                  <p className="font-medium text-gray-900">Tap "Add"</p>
                  <p className="text-sm text-gray-500">
                    Adimat will appear on your home screen
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-6 p-4 bg-amber-50 rounded-xl">
              <p className="text-amber-800 text-sm">
                <strong>Note:</strong> You must use Safari browser on iOS. Other browsers don't support installing web apps.
              </p>
            </div>

            <button
              onClick={() => setShowIOSInstructions(false)}
              className="w-full mt-6 py-3 bg-primary text-white rounded-xl font-bold touch-target"
            >
              Got it!
            </button>
          </div>
        </div>
      )}
    </>
  );
}
