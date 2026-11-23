package app.avchetan.shareintent

import android.content.Intent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Text or a link shared to Avchetan from another app's share sheet
 * (docs/product/tasks-routines-reminders.md §12). The app's activity takes `text/plain` SEND
 * intents (app.json `intentFilters`); this hands their text to JavaScript once, which opens the
 * capture screen with it. Nothing is saved here and nothing touches the network.
 */
class ShareIntentModule : Module() {
  private var pending: Map<String, String?>? = null

  override fun definition() = ModuleDefinition {
    Name("ShareIntent")
    Events("onShare")

    // The app was already open: Android hands the share to the running activity.
    OnNewIntent { intent ->
      if (take(intent)) sendEvent("onShare", emptyMap<String, Any>())
    }

    /** The share that opened or reached the app, once; null when there is none. */
    Function("takeShared") {
      if (pending == null) appContext.currentActivity?.intent?.let { take(it) }
      val shared = pending
      pending = null
      shared
    }
  }

  private fun take(intent: Intent): Boolean {
    if (intent.action != Intent.ACTION_SEND) return false
    // Reopened from Recents, Android delivers the old share again: it was already taken.
    if (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) return false
    val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
    // Taken: a recreated activity (a rotation, say) must not open it a second time.
    intent.action = null
    if (text.isNullOrBlank()) return false
    pending = mapOf(
      "text" to text,
      "subject" to intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT)?.toString(),
    )
    return true
  }
}
