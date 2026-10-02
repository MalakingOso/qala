package com.qala.design

import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.takeOrElse
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

// Resource fonts, never a family-name lookup: Qala Test V2's internal family name is "Qala Test V2" and DM Mono
// Medium's name table says Regular, so the weights are declared here.
val QalaTestFamily = FontFamily(
    Font(R.font.qalatest_medium, FontWeight.Medium),
    Font(R.font.qalatest_bold, FontWeight.Bold),
)

/**
 * Recursive, one variable file (wght 300-1000, slnt -15..0, OFL). Its default instance is weight 300, so every
 * face names its weight and slant explicitly. UI text only (DECISIONS L19): digits are tabular by default, so
 * stat columns align with no feature flag.
 */
val RecursiveFamily = FontFamily(
    recursive(FontWeight.Normal, 400),
    recursive(FontWeight.Medium, 500),
    recursive(FontWeight.SemiBold, 600),
    recursive(FontWeight.Bold, 700),
    recursive(FontWeight.Normal, 400, oblique = true),
    recursive(FontWeight.Medium, 500, oblique = true),
)

private fun recursive(weight: FontWeight, wght: Int, oblique: Boolean = false) = Font(
    R.font.recursive_slnt_wght,
    weight,
    if (oblique) FontStyle.Italic else FontStyle.Normal,
    variationSettings = FontVariation.Settings(
        FontVariation.weight(wght),
        FontVariation.slant(if (oblique) -15f else 0f),
    ),
)

val DmMonoFamily = FontFamily(
    Font(R.font.dmmono_regular, FontWeight.Normal),
    Font(R.font.dmmono_medium, FontWeight.Medium),
)

// Compose keeps a font's own ascent above the first line (Trim.None) or drops the leading altogether (Trim.Both).
// Neither is a CSS line box. Trim.None with a centred line matches CSS exactly for DM Mono; Qala Test's tall glyph
// bounds make its titles 3 to 4 dp taller than the web's (a 32 sp title measures 40.8 dp against 36.8). Measured
// on the emulator against the web render, so it is known and small, not fixed.
private val CssLeading = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None)

private fun title(size: Int, lineHeight: Float) = TextStyle(
    fontFamily = QalaTestFamily,
    fontWeight = FontWeight.Bold,
    fontSize = size.sp,
    lineHeight = (size * lineHeight).sp,
    lineHeightStyle = CssLeading,
    letterSpacing = 0.sp,
)

private fun ui(
    size: Float,
    lineHeight: Float,
    weight: FontWeight = FontWeight.Normal,
    style: FontStyle = FontStyle.Normal,
) = TextStyle(
    fontFamily = RecursiveFamily,
    fontWeight = weight,
    fontStyle = style,
    fontSize = size.sp,
    lineHeight = (size * lineHeight).sp,
    lineHeightStyle = CssLeading,
)

private fun mono(size: Int, lineHeight: Float, weight: FontWeight = FontWeight.Normal) = TextStyle(
    fontFamily = DmMonoFamily,
    fontWeight = weight,
    fontSize = size.sp,
    lineHeight = (size * lineHeight).sp,
    lineHeightStyle = CssLeading,
)

/**
 * The nine levels of the phone refresh (mockups/font-levels.html, DECISIONS L19). Qala Test owns brand moments,
 * page titles and hero numerals. Recursive owns everything UI. DM Mono keeps records.
 */
object QalaType {
    // Brand moments: Qala Test.
    val pageTitle = title(32, 1.15f)
    val stageTitle = title(28, 1.15f)
    val wordmark = title(27, 1f)

    /** Hero numerals (timers, top sets, stat tiles). Qala Test figures are proportional; a figure that ticks uses [ticking]. */
    val figure = title(32, 1.2f)
    val ticking = figure.copy(fontFeatureSettings = "tnum, lnum")

    // UI text: Recursive.
    val cardTitle = ui(17f, 1.3f, FontWeight.SemiBold)
    val body = ui(14.5f, 1.5f)
    val bodyStrong = ui(14.5f, 1.5f, FontWeight.SemiBold)

    /** A stat in a column: tabular by default, so rows align without a feature flag. */
    val stat = ui(15f, 1.4f, FontWeight.SemiBold)
    val button = ui(14f, 1.5f, FontWeight.SemiBold)
    val buttonLarge = ui(15f, 1.5f, FontWeight.SemiBold)

    /** The small uppercase label. Set the text uppercase at the call site; Compose has no text-transform. */
    val groupLabel = ui(11f, 1.5f, FontWeight.SemiBold).copy(letterSpacing = 0.09.em)
    val hint = ui(13f, 1.5f, style = FontStyle.Italic)
    val figureUnit = ui(12f, 1.5f, FontWeight.Medium)
    val tabLabel = ui(10f, 1.5f, FontWeight.Medium)

    // Records: DM Mono.
    val log = mono(13, 1.5f)
}

@Composable
fun QalaText(
    text: String,
    modifier: Modifier = Modifier,
    style: TextStyle = QalaType.body,
    color: Color = Color.Unspecified,
    textAlign: TextAlign = TextAlign.Unspecified,
    maxLines: Int = Int.MAX_VALUE,
) = QalaText(AnnotatedString(text), modifier, style, color, textAlign, maxLines)

@Composable
fun QalaText(
    text: AnnotatedString,
    modifier: Modifier = Modifier,
    style: TextStyle = QalaType.body,
    color: Color = Color.Unspecified,
    textAlign: TextAlign = TextAlign.Unspecified,
    maxLines: Int = Int.MAX_VALUE,
) {
    val resolved = color.takeOrElse { LocalContentColor.current.takeOrElse { Qala.colors.fg } }
    BasicText(
        text = text,
        modifier = modifier,
        style = style.copy(color = resolved, textAlign = textAlign),
        overflow = TextOverflow.Ellipsis,
        maxLines = maxLines,
    )
}

/** The uppercase mono label that heads a group or names a stage. */
@Composable
fun GroupLabel(text: String, modifier: Modifier = Modifier, color: Color = Qala.colors.fgMuted) =
    QalaText(text.uppercase(), modifier, QalaType.groupLabel, color)
