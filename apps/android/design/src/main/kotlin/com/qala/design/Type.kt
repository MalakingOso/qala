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

private fun mono(size: Int, lineHeight: Float, weight: FontWeight = FontWeight.Normal) = TextStyle(
    fontFamily = DmMonoFamily,
    fontWeight = weight,
    fontSize = size.sp,
    lineHeight = (size * lineHeight).sp,
    lineHeightStyle = CssLeading,
)

/** The type roles of DESIGN 3.1, with the sizes and line heights index.css gives the phone shell. */
object QalaType {
    val pageTitle = title(32, 1.15f)
    val stageTitle = title(28, 1.15f)
    val cardTitle = title(21, 1.25f)
    val wordmark = title(27, 1f)

    /** Figures are proportional; a figure that ticks (a clock, a pace) uses [ticking]. */
    val figure = title(32, 1.2f)
    val ticking = figure.copy(fontFeatureSettings = "tnum, lnum")

    val body = mono(14, 1.5f)
    val bodyStrong = mono(14, 1.5f, FontWeight.Medium)
    val button = mono(14, 1.5f, FontWeight.Medium)
    val buttonLarge = mono(15, 1.5f, FontWeight.Medium)

    /** The small uppercase mono label. Set the text uppercase at the call site; Compose has no text-transform. */
    val groupLabel = mono(11, 1.5f, FontWeight.Medium).copy(letterSpacing = 0.09.em)
    val hint = mono(12, 1.65f)
    val figureUnit = mono(12, 1.5f)
    val tabLabel = mono(10, 1.5f)
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
