package dev.agenthive.watch.tile

import androidx.concurrent.futures.CallbackToFutureAdapter
import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.DeviceParametersBuilders
import androidx.wear.protolayout.DimensionBuilders
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.protolayout.material.CompactChip
import androidx.wear.protolayout.material.Text
import androidx.wear.protolayout.material.layouts.PrimaryLayout
import androidx.wear.tiles.RequestBuilders.ResourcesRequest
import androidx.wear.tiles.RequestBuilders.TileRequest
import androidx.wear.tiles.TileBuilders.Tile
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.ListenableFuture
import dev.agenthive.watch.data.Store

/**
 * Glanceable tile — hive link status, the last thing the assistant said,
 * and a tap target that opens the chat/voice UI.
 */
class HiveTileService : TileService() {

    override fun onTileRequest(req: TileRequest): ListenableFuture<Tile> =
        CallbackToFutureAdapter.getFuture { c ->
            c.set(buildTile(req.deviceConfiguration))
            "hive-tile"
        }

    override fun onTileResourcesRequest(
        req: ResourcesRequest
    ): ListenableFuture<ResourceBuilders.Resources> =
        CallbackToFutureAdapter.getFuture { c ->
            c.set(ResourceBuilders.Resources.Builder()
                .setVersion(RES_VERSION).build())
            "hive-res"
        }

    private fun buildTile(dev: DeviceParametersBuilders.DeviceParameters): Tile {
        val store = Store(applicationContext)
        val status = when {
            !store.paired -> "Not paired — open AgentHive to link your hive"
            else -> "● Hive linked" +
                store.displayName.takeIf { it.isNotBlank() }
                    ?.let { " as $it" }.orEmpty()
        }
        // Proactive line ("Meeting in 35m") wins over lastReply when present
        val glance = store.suggestion.takeIf { it.isNotBlank() }
            ?.let { "✦ $it" } ?: store.lastReply.take(90)
        val ask = ModifiersBuilders.Clickable.Builder()
            .setId("ask")
            .setOnClick(ActionBuilders.LaunchAction.Builder()
                .setAndroidActivity(ActionBuilders.AndroidActivity.Builder()
                    .setPackageName(packageName)
                    .setClassName("dev.agenthive.watch.MainActivity")
                    .build())
                .build())
            .build()

        val ctx = this
        val body = LayoutElementBuilders.Column.Builder()
            .setWidth(DimensionBuilders.expand())
            .addContent(Text.Builder(ctx, status).build())
            .apply {
                if (glance.isNotBlank())
                    addContent(Text.Builder(ctx, glance)
                        .setMaxLines(2).build())
            }
            .build()

        val layout = PrimaryLayout.Builder(dev)
            .setContent(body)
            .setPrimaryChipContent(
                CompactChip.Builder(this, "✦ Ask", ask, dev).build())
            .build()

        return Tile.Builder()
            .setResourcesVersion(RES_VERSION)
            .setFreshnessIntervalMillis(30_000)
            .setTileTimeline(TimelineBuilders.Timeline.fromLayoutElement(layout))
            .build()
    }

    companion object { private const val RES_VERSION = "1" }
}
