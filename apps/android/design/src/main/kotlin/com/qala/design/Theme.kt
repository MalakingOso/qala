package com.qala.design

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

private val LocalPalette = staticCompositionLocalOf { QalaPalette.Light }

/** The colour that text and icons use when the caller doesn't pick one. Buttons set it for their label. */
internal val LocalContentColor = compositionLocalOf { Color.Unspecified }

object Qala {
    val colors: QalaPalette
        @Composable @ReadOnlyComposable get() = LocalPalette.current
}

/** Light or dark from the system for now; a Settings override arrives with the Settings screen. */
@Composable
fun QalaTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    CompositionLocalProvider(
        LocalPalette provides if (dark) QalaPalette.Dark else QalaPalette.Light,
        content = content,
    )
}
