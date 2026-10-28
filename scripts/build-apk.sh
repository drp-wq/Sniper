#!/usr/bin/env bash
# Build & sign the installable Android APK (sniper-paper-bot.apk) using Android SDK 34 build-tools.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDK_DIR="${ANDROID_SDK_TMP:-/tmp/android-sdk}"
BUILD_TOOLS_DIR="$SDK_DIR/android-14"
PLATFORM_JAR="$SDK_DIR/android-34/android.jar"
JAVA_HOME_21="/usr/local/sdkman/candidates/java/21.0.12+1-ms"

if [ -d "$JAVA_HOME_21" ]; then
  export JAVA_HOME="$JAVA_HOME_21"
  export PATH="$JAVA_HOME/bin:$PATH"
fi

mkdir -p "$SDK_DIR"
if [ ! -x "$BUILD_TOOLS_DIR/aapt2" ]; then
  echo "Downloading Android build-tools 34..."
  curl -fsSL https://dl.google.com/android/repository/build-tools_r34-linux.zip -o "$SDK_DIR/build-tools.zip"
  unzip -q -o "$SDK_DIR/build-tools.zip" -d "$SDK_DIR"
fi

if [ ! -f "$PLATFORM_JAR" ]; then
  echo "Downloading Android platform 34..."
  curl -fsSL https://dl.google.com/android/repository/platform-34-ext7_r02.zip -o "$SDK_DIR/platform.zip"
  unzip -q -o "$SDK_DIR/platform.zip" -d "$SDK_DIR"
fi

WORK_DIR="/tmp/sniper-apk-build"
rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR/gen" "$WORK_DIR/obj" "$WORK_DIR/dex" "$WORK_DIR/compiled_res"

echo "1/6 Compiling Android resources with aapt2..."
"$BUILD_TOOLS_DIR/aapt2" compile \
  --dir "$ROOT_DIR/app/android/res" \
  -o "$WORK_DIR/compiled_res/resources.zip"

echo "2/6 Linking AndroidManifest, resources, and WebView assets..."
"$BUILD_TOOLS_DIR/aapt2" link \
  -o "$WORK_DIR/unaligned.apk" \
  -I "$PLATFORM_JAR" \
  --manifest "$ROOT_DIR/app/android/AndroidManifest.xml" \
  --java "$WORK_DIR/gen" \
  -A "$ROOT_DIR/app/assets" \
  --auto-add-overlay \
  "$WORK_DIR/compiled_res/resources.zip"

echo "3/6 Compiling Java sources (target Java 11 bytecode for Android D8)..."
javac \
  --release 11 \
  -cp "$PLATFORM_JAR" \
  -d "$WORK_DIR/obj" \
  "$WORK_DIR/gen/com/sniper/paperbot/R.java" \
  "$ROOT_DIR/app/android/src/com/sniper/paperbot/MainActivity.java"

echo "4/6 Converting JVM bytecode to Dalvik classes.dex with d8..."
CLASS_FILES=()
while IFS= read -r -d '' f; do
  CLASS_FILES+=("$f")
done < <(find "$WORK_DIR/obj" -name "*.class" -print0)

"$BUILD_TOOLS_DIR/d8" \
  --lib "$PLATFORM_JAR" \
  --min-api 24 \
  --output "$WORK_DIR/dex" \
  "${CLASS_FILES[@]}"

(cd "$WORK_DIR/dex" && zip -q -u "$WORK_DIR/unaligned.apk" classes.dex)

echo "5/6 Aligning APK with zipalign..."
"$BUILD_TOOLS_DIR/zipalign" -f -p 4 \
  "$WORK_DIR/unaligned.apk" \
  "$WORK_DIR/aligned.apk"

KEYSTORE="/tmp/sniper-debug.keystore"
if [ ! -f "$KEYSTORE" ]; then
  keytool -genkeypair \
    -v \
    -keystore "$KEYSTORE" \
    -storepass android \
    -keypass android \
    -alias androiddebugkey \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -dname "CN=Android Debug,O=Android,C=US" >/dev/null 2>&1
fi

OUT_APK="$ROOT_DIR/sniper-paper-bot.apk"
echo "6/6 Signing APK (v1/v2/v3) -> $OUT_APK..."
"$BUILD_TOOLS_DIR/apksigner" sign \
  --ks "$KEYSTORE" \
  --ks-pass pass:android \
  --key-pass pass:android \
  --ks-key-alias androiddebugkey \
  --out "$OUT_APK" \
  "$WORK_DIR/aligned.apk"

"$BUILD_TOOLS_DIR/apksigner" verify --verbose "$OUT_APK" | head -n 6
ls -lh "$OUT_APK"
echo "APK_BUILD_SUCCESS: $OUT_APK"
