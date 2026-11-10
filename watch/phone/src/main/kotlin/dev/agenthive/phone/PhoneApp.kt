package dev.agenthive.phone

import android.app.Application
import dev.agenthive.watch.data.HiveApi
import dev.agenthive.watch.data.Store
import dev.agenthive.watch.nexus.NexusNode

/** Process-wide singletons: one mesh node + one API client per phone. */
class PhoneApp : Application() {
    lateinit var store: Store; private set
    lateinit var api: HiveApi; private set
    lateinit var nexus: NexusNode; private set

    override fun onCreate() {
        super.onCreate()
        store = Store(this)
        api = HiveApi(this)
        nexus = NexusNode(this)
    }
}
