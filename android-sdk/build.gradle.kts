// Корневой build-файл проекта Android SDK.
// Версии плагинов задаются в settings.gradle.kts (pluginManagement).
plugins {
    id("com.android.application") apply false
    id("com.android.library") apply false
    id("org.jetbrains.kotlin.android") apply false
    id("org.jetbrains.kotlin.plugin.serialization") apply false
}
