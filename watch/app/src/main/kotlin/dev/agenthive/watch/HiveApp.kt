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
        api = HiveApi()
        nexus = NexusNode(this)
        speaker = Speaker(api, this)
    }
}
