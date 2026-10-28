#!/bin/bash
# ==============================================================================
# Solana Sniper Bot (Paper-Only) - Android APK Build Script
# ==============================================================================
set -e

echo "🚀 [1/4] Building web assets with Vite..."
npm run build

echo "📱 [2/4] Verifying Capacitor Android runtime..."
if [ ! -d "android" ]; then
  echo "Installing Capacitor CLI and core packages..."
  npm install @capacitor/core @capacitor/cli @capacitor/android
  npx cap add android
fi

echo "🔄 [3/4] Syncing web build to Android project..."
npx cap sync android

echo "🔨 [4/4] Compiling Android APK (Debug / Release)..."
if command -v ./android/gradlew &> /dev/null; then
  cd android
  ./gradlew assembleDebug
  cd ..
  echo "✅ APK Generated successfully:"
  echo "   Location: android/app/build/outputs/apk/debug/app-debug.apk"
  echo "   Copying to ./sniper-paper-bot.apk ..."
  cp android/app/build/outputs/apk/debug/app-debug.apk ./sniper-paper-bot.apk
  echo "🎉 Done! Your installable APK is ready at ./sniper-paper-bot.apk"
else
  echo "ℹ️  Gradle wrapper not found in local container. In CI or local Android Studio environment:"
  echo "   1. Open /android folder in Android Studio"
  echo "   2. Click Build -> Build Bundle(s) / APK(s) -> Build APK(s)"
  echo "   3. Or run: cd android && gradle assembleDebug"
  echo "   Or use the included GitHub Actions workflow in .github/workflows/android-apk.yml"
fi
