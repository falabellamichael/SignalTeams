package dev.agenthive.watch

import android.app.Application
import dev.agenthive.watch.data.HiveApi
import dev.agenthive.watch.data.Store
import dev.agenthive.watch.nexus.NexusNode
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/** Process-wide singletons: one mesh node + one API client per watch. */
class HiveApp : Application() {
    lateinit var store: Store; private set
    lateinit var api: HiveApi; private set
    lateinit var nexus: NexusNode; private set
    lateinit var speaker: Speaker; private set

    /** Process-scoped scope — device tasks must outlive the ViewModel (swiping
     *  back to the watch face clears the VM and would kill a running task). */
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override fun onCreate() {
        super.onCreate()
        store = Store(this)
        api = HiveApi(this).apply {
            proxyHandler = object : dev.agenthive.watch.data.ApiProxyHandler {
                override suspend fun proxyRequest(method: String, path: String, bodyString: String, token: String) =
                    dev.agenthive.watch.device.PhoneBridge.proxyRequest(this@HiveApp, method, path, bodyString, token)
                override fun proxyStream(agentId: Int, message: String, history: List<Pair<String, String>>, model: String?) =
                    dev.agenthive.watch.device.PhoneBridge.proxyStream(this@HiveApp, agentId, message, history, model)
                override suspend fun probeMesh() =
                    dev.agenthive.watch.device.PhoneBridge.probePhoneMesh(this@HiveApp)
                override suspend fun hasCompanion() =
                    dev.agenthive.watch.device.PhoneBridge.hasNearbyPhone(this@HiveApp)
            }
        }
        nexus = NexusNode(this).apply {
            hasCompanionCheck = {
                runCatching {
                    kotlinx.coroutines.runBlocking(Dispatchers.IO) {
                        dev.agenthive.watch.device.PhoneBridge.hasNearbyPhone(this@HiveApp)
                    }
                }.getOrDefault(false)
            }
        }
        speaker = Speaker(api, this)
    }
}
