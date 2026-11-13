package com.qala.design

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily

private val LocalPalette = staticCompositionLocalOf { QalaPalette.Light }
private val LocalDark = staticCompositionLocalOf { false }

/** The colour that text and icons use when the caller doesn't pick one. Buttons set it for their label. */
internal val LocalContentColor = compositionLocalOf { Color.Unspecified }

object Qala {
    val colors: QalaPalette
        @Composable @ReadOnlyComposable get() = LocalPalette.current

    /** True under the dark palette, for the few values that are not tokens (the rail chrome). */
    val dark: Boolean
        @Composable @ReadOnlyComposable get() = LocalDark.current
}

/** Light or dark (the shell resolves Settings' Light, Dark or System), and the face the titles are set in. */
@Composable
fun QalaTheme(dark: Boolean = isSystemInDarkTheme(), titleFamily: FontFamily = QalaTestFamily, content: @Composable () -> Unit) {
    CompositionLocalProvider(
        LocalPalette provides if (dark) QalaPalette.Dark else QalaPalette.Light,
        LocalDark provides dark,
        LocalTitleFamily provides titleFamily,
        content = content,
    )
}
