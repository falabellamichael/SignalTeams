package dev.agenthive.watch.assist

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.service.voice.VoiceInteractionService
import android.service.voice.VoiceInteractionSession
import android.service.voice.VoiceInteractionSessionService
import android.util.Log
import dev.agenthive.watch.MainActivity

private const val TAG = "HiveAssist"

/**
 * Digital-assistant plumbing — registering a VoiceInteractionService makes the
 * app selectable as the default assistant (Settings → Default apps → Digital
 * assistant), the same slot Gemini occupies. Press-and-hold on the center
 * button invokes the service, which hands off to MainActivity with
 * ACTION_ASSIST; the activity drops straight into voice capture.
 *
 * Launch the activity from EVERY entry point: Samsung's WearAssistManager
 * takes different paths by invocation source (key vs keyguard vs session),
 * and startAssistantActivity alone never surfaced the activity on this build.
 */
class HiveVoiceInteractionService : VoiceInteractionService() {
    override fun onPrepareToShowSession(args: Bundle, flags: Int) {
        Log.i(TAG, "onPrepareToShowSession flags=$flags — opening MainActivity")
        openApp()
        super.onPrepareToShowSession(args, flags)
    }

    override fun onLaunchVoiceAssistFromKeyguard() {
        Log.i(TAG, "onLaunchVoiceAssistFromKeyguard — opening MainActivity")
        openApp()
        super.onLaunchVoiceAssistFromKeyguard()
    }

    override fun onShowSessionFailed(args: Bundle) {
        Log.w(TAG, "onShowSessionFailed — falling back to direct launch")
        openApp()
        super.onShowSessionFailed(args)
    }

    private fun openApp() {
        try {
            startActivity(assistIntent(this))
        } catch (t: Throwable) {
            Log.w(TAG, "assist launch failed", t)
        }
    }

    companion object {
        fun assistIntent(ctx: Context) =
            Intent(ctx, MainActivity::class.java)
                .setAction(Intent.ACTION_ASSIST)
                .addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP or
                        Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                )
    }
}

class HiveSessionService : VoiceInteractionSessionService() {
    override fun onNewSession(args: Bundle?): VoiceInteractionSession {
        Log.i(TAG, "onNewSession")
        return HiveSession(this)
    }
}

class HiveSession(context: Context) : VoiceInteractionSession(context) {
    override fun onShow(args: Bundle?, showFlags: Int) {
        Log.i(TAG, "session onShow flags=$showFlags")
        super.onShow(args, showFlags)
        try {
            startAssistantActivity(HiveVoiceInteractionService.assistIntent(context))
        } catch (t: Throwable) {
            Log.w(TAG, "startAssistantActivity failed", t)
            try {
                context.startActivity(HiveVoiceInteractionService.assistIntent(context))
            } catch (t2: Throwable) {
                Log.w(TAG, "session fallback launch failed", t2)
            }
        }
        finish()
    }
}
