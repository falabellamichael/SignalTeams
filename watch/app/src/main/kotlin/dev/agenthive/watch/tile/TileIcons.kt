package dev.agenthive.watch.tile

import androidx.wear.protolayout.ResourceBuilders
import dev.agenthive.watch.R

/** The same bundled Material Symbols used by the Compose screens. */
internal object TileIcons {
    fun resources(version: String): ResourceBuilders.Resources =
        ResourceBuilders.Resources.Builder()
            .setVersion(version)
            .apply {
                mapOf(
                    "ask" to R.drawable.ic_symbol_auto_awesome,
                    "torch" to R.drawable.ic_symbol_flashlight_on,
                    "find" to R.drawable.ic_symbol_smartphone,
                    "batt" to R.drawable.ic_symbol_battery_full,
                    "buzz" to R.drawable.ic_symbol_vibration,
                    "linked" to R.drawable.ic_symbol_hub,
                    "suggestion" to R.drawable.ic_symbol_notifications,
                ).forEach { (id, drawable) ->
                    addIdToImageMapping(id, ResourceBuilders.ImageResource.Builder()
                        .setAndroidResourceByResId(ResourceBuilders.AndroidImageResourceByResId.Builder()
                            .setResourceId(drawable).build())
                        .build())
                }
            }
            .build()
}
