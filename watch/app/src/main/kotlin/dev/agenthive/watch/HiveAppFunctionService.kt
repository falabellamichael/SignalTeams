package dev.agenthive.watch

import androidx.appfunctions.AppFunctionDeclaration
import androidx.appfunctions.AppFunctionService
import androidx.appfunctions.AppFunctionServiceEntryPoint
import dev.agenthive.watch.data.HiveApi
import dev.agenthive.watch.data.Store
import dev.agenthive.watch.device.PhoneBridge
import kotlinx.coroutines.withTimeoutOrNull

/**
 * The watch's Gemini Extensions surface — same recipe as the phone's
 * HiveAppFunctionService (property + assets/appfunctions.xml is what the
 * system indexer reads). askHive is the flagship: it routes a natural-
 * language query through the Nexus mesh to the hive's agent — the
 * "watch uses AI through the mesh" story as a system-callable function.
 */
@AppFunctionServiceEntryPoint(
    serviceName = "WatchAppFunctionService",
    appFunctionXmlFileName = "appfunctions")
abstract class WatchAppFunctionServiceBase : AppFunctionService() {

    /**
     * Asks the AgentHive assistant a question and returns the reply.
     * The query travels over the Nexus mesh to the user's hive cluster,
     * which answers with the configured agent and model.
     * @param query the natural-language question or instruction
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    suspend fun askHive(query: String): String {
        val store = Store(this)
        if (store.token.isBlank())
            return "The watch isn't linked to a hive yet — open AgentHive and pair it."
        val api = HiveApi()
        api.token = store.token
        // mesh egress first; a dead loopback falls back to the direct URL
        val bases = listOf(store.meshUrl, store.serverUrl)
            .filter { it.isNotBlank() }.distinct()
        var reply = ""
        var err: String? = "no hive URL stored"
        var agentId = store.agentId
        for (b in bases) {
            api.baseUrl = b
            if (agentId == 0) {
                agentId = runCatching {
                    api.agents().firstOrNull()?.id ?: 0
                }.getOrDefault(0)
                if (agentId > 0) store.agentId = agentId
            }
            if (agentId == 0) { err = "no agents on this hive"; break }
            reply = ""
            err = null
            runCatching {
                withTimeoutOrNull(25_000) {
                    api.tryStream(store.agentId, query, emptyList()).collect { ev ->
                        when (ev) {
                            is HiveApi.StreamEvent.Token -> reply += ev.text
                            is HiveApi.StreamEvent.Replace -> reply = ev.text
                            is HiveApi.StreamEvent.Error -> err = ev.message
                            else -> {}
                        }
                    }
                } ?: kotlin.run { err = "timed out" }
            }.onFailure { err = it.message }
            if (reply.isNotBlank()) break
        }
        return when {
            reply.isNotBlank() -> reply.take(2000)
            err != null -> "The hive couldn't answer: $err"
            else -> "The hive sent an empty reply."
        }
    }

    /**
     * Rings the paired phone at maximum volume so the owner can find it.
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    suspend fun ringPhone(): String = PhoneBridge.findPhone(this)

    /**
     * Stops the phone's find-me ringtone if it is playing.
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    suspend fun stopPhoneRinging(): String = PhoneBridge.stopPhone(this)

    /**
     * Reads the paired phone's status — battery, charging, network,
     * do-not-disturb.
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    suspend fun phoneStatus(): String = PhoneBridge.phoneStatus(this)

    /**
     * Says which song or media is playing on the paired phone.
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    suspend fun nowPlayingOnPhone(): String = PhoneBridge.phonePlaying(this)

    /**
     * Controls media playing on the paired phone.
     * @param verb one of: play, pause, next, previous
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    suspend fun controlPhoneMedia(verb: String): String =
        PhoneBridge.phoneMedia(this, verb.lowercase())

    /**
     * Reads the paired phone's most recent notifications.
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    suspend fun readPhoneNotifications(): String =
        PhoneBridge.phoneNotifs(this)

    /**
     * Opens an installed app on this watch by name.
     * @param name the app's display name
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    fun openWatchApp(name: String): String =
        dev.agenthive.watch.device.DeviceCommands
            .handle(this, "open $name")?.text
            ?: "Couldn't open $name."
}
