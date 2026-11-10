package dev.agenthive.watch.qs

import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import dev.agenthive.watch.device.PhoneBridge
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Quick-settings tile in the swipe-down shade — mirrors the built-in
 * assistant's QS surfaces (SoundSearchTileService on the phone does this
 * via android.service.quicksettings). One tap rings the paired phone.
 */
class HiveQsService : TileService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override fun onStartListening() {
        qsTile?.apply {
            label = "Find phone"
            subtitle = "AgentHive"
            state = Tile.STATE_INACTIVE
            updateTile()
        }
    }

    override fun onClick() {
        super.onClick()
        qsTile?.apply {
            state = Tile.STATE_ACTIVE
            subtitle = "Ringing…"
            updateTile()
        }
        scope.launch {
            PhoneBridge.findPhone(applicationContext)
            qsTile?.apply {
                state = Tile.STATE_INACTIVE
                subtitle = "AgentHive"
                updateTile()
            }
        }
    }

}

