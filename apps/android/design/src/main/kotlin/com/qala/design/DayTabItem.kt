package com.qala.design

import androidx.compose.ui.graphics.vector.ImageVector

/**
 * One tab of the Plan screen's day row: the weekday [name] over the day of the month [date], then a [glyph]. The selected tab is
 * ink, like every picked cell, and today's name reads in ember when it is not the one picked. [done] tints the glyph teal; [struck]
 * draws the name and date through, for a day that was skipped or not logged. [description] is what a screen reader says.
 */
class DayTabItem(
    val name: String,
    val date: String,
    val glyph: ImageVector,
    val description: String,
    val selected: Boolean,
    val today: Boolean = false,
    val done: Boolean = false,
    val struck: Boolean = false,
)
