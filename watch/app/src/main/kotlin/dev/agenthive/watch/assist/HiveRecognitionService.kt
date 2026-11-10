package dev.agenthive.watch.assist

import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionService

/**
 * Minimal RecognitionService — several Wear OS builds require one registered
 * alongside the VoiceInteractionService before they list the app in the
 * assistant picker. It does no listening of its own; the app captures voice
 * with the platform SpeechRecognizer once the assistant intent opens it.
 */
class HiveRecognitionService : RecognitionService() {
    override fun onStartListening(recognizerIntent: Intent?, listener: Callback?) {}
    override fun onCancel(listener: Callback?) {}
    override fun onStopListening(listener: Callback?) {}
}
