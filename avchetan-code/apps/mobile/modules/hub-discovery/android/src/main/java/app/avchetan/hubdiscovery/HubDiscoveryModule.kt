package app.avchetan.hubdiscovery

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Handler
import android.os.Looper
import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.Inet4Address

/**
 * Finds hubs on the local network (docs/product/tasks-routines-reminders.md §15) with Android's
 * own service discovery: the PC announces `_avchetan._tcp`. Looks for a few seconds, then stops,
 * so nothing runs in the background. Returns IPv4 addresses and ports only; the app still checks
 * each is its hub before sending anything to it (ADR-0033).
 */
class HubDiscoveryModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HubDiscovery")

    AsyncFunction("discover") { timeoutMs: Int, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.resolve(emptyList<Map<String, Any>>())
        return@AsyncFunction
      }
      Search(context, timeoutMs.coerceIn(500, 10_000), promise).start()
    }
  }

  private class Search(context: Context, private val timeoutMs: Int, private val promise: Promise) {
    private val nsd = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val main = Handler(Looper.getMainLooper())
    private val found = mutableListOf<Map<String, Any>>()
    private val waiting = ArrayDeque<NsdServiceInfo>()
    private var resolving = false
    private var finished = false
    /** Set once discovery was asked for, so it is always stopped, even before it reported starting. */
    private var asked = false

    private val discovery = object : NsdManager.DiscoveryListener {
      override fun onDiscoveryStarted(serviceType: String) = Unit

      override fun onServiceFound(info: NsdServiceInfo) {
        main.post {
          waiting.addLast(info)
          resolveNext()
        }
      }

      override fun onServiceLost(info: NsdServiceInfo) = Unit

      override fun onDiscoveryStopped(serviceType: String) = Unit

      override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
        Log.w(TAG, "discovery did not start (code $errorCode)")
        main.post {
          asked = false
          finish()
        }
      }

      override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
        Log.w(TAG, "discovery did not stop (code $errorCode)")
      }
    }

    fun start() {
      try {
        nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discovery)
        asked = true
      } catch (error: RuntimeException) {
        Log.w(TAG, "discovery failed: ${error.javaClass.simpleName}")
        finish()
        return
      }
      main.postDelayed({ finish() }, timeoutMs.toLong())
    }

    /** One resolve at a time: Android refuses a second while one runs. */
    private fun resolveNext() {
      if (finished || resolving) return
      val next = waiting.removeFirstOrNull() ?: return
      resolving = true
      @Suppress("DEPRECATION") // The replacement needs Android 14; this works on all.
      nsd.resolveService(
        next,
        object : NsdManager.ResolveListener {
          override fun onServiceResolved(info: NsdServiceInfo) {
            main.post {
              @Suppress("DEPRECATION")
              val host = info.host
              if (host is Inet4Address && info.port > 0) {
                found.add(mapOf("host" to (host.hostAddress ?: ""), "port" to info.port))
              }
              resolving = false
              resolveNext()
            }
          }

          override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {
            main.post {
              resolving = false
              resolveNext()
            }
          }
        },
      )
    }

    private fun finish() {
      if (finished) return
      finished = true
      if (asked) {
        try {
          nsd.stopServiceDiscovery(discovery)
        } catch (error: IllegalArgumentException) {
          Log.w(TAG, "discovery was already stopped")
        }
      }
      promise.resolve(found.distinct())
    }
  }

  private companion object {
    const val SERVICE_TYPE = "_avchetan._tcp."
    const val TAG = "HubDiscovery"
  }
}
