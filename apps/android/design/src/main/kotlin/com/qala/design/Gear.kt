package com.qala.design

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * One of the owner's equipment renders (DECISIONS L14) scaled to fit inside [width] by [height], keeping its shape, as
 * the web's `GearImage` does. A decorative picture next to a row that names the thing, so it has no description.
 */
@Composable
fun GearImage(gear: QalaGear, modifier: Modifier = Modifier, width: Dp = 72.dp, height: Dp = 44.dp) {
    val k = minOf(width.value / gear.width, height.value / gear.height)
    Image(
        painter = painterResource(gear.drawable),
        contentDescription = null,
        modifier = modifier.size((gear.width * k).dp, (gear.height * k).dp),
        contentScale = ContentScale.Fit,
    )
}

/** A fixed-size slot for a render, so rows line up whether or not the item has one. */
@Composable
fun GearSlot(gear: QalaGear?, modifier: Modifier = Modifier, width: Dp = 72.dp, height: Dp = 44.dp) {
    Box(modifier.size(width, height), contentAlignment = Alignment.Center) {
        if (gear != null) GearImage(gear, width = width, height = height)
    }
}
