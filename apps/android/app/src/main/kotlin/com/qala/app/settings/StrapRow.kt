package com.qala.app.settings

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import com.qala.app.AppContainer
import com.qala.app.run.FoundStrap
import com.qala.app.run.StrapPicker
import com.qala.app.run.hasScanPermission
import com.qala.data.QalaJson
import com.qala.data.db.MetaEntity
import com.qala.data.db.MetaKeys
import com.qala.design.GroupRow
import com.qala.design.LinkButton
import com.qala.design.Qala
import com.qala.design.QalaText
import com.qala.design.QalaType
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/** The heart-rate strap row of Running: the strap picked (this install's, in the meta table) and a button that scans for one. */
@Composable
fun StrapRow(container: AppContainer) {
    val context = LocalContext.current
    var name by remember { mutableStateOf<String?>(null) }
    var open by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        name = container.database.metaDao().get(MetaKeys.RUN_STRAP)?.let { (QalaJson.parseToJsonElement(it) as? JsonObject)?.get("name")?.jsonPrimitive?.contentOrNull }
    }
    val permissions = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { open = hasScanPermission(context) }
    fun pick(strap: FoundStrap?) {
        open = false
        name = strap?.name
        container.scope.launch {
            if (strap == null) {
                container.database.metaDao().remove(MetaKeys.RUN_STRAP)
            } else {
                val json = buildJsonObject { put("address", strap.address); put("name", strap.name) }
                container.database.metaDao().put(MetaEntity(MetaKeys.RUN_STRAP, json.toString()))
            }
        }
    }
    GroupRow(last = true) {
        QalaText("Heart-rate strap", Modifier.weight(1f), QalaType.body)
        QalaText(name ?: "None", style = QalaType.hint, color = Qala.colors.fgMuted)
        LinkButton(
            if (name == null) "Pick" else "Change",
            onClick = {
                if (hasScanPermission(context)) open = true
                else permissions.launch(arrayOf(android.Manifest.permission.BLUETOOTH_SCAN, android.Manifest.permission.BLUETOOTH_CONNECT))
            },
            Modifier.semantics { contentDescription = "Pick a heart-rate strap" },
        )
    }
    StrapPicker(open = open, onClose = { open = false }, onPick = ::pick)
}
