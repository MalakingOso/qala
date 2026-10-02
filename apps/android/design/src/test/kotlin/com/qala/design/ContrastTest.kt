package com.qala.design

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.pow

/**
 * The same WCAG 4.5 pairs as apps/web/src/logic/themeContrast.test.ts, checked on the generated Kotlin palettes.
 * That test guards tokens.css; this one guards what the generator emitted from it.
 */
class ContrastTest {
    private fun channel(c: Float): Double =
        if (c <= 0.03928f) c / 12.92 else ((c + 0.055) / 1.055).pow(2.4)

    private fun luminance(c: Color): Double =
        0.2126 * channel(c.red) + 0.7152 * channel(c.green) + 0.0722 * channel(c.blue)

    private fun ratio(a: Color, b: Color): Double {
        val (hi, lo) = listOf(luminance(a), luminance(b)).sortedDescending()
        return (hi + 0.05) / (lo + 0.05)
    }

    private fun pairs(p: QalaPalette): List<Triple<String, Color, Color>> = listOf(
        Triple("fg on bg", p.fg, p.bg),
        Triple("fgSecondary on bg", p.fgSecondary, p.bg),
        Triple("fgMuted on bg", p.fgMuted, p.bg),
        Triple("fg on bgSurface", p.fg, p.bgSurface),
        Triple("fgSecondary on bgSurface", p.fgSecondary, p.bgSurface),
        Triple("fgMuted on bgSurface", p.fgMuted, p.bgSurface),
        Triple("accent on bg", p.accent, p.bg),
        Triple("accent on bgSurface", p.accent, p.bgSurface),
        Triple("danger on bg", p.danger, p.bg),
        Triple("success on bg", p.success, p.bg),
        Triple("noteInk on note", p.noteInk, p.note),
        Triple("onAccent on accent", p.onAccent, p.accent),
    )

    private fun check(name: String, palette: QalaPalette) {
        val failures = pairs(palette).filter { (_, text, ground) -> ratio(text, ground) < 4.5 }
        assertTrue("$name contrast failures: ${failures.map { it.first }}", failures.isEmpty())
    }

    @Test fun lightPairsMeetWcagAa() = check("light", QalaPalette.Light)

    @Test fun darkPairsMeetWcagAa() = check("dark", QalaPalette.Dark)

    @Test
    fun darkIsNotJustLight() {
        assertTrue(QalaPalette.Dark.bg != QalaPalette.Light.bg)
        assertTrue(QalaPalette.Dark.accent != QalaPalette.Light.accent)
    }
}
