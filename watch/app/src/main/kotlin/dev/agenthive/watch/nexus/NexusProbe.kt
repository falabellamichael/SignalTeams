package dev.agenthive.watch.nexus

import android.util.Log

/** Diagnostic JNI probe — runs raw OpenSSL + httplib TLS inside the app's
 *  untrusted_app SELinux domain to isolate why the SDK's verified HTTPS fails
 *  while standalone probes succeed. */
object NexusProbe {
    init {
        runCatching { System.loadLibrary("nexusprobe") }
            .onFailure { Log.w("NexusProbe", "load failed: ${it.message}") }
    }

    external fun probe(host: String, port: Int, capem: String): String

    fun run(host: String, port: Int, capem: String = ""): String = try {
        probe(host, port, capem)
    } catch (t: Throwable) {
        "JNI FAIL ${t.message}"
    }
}
