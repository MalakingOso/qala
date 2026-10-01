# Source this to get the Kotlin and Android toolchain on PATH:  source scripts/android-env.sh
# Everything lives under the home directory; nothing is installed system-wide.
export JAVA_HOME="$HOME/.local/jdk21"
export ANDROID_HOME="$HOME/Android/Sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/29.0.14206865"
export GRADLE_HOME="$HOME/.local/gradle-9.8.0"
# Keep Gradle's daemon from taking the machine down (see memory note on the cargo OOM).
export GRADLE_OPTS="${GRADLE_OPTS:--Xmx2g}"
export PATH="$JAVA_HOME/bin:$GRADLE_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$HOME/.cargo/bin:$PATH"
