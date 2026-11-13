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
            c.set(TileIcons.resources(RES_VERSION))
            "hive-res"
        }

    private fun buildTile(dev: DeviceParametersBuilders.DeviceParameters): Tile {
        val store = Store(applicationContext)
        val status = when {
            !store.paired -> "Not paired — open Nexus Watch to link your hive"
            else -> "Linked" +
                store.displayName.takeIf { it.isNotBlank() }
                    ?.let { " as $it" }.orEmpty()
        }
        // Proactive line ("Meeting in 35m") wins over lastReply when present
        val glance = store.suggestion.takeIf { it.isNotBlank() } ?: store.lastReply.take(90)
        val ask = ModifiersBuilders.Clickable.Builder()
            .setId("ask")
            .setOnClick(ActionBuilders.LaunchAction.Builder()
                .setAndroidActivity(ActionBuilders.AndroidActivity.Builder()
                    .setPackageName(packageName)
                    .setClassName("dev.agenthive.watch.MainActivity")
                    .build())
                .build())
            .build()

        val body = LayoutElementBuilders.Column.Builder()
            .setWidth(DimensionBuilders.expand())
            .addContent(iconText(status, "linked"))
            .apply {
                if (glance.isNotBlank())
                    addContent(iconText(glance, if (store.suggestion.isNotBlank()) "suggestion" else "ask"))
            }
            .build()

        val layout = PrimaryLayout.Builder(dev)
            .setContent(body)
            .setPrimaryChipContent(
                CompactChip.Builder(this, "Ask", ask, dev)
                    .setIconContent("ask").build())
            .build()

        return Tile.Builder()
            .setResourcesVersion(RES_VERSION)
            // Content changes request an update; this is only a safety refresh.
            .setFreshnessIntervalMillis(10 * 60_000L)
            .setTileTimeline(TimelineBuilders.Timeline.fromLayoutElement(layout))
            .build()
    }

    private fun iconText(text: String, icon: String): LayoutElementBuilders.Row =
        LayoutElementBuilders.Row.Builder()
            .setVerticalAlignment(LayoutElementBuilders.VERTICAL_ALIGN_CENTER)
            .addContent(LayoutElementBuilders.Image.Builder()
                .setResourceId(icon)
                .setWidth(DimensionBuilders.dp(14f))
                .setHeight(DimensionBuilders.dp(14f)).build())
            .addContent(LayoutElementBuilders.Spacer.Builder()
                .setWidth(DimensionBuilders.dp(4f)).build())
            .addContent(Text.Builder(this, text).setMaxLines(2).build())
            .build()

    companion object { private const val RES_VERSION = "2" }
}
