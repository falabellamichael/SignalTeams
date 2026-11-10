package dev.agenthive.watch.tile

import androidx.concurrent.futures.CallbackToFutureAdapter
import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.DeviceParametersBuilders
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.protolayout.material.Chip
import androidx.wear.protolayout.material.layouts.MultiButtonLayout
import androidx.wear.tiles.RequestBuilders.ResourcesRequest
import androidx.wear.tiles.RequestBuilders.TileRequest
import androidx.wear.tiles.TileBuilders.Tile
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.ListenableFuture

/**
 * Quick-controls tile — the companion to the glanceable tile, mirroring
 * the built-in assistant's widget surface: one-tap chips for the most
 * common device actions (ask, flashlight, find phone, buzz test).
 */
class HiveControlsTileService : TileService() {

    override fun onTileRequest(req: TileRequest): ListenableFuture<Tile> =
        CallbackToFutureAdapter.getFuture { c ->
            c.set(buildTile(req.deviceConfiguration))
            "hive-controls"
        }

    override fun onTileResourcesRequest(
        req: ResourcesRequest
    ): ListenableFuture<ResourceBuilders.Resources> =
        CallbackToFutureAdapter.getFuture { c ->
            c.set(ResourceBuilders.Resources.Builder()
                .setVersion(RES_VERSION).build())
            "hive-controls-res"
        }

    private fun click(id: String, cls: String,
                      action: String? = null): ModifiersBuilders.Clickable =
        ModifiersBuilders.Clickable.Builder()
            .setId(id)
            .setOnClick(ActionBuilders.LaunchAction.Builder()
                .setAndroidActivity(ActionBuilders.AndroidActivity.Builder()
                    .setPackageName(packageName)
                    .setClassName(cls)
                    .apply {
                        if (action != null)
                            addKeyToExtraMapping("action",
                                ActionBuilders.AndroidStringExtra.Builder()
                                    .setValue(action).build())
                    }
                    .build())
                .build())
            .build()

    private fun chip(dev: DeviceParametersBuilders.DeviceParameters,
                     id: String, label: String, cls: String,
                     action: String? = null): LayoutElementBuilders.LayoutElement =
        Chip.Builder(this, click(id, cls, action), dev)
            .setPrimaryLabelContent(label)
            .build()

    private fun buildTile(dev: DeviceParametersBuilders.DeviceParameters): Tile {
        val grid = MultiButtonLayout.Builder()
            .addButtonContent(chip(dev, "ask", "✦ Ask",
                "dev.agenthive.watch.MainActivity"))
            .addButtonContent(chip(dev, "torch", "🔦 Torch",
                "dev.agenthive.watch.device.TorchActivity"))
            .addButtonContent(chip(dev, "find", "📱 Find phone",
                "dev.agenthive.watch.device.QuickActionActivity", "find_phone"))
            .addButtonContent(chip(dev, "batt", "🔋 Phone",
                "dev.agenthive.watch.device.QuickActionActivity", "phone_status"))
            .addButtonContent(chip(dev, "buzz", "Buzz",
                "dev.agenthive.watch.device.QuickActionActivity", "vibrate"))
            .build()

        return Tile.Builder()
            .setResourcesVersion(RES_VERSION)
            .setTileTimeline(TimelineBuilders.Timeline.fromLayoutElement(grid))
            .build()
    }

    companion object { private const val RES_VERSION = "1" }
}
