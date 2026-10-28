/**
 * Android APK Packaging & Installation Modal
 * Guides user on installable Android .apk output, Capacitor sync,
 * foreground service permissions, and direct PWA mobile installation.
 */

import React, { useState, useEffect } from 'react';
import {
  X,
  Smartphone,
  Download,
  Terminal,
  ShieldCheck,
  Check,
  Copy,
  ExternalLink,
  Layers,
} from 'lucide-react';

interface ApkModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ApkModal: React.FC<ApkModalProps> = ({ isOpen, onClose }) => {
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isPwaInstalled, setIsPwaInstalled] = useState(false);

  useEffect(() => {
    const handleBeforeInstall = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  if (!isOpen) return null;

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCmd(id);
    setTimeout(() => setCopiedCmd(null), 2000);
  };

  const handleInstallPwa = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setIsPwaInstalled(true);
      }
      setDeferredPrompt(null);
    } else {
      alert('To install on Android: Tap the 3 dots menu in Chrome -> Tap "Install app" or "Add to Home screen".');
    }
  };

  const buildCmd = './scripts/build-apk.sh';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm font-mono text-xs">
      <div className="bg-[#111827] border border-[#1F2937] rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-sm text-white">Android Mobile Packaging (.apk)</div>
              <div className="text-[11px] text-zinc-400">Capacitor Android Runtime & Foreground Service</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          
          {/* Direct Download Pre-Built Signed APK */}
          <div className="p-3.5 rounded-xl bg-gradient-to-r from-cyan-950/50 via-zinc-900 to-zinc-900 border border-cyan-500/40 flex items-center justify-between gap-3">
            <div>
              <div className="font-bold text-white text-xs flex items-center gap-1.5">
                <Download className="w-4 h-4 text-cyan-400" />
                <span>Download Signed Android APK (sniper-paper-bot.apk)</span>
              </div>
              <div className="text-[11px] text-zinc-400 mt-0.5">
                Pre-built &amp; v2/v3 signed Android APK with integrated React Command Center &amp; native HTTP bridge.
              </div>
            </div>
            <a
              href="/download/sniper-paper-bot.apk"
              download="sniper-paper-bot.apk"
              className="px-3.5 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-xs shrink-0 cursor-pointer shadow-md"
            >
              Download .APK
            </a>
          </div>

          {/* Direct Install PWA Option */}
          <div className="p-3.5 rounded-xl bg-gradient-to-r from-emerald-950/40 via-zinc-900 to-zinc-900 border border-emerald-500/30 flex items-center justify-between gap-3">
            <div>
              <div className="font-bold text-white text-xs flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Instant Mobile Install (Android PWA)</span>
              </div>
              <div className="text-[11px] text-zinc-400 mt-0.5">
                Install directly onto your Android device home screen with standalone windowing and wake-lock.
              </div>
            </div>
            <button
              onClick={handleInstallPwa}
              className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs shrink-0 cursor-pointer shadow-md"
            >
              {isPwaInstalled ? 'Installed' : 'Install PWA'}
            </button>
          </div>

          {/* Android Permissions Configured */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5 space-y-2">
            <div className="font-bold text-white text-xs">
              Configured Android Permissions (AndroidManifest.xml)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px] text-zinc-300">
              <div className="flex items-center gap-1.5 bg-zinc-950/60 p-1.5 rounded border border-zinc-800">
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>android.permission.INTERNET</span>
              </div>
              <div className="flex items-center gap-1.5 bg-zinc-950/60 p-1.5 rounded border border-zinc-800">
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>android.permission.WAKE_LOCK</span>
              </div>
              <div className="flex items-center gap-1.5 bg-zinc-950/60 p-1.5 rounded border border-zinc-800">
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>android.permission.FOREGROUND_SERVICE</span>
              </div>
              <div className="flex items-center gap-1.5 bg-zinc-950/60 p-1.5 rounded border border-zinc-800">
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>FOREGROUND_SERVICE_DATA_SYNC</span>
              </div>
            </div>
          </div>

          {/* One-Command Build Script */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <div className="font-bold text-white text-xs flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                <span>One-Command APK Build Script</span>
              </div>
              <button
                onClick={() => handleCopy(buildCmd, 'build')}
                className="flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300"
              >
                {copiedCmd === 'build' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                <span>{copiedCmd === 'build' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            <div className="p-2.5 rounded bg-black/80 border border-zinc-800 text-emerald-400 select-all overflow-x-auto text-xs">
              chmod +x ./scripts/build-apk.sh && ./scripts/build-apk.sh
            </div>

            <div className="text-[11px] text-zinc-400">
              Compiles web assets, syncs Capacitor Android native wrapper, and generates signed/debug <code className="text-white">sniper-paper-bot.apk</code>.
            </div>
          </div>

          {/* GitHub Actions CI Packaging */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5 space-y-2">
            <div className="font-bold text-white text-xs flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-purple-400" />
              <span>Automated GitHub Actions CI Workflow</span>
            </div>
            <p className="text-[11px] text-zinc-400">
              The project includes <code className="text-zinc-200">.github/workflows/android-apk.yml</code>. Every commit or manual trigger on GitHub builds and uploads the signed <code className="text-zinc-200">sniper-paper-bot-debug.apk</code> as a downloadable artifact.
            </p>
          </div>

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white font-bold text-xs cursor-pointer"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
};
